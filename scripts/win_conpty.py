"""A real Windows pseudoconsole, for driving bin/joule.exe the way a terminal does.

The POSIX harnesses in this directory open a pty and fork. ConPTY is the
Windows equivalent and the same mechanism Windows Terminal uses to host a
console program, so a binary started through here sees what it sees there: a
console handle, VT input, VT output, and a window size it can ask for.

Two details are not obvious and both cost a day to find.

CreateProcess copies the parent's standard handles into the child whenever
STARTF_USESTDHANDLES is not set, and the pseudoconsole attribute does not
override that. Started from a process whose stdout is a pipe - which is every
CI runner - the child attached to the pseudoconsole and then wrote to the
pipe, so the pty carried the console's setup bytes and nothing else. Blanking
the three standard handles for the length of the call leaves the console
subsystem to hand the child the pseudoconsole's own.

And output is drained on a thread rather than polled, because a console
handle's wait state is signalled by focus and mouse events that carry no
bytes, so anything that waits on the handle itself wakes up with nothing to
read.

Stdlib only, matching the zero-dependency style of the harnesses beside it.
"""

import ctypes
import ctypes.wintypes as w
import msvcrt
import os
import re
import subprocess
import threading
import time

k32 = ctypes.WinDLL("kernel32", use_last_error=True)

HPCON = w.HANDLE
EXTENDED_STARTUPINFO_PRESENT = 0x00080000
CREATE_UNICODE_ENVIRONMENT = 0x00000400
PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016
STD_HANDLES = (-10, -11, -12)
STILL_ACTIVE = 259


class COORD(ctypes.Structure):
    _fields_ = [("X", ctypes.c_short), ("Y", ctypes.c_short)]


class STARTUPINFO(ctypes.Structure):
    _fields_ = [
        ("cb", w.DWORD), ("lpReserved", w.LPWSTR), ("lpDesktop", w.LPWSTR),
        ("lpTitle", w.LPWSTR), ("dwX", w.DWORD), ("dwY", w.DWORD),
        ("dwXSize", w.DWORD), ("dwYSize", w.DWORD), ("dwXCountChars", w.DWORD),
        ("dwYCountChars", w.DWORD), ("dwFillAttribute", w.DWORD),
        ("dwFlags", w.DWORD), ("wShowWindow", w.WORD), ("cbReserved2", w.WORD),
        ("lpReserved2", ctypes.POINTER(ctypes.c_byte)),
        ("hStdInput", w.HANDLE), ("hStdOutput", w.HANDLE), ("hStdError", w.HANDLE),
    ]


class STARTUPINFOEX(ctypes.Structure):
    _fields_ = [("StartupInfo", STARTUPINFO), ("lpAttributeList", ctypes.c_void_p)]


class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("hProcess", w.HANDLE), ("hThread", w.HANDLE),
        ("dwProcessId", w.DWORD), ("dwThreadId", w.DWORD),
    ]


k32.CreatePseudoConsole.argtypes = [COORD, w.HANDLE, w.HANDLE, w.DWORD,
                                    ctypes.POINTER(HPCON)]
k32.CreatePseudoConsole.restype = ctypes.c_long
k32.ClosePseudoConsole.argtypes = [HPCON]
k32.CreatePipe.argtypes = [ctypes.POINTER(w.HANDLE), ctypes.POINTER(w.HANDLE),
                           ctypes.c_void_p, w.DWORD]
k32.CreatePipe.restype = w.BOOL
k32.InitializeProcThreadAttributeList.argtypes = [
    ctypes.c_void_p, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.c_size_t)]
k32.InitializeProcThreadAttributeList.restype = w.BOOL
k32.UpdateProcThreadAttribute.argtypes = [
    ctypes.c_void_p, w.DWORD, ctypes.c_size_t, ctypes.c_void_p,
    ctypes.c_size_t, ctypes.c_void_p, ctypes.POINTER(ctypes.c_size_t)]
k32.UpdateProcThreadAttribute.restype = w.BOOL
k32.CreateProcessW.argtypes = [
    w.LPCWSTR, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, w.BOOL, w.DWORD,
    ctypes.c_void_p, w.LPCWSTR, ctypes.POINTER(STARTUPINFOEX),
    ctypes.POINTER(PROCESS_INFORMATION)]
k32.CreateProcessW.restype = w.BOOL
k32.WriteFile.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD,
                          ctypes.POINTER(w.DWORD), ctypes.c_void_p]
