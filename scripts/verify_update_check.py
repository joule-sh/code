#!/usr/bin/env python3
import errno
import fcntl
import os
import shutil
import select
import signal
import struct
import sys
import termios
import time

REPO_ROOT = os.path.expanduser("~/projects/code-123-update")
JOULE_BIN = os.path.join(REPO_ROOT, "bin", "joule")

failures = []


def ok(cond, label):
    if cond:
        print("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr)


class PtySession:
    def __init__(self, cmd, env, cwd, rows=24, cols=80):
        self.rows = rows
        self.cols = cols
        master_fd, slave_fd = os.openpty()
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        pid = os.fork()
        if pid == 0:
            self._child(cmd, env, cwd, master_fd, slave_fd)
        os.close(slave_fd)
        self.master_fd = master_fd
        self.pid = pid
        self.reaped = False
        self.raw = bytearray()
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

    def _child(self, cmd, env, cwd, master_fd, slave_fd):
        try:
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)
            os.chdir(cwd)
            os.execvpe(cmd[0], cmd, env)
        except Exception as e:
            try:
                os.write(2, ("verify_update_check: exec failed: " + str(e) + "\n").encode())
            except Exception:
                pass
            os._exit(127)

    def _pump(self, timeout):
        deadline = time.time() + timeout
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                return
            r, _, _ = select.select([self.master_fd], [], [], remaining)
            if self.master_fd not in r:
                return
            try:
                chunk = os.read(self.master_fd, 65536)
            except OSError as e:
                if e.errno in (errno.EIO, errno.EBADF):
                    return
                raise
            if not chunk:
                return
            self.raw.extend(chunk)

    def write(self, data):
        if isinstance(data, str):
            data = data.encode()
        os.write(self.master_fd, data)

    def wait_for(self, needle, timeout=10.0):
        deadline = time.time() + timeout
        needle_b = needle.encode() if isinstance(needle, str) else needle
        while time.time() < deadline:
            idx = self.raw.find(needle_b)
            if idx >= 0:
                return idx
            self._pump(0.05)
        return -1

    def settle(self, quiet=0.3, cap=4.0):
        start = time.time()
        last_len = len(self.raw)
        while time.time() - start < cap:
            self._pump(quiet)
            if len(self.raw) == last_len:
                return
            last_len = len(self.raw)

    def wait_exit(self, timeout=5.0):
        if self.reaped:
            return True
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                pid, status = os.waitpid(self.pid, os.WNOHANG)
            except ChildProcessError:
                self.reaped = True
                return True
            if pid != 0:
                self.reaped = True
                return True
            time.sleep(0.05)
        return False

    def close(self):
        if self.reaped:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            return
        try:
            os.kill(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        if not self.wait_exit(2.0):
            try:
                os.kill(self.pid, signal.SIGKILL)
                os.waitpid(self.pid, 0)
            except (ProcessLookupError, ChildProcessError):
                pass
        try:
            os.close(self.master_fd)
        except OSError:
            pass


def text(raw_bytes):
    return raw_bytes.decode("latin1")


def make_workspace():
    d = "/tmp/update-check-verify-workspace"
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)
    return d


def make_install(install_root, version_tag):
    if os.path.isdir(install_root):
        shutil.rmtree(install_root)
    version_dir = os.path.join(install_root, version_tag)
    os.makedirs(version_dir)
    exe = os.path.join(version_dir, "joule")
    shutil.copy(JOULE_BIN, exe)
    os.chmod(exe, 0o755)
    return exe


def base_env(scratch_home, install_root):
    env = dict(os.environ)
    env["HOME"] = scratch_home
    env["CODE_INSTALL_ROOT"] = install_root
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    env["JOULE_CODE_MODEL"] = "stub-model"
    return env


def run_session(exe, scratch_home, install_root, workspace, label, timeout, wait_notice_timeout=0.0):
    if os.path.isdir(scratch_home):
        shutil.rmtree(scratch_home)
    os.makedirs(scratch_home)
    env = base_env(scratch_home, install_root)
    started = time.time()
    sess = PtySession([exe], env, workspace, rows=24, cols=80)
    idx = sess.wait_for("joule - type a request", timeout=timeout)
    elapsed = time.time() - started
    if wait_notice_timeout > 0:
        sess.wait_for("newer release is available", timeout=wait_notice_timeout)
    sess.settle(quiet=0.3, cap=1.5)
    sess.write(b"\x04")
    sess.wait_exit(5.0)
    sess.close()
    return elapsed, idx >= 0, text(bytes(sess.raw))