k32.WriteFile.restype = w.BOOL
k32.GetStdHandle.argtypes = [w.DWORD]
k32.GetStdHandle.restype = w.HANDLE
k32.SetStdHandle.argtypes = [w.DWORD, w.HANDLE]
k32.SetStdHandle.restype = w.BOOL


def _check(ok, what):
    if not ok:
        raise ctypes.WinError(ctypes.get_last_error(), what)


class ConPty(object):
    def __init__(self, argv, env, cwd, cols=100, rows=30):
        in_r, in_w = w.HANDLE(), w.HANDLE()
        out_r, out_w = w.HANDLE(), w.HANDLE()
        _check(k32.CreatePipe(ctypes.byref(in_r), ctypes.byref(in_w), None, 0),
               "CreatePipe in")
        _check(k32.CreatePipe(ctypes.byref(out_r), ctypes.byref(out_w), None, 0),
               "CreatePipe out")

        self.hpc = HPCON()
        hr = k32.CreatePseudoConsole(COORD(cols, rows), in_r, out_w, 0,
                                     ctypes.byref(self.hpc))
        if hr != 0:
            raise OSError("CreatePseudoConsole failed hr=0x%08x" % (hr & 0xFFFFFFFF))

        size = ctypes.c_size_t(0)
        k32.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
        self._attr_buf = (ctypes.c_byte * size.value)()
        attrs = ctypes.cast(self._attr_buf, ctypes.c_void_p)
        _check(k32.InitializeProcThreadAttributeList(attrs, 1, 0, ctypes.byref(size)),
               "InitializeProcThreadAttributeList")
        _check(k32.UpdateProcThreadAttribute(
            attrs, 0, ctypes.c_size_t(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE),
            self.hpc, ctypes.sizeof(HPCON), None, None),
            "UpdateProcThreadAttribute")

        si = STARTUPINFOEX()
        si.StartupInfo.cb = ctypes.sizeof(STARTUPINFOEX)
        si.lpAttributeList = attrs

        block = "".join("%s=%s\0" % (k, v) for k, v in env.items()) + "\0"
        env_buf = ctypes.create_unicode_buffer(block)
        cmdline = ctypes.create_unicode_buffer(subprocess.list2cmdline(argv))
        self.pi = PROCESS_INFORMATION()

        saved = [(h, k32.GetStdHandle(h)) for h in STD_HANDLES]
        for handle, _ in saved:
            k32.SetStdHandle(handle, None)
        try:
            ok = k32.CreateProcessW(
                None, cmdline, None, None, False,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                env_buf, cwd, ctypes.byref(si), ctypes.byref(self.pi))
        finally:
            for handle, value in saved:
                k32.SetStdHandle(handle, value)
        _check(ok, "CreateProcessW")

        k32.CloseHandle(in_r)
        k32.CloseHandle(out_w)
        self._in_w = in_w
        self._out_fd = msvcrt.open_osfhandle(out_r.value, os.O_RDONLY)
        self._buf = bytearray()
        self._lock = threading.Lock()
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        while True:
            try:
                chunk = os.read(self._out_fd, 4096)
            except OSError:
                return
            if not chunk:
                return
            with self._lock:
                self._buf.extend(chunk)

    def write(self, data):
        if isinstance(data, str):
            data = data.encode("utf-8")
        written = w.DWORD(0)
        _check(k32.WriteFile(self._in_w, data, len(data),
                             ctypes.byref(written), None), "WriteFile")

    def text(self):
        with self._lock:
            return self._buf.decode("utf-8", "replace")

    def plain(self):
        stripped = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", self.text())
        stripped = re.sub(r"\x1b\][^\x07]*\x07", "", stripped)
        return stripped.replace("\r", "")

    def wait_for(self, pattern, timeout, label):
        rx = re.compile(pattern)
        deadline = time.time() + timeout
        while time.time() < deadline:
            if rx.search(self.plain()):
                return True
            time.sleep(0.05)
        raise AssertionError(
            "timed out waiting for %s\n--- last 2500 characters ---\n%s"
            % (label, self.plain()[-2500:]))

    def exit_code(self):
        code = w.DWORD(0)
        k32.GetExitCodeProcess(self.pi.hProcess, ctypes.byref(code))
        return None if code.value == STILL_ACTIVE else code.value

    def close(self):
        try:
            k32.ClosePseudoConsole(self.hpc)
        finally:
            k32.TerminateProcess(self.pi.hProcess, 1)