def phase_no_hang():
    print("=== phase 1: network unreachable, startup must not be delayed and nothing printed ===")
    workspace = make_workspace()
    install_root = "/tmp/update-check-verify-install-blackhole"
    exe = make_install(install_root, "v0.1.0-test")
    scratch_home = "/tmp/update-check-verify-home-blackhole"

    elapsed, saw_banner, output = run_session(exe, scratch_home, install_root, workspace, "blackhole", timeout=8.0)

    ok(saw_banner, "the banner appeared at all under the network-unreachable case")
    ok(elapsed < 3.0, "startup (to the banner) took %.2fs, under the 3s budget, with the update endpoint unreachable" % elapsed)
    ok("newer release is available" not in output, "no update notice was printed when the network never answered")
    print("elapsed to banner: %.3fs" % elapsed)


def read_cache(scratch_home):
    p = os.path.join(scratch_home, ".config", "joule-code", "update-check.json")
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return f.read()


def phase_positive_and_cache():
    print("=== phase 2: a real, reachable outdated version is offered the update once, then the cache suppresses it ===")
    workspace = make_workspace()
    install_root = "/tmp/update-check-verify-install-real"
    exe = make_install(install_root, "v0.1.0-test")
    scratch_home = "/tmp/update-check-verify-home-real"

    elapsed1, saw_banner1, output1 = run_session(exe, scratch_home, install_root, workspace, "first (outdated, reachable)", timeout=8.0, wait_notice_timeout=8.0)
    ok(saw_banner1, "the banner appeared on the first (outdated) run")
    ok(elapsed1 < 3.0, "startup (to the banner) took %.2fs on the first run, GitHub reachable" % elapsed1)

    found_notice_1 = "newer release is available" in output1
    ok(found_notice_1, "the update notice (version + install command) appeared once the background check came back")

    cache_after_first = read_cache(scratch_home)
    ok(cache_after_first is not None, "the cache file was written after the first run")
    print("cache after first run: %r" % cache_after_first)
    print("output 1 tail:\n" + output1[-800:])

    if os.path.isdir(workspace):
        shutil.rmtree(workspace)
    os.makedirs(workspace)
    env2 = base_env(scratch_home, install_root)
    sess2 = PtySession([exe], env2, workspace, rows=24, cols=80)
    idx2 = sess2.wait_for("joule - type a request", timeout=8.0)
    ok(idx2 >= 0, "the banner appeared on the second run")
    sess2.settle(quiet=0.3, cap=2.0)
    sess2.write(b"\x04")
    sess2.wait_exit(5.0)
    sess2.close()
    output2 = text(bytes(sess2.raw))
    ok("newer release is available" not in output2, "the second run within the same day printed no notice (the daily cache suppressed the repeat check)")
    print("output 2 tail:\n" + output2[-800:])

    return found_notice_1


def phase_dev_never_offered(dev_exe):
    print("=== phase 3: a dev build is never offered an update, even with the network reachable and a managed-looking install layout ===")
    workspace = make_workspace()
    install_root = "/tmp/update-check-verify-install-dev"
    if os.path.isdir(install_root):
        shutil.rmtree(install_root)
    version_dir = os.path.join(install_root, "vdev-test")
    os.makedirs(version_dir)
    exe = os.path.join(version_dir, "joule")
    shutil.copy(dev_exe, exe)
    os.chmod(exe, 0o755)
    scratch_home = "/tmp/update-check-verify-home-dev"

    elapsed, saw_banner, output = run_session(exe, scratch_home, install_root, workspace, "dev build", timeout=8.0, wait_notice_timeout=3.0)
    ok(saw_banner, "the banner appeared for the dev-build run")
    ok("newer release is available" not in output, "a dev build printed no update notice")
    cache = read_cache(scratch_home)
    ok(cache is None, "a dev build never even wrote an update-check cache file (it never checks)")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    dev_exe = sys.argv[2] if len(sys.argv) > 2 else JOULE_BIN

    found_notice_1 = None
    if which in ("all", "no_hang"):
        phase_no_hang()
    if which in ("all", "positive"):
        found_notice_1 = phase_positive_and_cache()
        phase_dev_never_offered(dev_exe)

    print()
    if failures:
        print("FAILURES:")
        for f in failures:
            print(" - " + f)
        sys.exit(1)
    print("all requested update-check verification phases passed")
    if found_notice_1 is not None:
        print("first-run notice observed in captured output: %s" % found_notice_1)
