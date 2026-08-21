#!/usr/bin/env python3
# Drives the real bin/joule binary under a real pty and asserts structural
# correctness of the raw output byte stream: no stray newline bytes, no
# duplicated cursor-position sequences within a redraw, no color bleed across
# a row boundary, scrollback pinning under new content, and that /cat never
# talks to the model. See ticket #57.
#
# Zero-dependency: stdlib only, matching scripts/e2e_full_stack.mjs's own
# zero-dependency Node style. Uses a manual openpty + fork instead of
# pty.fork() so the pty window size can be set before the child ever calls
# tty_rows()/tty_cols().

import errno
import fcntl
import os
import re
import select
import shutil
import signal
import socket
import struct
import sys
import tempfile
import termios
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOULE_BIN = os.path.join(REPO_ROOT, "bin", "joule")
STUB_BIN = os.path.join(REPO_ROOT, "bin", "stub_model")

CURSOR_RE = re.compile(r"\x1b\[(\d+);1H")
SGR_RE = re.compile(r"\x1b\[([0-9;]*)m")
RESET_SEQ = "\x1b[0m"
SCROLL_INDICATOR = "scrolled up, PageDown to return to the live view"
BANNER = "joule - type a request, /help for commands, ctrl-d to quit"
ALT_ENTER = "\x1b[?1049h"
ALT_EXIT = "\x1b[?1049l"
HIDE_CURSOR = "\x1b[?25l"
MOUSE_ENABLE = "\x1b[?1000h\x1b[?1006h"
MOUSE_DISABLE = "\x1b[?1000l\x1b[?1006l"
WHEEL_UP = b"\x1b[<64;10;5M"
WHEEL_DOWN = b"\x1b[<65;10;5M"
MOUSE_CLICK = b"\x1b[<0;5;5M\x1b[<0;5;5m"

TOOL_CALL_MARKER = "  -> "
TOOL_RESULT_OK_MARKER = "     ok:"
TOOL_RESULT_FAIL_MARKER = "     failed:"
APPROVAL_MARKER = "  ? "
ERROR_MARKER = "! "
RUN_TOOL_CALL_MARKER = '-> run {"command":'

ARROW_UP = b"\x1b[A"
ARROW_DOWN = b"\x1b[B"
REVERSE_SEQ = "\x1b[7m"
# One row of the approval option list (#88): an optional marker cursor, the
# list position, then the label. Matched against the row with its SGR stripped,
# so it holds at narrow widths where the label itself is clipped.
APPROVAL_OPTION_RE = re.compile(r"^\s*(>|\s)\s*([123])\. (.*?)\s*$")
APPROVAL_ALWAYS_LABEL_PREFIX = "Yes, and don't ask again for "
APPROVAL_OPTION_COUNT = 3

failures = []


def ok(cond, label):
    if cond:
        print("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr)


class Failure(Exception):
    pass


def free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_for_port(port, timeout_s):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.settimeout(0.2)
            s.connect(("127.0.0.1", port))
            s.close()
            return True
        except OSError:
            pass
        finally:
            s.close()
        time.sleep(0.05)
    return False


class PtySession:
    def __init__(self, cmd, env, cwd, rows=24, cols=80):
        self.rows = rows
        self.cols = cols
        master_fd, slave_fd = os.openpty()
        self._set_winsize(master_fd, rows, cols)
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
                os.write(2, ("terminal_structural_harness: exec failed: " + str(e) + "\n").encode())
            except Exception:
                pass
            os._exit(127)

    def _set_winsize(self, fd, rows, cols):
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)

    def resize(self, rows, cols):
        self.rows, self.cols = rows, cols
        self._set_winsize(self.master_fd, rows, cols)

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

    def wait_for(self, needle, timeout=10.0, from_index=0):
        deadline = time.time() + timeout
        needle_b = needle.encode() if isinstance(needle, str) else needle
        while time.time() < deadline:
            idx = self.raw.find(needle_b, from_index)
            if idx >= 0:
                return idx
            self._pump(0.05)
        raise Failure("timed out waiting for %r in captured output (have %d bytes)" % (needle, len(self.raw)))

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


def last_redraw_block(full_text, up_to=None):
    hay = full_text if up_to is None else full_text[:up_to]
    idx = hay.rfind("\x1b[1;1H")
    if idx < 0:
        raise Failure("no redraw (no ESC[1;1H) found in captured output yet")
    return full_text[idx:] if up_to is None else full_text[idx:up_to]


def parse_redraw_rows(block):
    matches = list(re.finditer(r"\x1b\[(\d+);1H\x1b\[2K", block))
    rows = []
    for i, m in enumerate(matches):
        row = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(block)
        rows.append((row, block[start:end]))
    return rows


def strip_sgr(s):
    return SGR_RE.sub("", s)


def approval_option_rows(full_text):
    """The approval prompt's option rows in the latest redraw, in list order.

    Ticket #88 renders the decisions as a vertical numbered list instead of a
    bare (y/n/a) line. Each entry carries its list position, whether it holds
    the marker cursor, whether it is drawn in reverse video, and its label.
    """
    out = []
    for (_, cell) in parse_redraw_rows(last_redraw_block(full_text)):
        m = APPROVAL_OPTION_RE.match(strip_sgr(cell))
        if m is None:
            continue
        out.append({
            "number": int(m.group(2)),
            "marked": m.group(1) == ">",
            "highlighted": REVERSE_SEQ in cell,
            "label": m.group(3),
        })
    return out


def highlighted_option(option_rows):
    """The list position of the single highlighted row, or 0 if not exactly one."""
    lit = [r for r in option_rows if r["highlighted"] and r["marked"]]
    return lit[0]["number"] if len(lit) == 1 else 0


def check_approval_option_list(session, tool, label):
    """Assert the shape of a freshly rendered, not yet answered, option list."""
    session.settle(0.3, 2.0)
    rows = approval_option_rows(text(bytes(session.raw)))
    ok(len(rows) == APPROVAL_OPTION_COUNT, label + ": the approval prompt renders one row per decision, got %d" % len(rows))
    if len(rows) != APPROVAL_OPTION_COUNT:
        return rows
    ok([r["number"] for r in rows] == [1, 2, 3], label + ": the option rows read 1, 2, 3 down the list")
    ok(rows[0]["label"] == "Yes", label + ": option 1 is Yes, got %r" % rows[0]["label"])
    ok(rows[1]["label"] == APPROVAL_ALWAYS_LABEL_PREFIX + tool + " this session", label + ": option 2 is the always option and names the tool, got %r" % rows[1]["label"])
    ok(rows[2]["label"] == "No", label + ": option 3 is No, got %r" % rows[2]["label"])
    ok(len([r for r in rows if r["highlighted"]]) == 1, label + ": exactly one option row is drawn in reverse video")
    ok(len([r for r in rows if r["marked"]]) == 1, label + ": exactly one option row carries the marker cursor")
    ok(highlighted_option(rows) == 1, label + ": option 1 is the highlighted one before any key is pressed")
    return rows


def check_zero_newlines(full_text):
    count = full_text.count("\n")
    ok(count == 0, "the captured stdout stream contains zero raw newline (0x0A) bytes, got %d" % count)


def check_cursor_monotonic(full_text):
    matches = list(CURSOR_RE.finditer(full_text))
    ok(len(matches) > 0, "at least one cursor-position redraw sequence was captured")
    current_last = None
    violation = None
    for m in matches:
        row = int(m.group(1))
        if row == 1:
            current_last = row
            continue
        if current_last is None:
            current_last = row
            continue
        if row <= current_last:
            violation = "row %d repeated or went backwards after row %d at byte offset %d" % (row, current_last, m.start())
            break
        current_last = row
    ok(violation is None, "no redraw repeats or reorders a row's cursor-position sequence" + ("" if violation is None else (": " + violation)))


def check_color_bleed(full_text, label_suffix=""):
    boundaries = [m.start() for m in CURSOR_RE.finditer(full_text)]
    if not boundaries:
        ok(False, "color bleed check found no cursor-position sequences to segment on" + label_suffix)
        return
    boundaries.append(len(full_text))
    bled_at = None
    for i in range(len(boundaries) - 1):
        seg = full_text[boundaries[i]:boundaries[i + 1]]
        open_color = False
        for m in SGR_RE.finditer(seg):
            if m.group(0) == RESET_SEQ:
                open_color = False
            else:
                open_color = True
        if open_color:
            bled_at = boundaries[i]
            break
    ok(bled_at is None, "every SGR color-start is reset before the next row's cursor-position sequence begins" + label_suffix + ("" if bled_at is None else (" (open color at byte offset %d)" % bled_at)))


def self_test_color_bleed_detector():
    good = "\x1b[1;1H\x1b[2K\x1b[38;2;1;2;3mtext\x1b[0m\x1b[2;1H\x1b[2Knext"
    bad = "\x1b[1;1H\x1b[2K\x1b[38;2;1;2;3mtext (no reset)\x1b[2;1H\x1b[2Knext"
    global failures
    saved = failures
    saved_stdout = sys.stdout
    saved_stderr = sys.stderr
    failures = []
    devnull = open(os.devnull, "w")
    sys.stdout = devnull
    sys.stderr = devnull
    try:
        check_color_bleed(good, " (self-test: clean row)")
        clean_passed = len(failures) == 0
        failures = []
        check_color_bleed(bad, " (self-test: bled row)")
        bled_caught = len(failures) == 1
    finally:
        sys.stdout = saved_stdout
        sys.stderr = saved_stderr
        devnull.close()
        failures = saved
    ok(clean_passed, "color-bleed detector self-test: a correctly reset row is not flagged")
    ok(bled_caught, "color-bleed detector self-test: an unreset color bleeding into the next row is caught")


def check_mouse_teardown(full_text, exit_label):
    disable_idx = full_text.rfind(MOUSE_DISABLE)
    exit_idx = full_text.rfind(ALT_EXIT)
    ok(disable_idx >= 0, "the mouse reporting disable sequences (1000l+1006l) appear in the byte stream on %s exit (ticket #82)" % exit_label)
    ok(exit_idx >= 0, "the alt screen exit sequence appears in the byte stream on %s exit" % exit_label)
    ok(disable_idx >= 0 and exit_idx >= 0 and disable_idx < exit_idx, "mouse reporting is disabled before the alt screen exits on %s exit (ticket #82)" % exit_label)


def run_ctrl_c_exit_scenario():
    work_dir = tempfile.mkdtemp(prefix="joule-terminal-harness-ctrlc-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    seed_workspace(repo_dir)
    joule_env = dict(os.environ)
    joule_env["HOME"] = home_dir
    joule_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    joule_env["JOULE_CODE_MODEL"] = "stub"
    joule_env["JOULE_CODE_API_KEY"] = "stub-key"
    joule_env["TERM"] = "xterm-256color"
    session = None
    try:
        session = PtySession([JOULE_BIN], joule_env, repo_dir, rows=24, cols=80)
        session.wait_for(BANNER, timeout=10.0)
        session.write("\x03")
        exited = session.wait_exit(5.0)
        ok(exited, "joule exits cleanly on ctrl-c with an empty input line")
        session._pump(0.5)
        check_mouse_teardown(text(bytes(session.raw)), "ctrl-c")
    finally:
        if session is not None:
            session.close()
        shutil.rmtree(work_dir, ignore_errors=True)


def visible_rows(screen_block):
    return [strip_sgr(c) for (_, c) in parse_redraw_rows(screen_block)]


def newly_appeared_rows(before_rows, after_rows):
    return [r for r in after_rows if r not in before_rows]


def assert_no_model_markers_in_new_rows(new_rows, label):
    joined = "\x00".join(new_rows)
    for marker in (TOOL_CALL_MARKER, TOOL_RESULT_OK_MARKER, TOOL_RESULT_FAIL_MARKER, APPROVAL_MARKER, ERROR_MARKER):
        ok(marker not in joined, label + " (no new %r marker among the rows the command itself produced)" % marker)


def seed_workspace(repo_dir):
    os.makedirs(repo_dir, exist_ok=True)
    with open(os.path.join(repo_dir, "README.md"), "w") as f:
        f.write("# demo\n\nNo health route yet.")
    file_a_lines = ["FILE_A_LINE_%03d of alpha content padding the row" % i for i in range(1, 51)]
    file_b_lines = ["FILE_B_LINE_%03d of beta content padding the row" % i for i in range(1, 51)]
    with open(os.path.join(repo_dir, "file_a.txt"), "w") as f:
        f.write("\n".join(file_a_lines) + "\n")
    with open(os.path.join(repo_dir, "file_b.txt"), "w") as f:
        f.write("\n".join(file_b_lines) + "\n")


def start_stub_session(prefix, rows=24, cols=80):
    """A fresh workspace, stub model, and joule pty session.

    The stub's scripted step counter lives in the stub process, so a scenario
    that needs its own approval prompt needs its own stub alongside it.
    """
    import subprocess
    work_dir = tempfile.mkdtemp(prefix=prefix)
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    seed_workspace(repo_dir)

    stub_port = free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = os.path.join(work_dir, "stub_requests.log")
    stub_proc = subprocess.Popen([STUB_BIN], env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_for_port(stub_port, 5.0):
        stop_stub_session(work_dir, stub_proc, None)
        raise Failure("stub model server did not start")

    joule_env = dict(os.environ)
    joule_env["HOME"] = home_dir
    joule_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    joule_env["JOULE_CODE_MODEL"] = "stub"
    joule_env["JOULE_CODE_API_KEY"] = "stub-key"  # non-empty so the first-run wizard (#46) does not trigger; the stub model does not check it
    joule_env["TERM"] = "xterm-256color"
    return work_dir, stub_proc, PtySession([JOULE_BIN], joule_env, repo_dir, rows=rows, cols=cols)


def stop_stub_session(work_dir, stub_proc, session):
    if session is not None:
        session.close()
    try:
        stub_proc.terminate()
        stub_proc.wait(timeout=3)
    except Exception:
        try:
            stub_proc.kill()
        except Exception:
            pass
    shutil.rmtree(work_dir, ignore_errors=True)


def drive_to_approval(session):
    session.wait_for(BANNER, timeout=10.0)
    session.write("add a health note\r")
    session.wait_for(APPROVAL_MARKER, timeout=10.0)


def check_clean_exit_invariants(session, label):
    suffix = " (%s scenario)" % label
    session.write("\x04")
    ok(session.wait_exit(5.0), "joule exits cleanly on ctrl-d at the end of the %s scenario" % label)
    session._pump(0.5)
    full_text = text(bytes(session.raw))
    ok(full_text.count("\n") == 0, "the %s scenario's stream contains zero raw newline (0x0A) bytes, got %d" % (label, full_text.count("\n")))
    check_cursor_monotonic(full_text)
    check_color_bleed(full_text, suffix)


def run_approval_arrow_key_scenario():
    """#88: the arrow keys move the highlight and Enter confirms the highlighted row."""
    work_dir = None
    stub_proc = None
    session = None
    try:
        work_dir, stub_proc, session = start_stub_session("joule-terminal-harness-arrows-")
        drive_to_approval(session)
        check_approval_option_list(session, "run", "a fresh approval prompt")

        def press(key):
            session.write(key)
            session.settle(0.2, 1.5)
            return highlighted_option(approval_option_rows(text(bytes(session.raw))))

        ok(press(ARROW_DOWN) == 2, "arrow down moves the highlight to option 2")
        ok(press(ARROW_DOWN) == 3, "a second arrow down moves the highlight to option 3")
        ok(press(ARROW_DOWN) == 3, "arrow down at the bottom of the list stays on option 3 rather than wrapping")
        ok(press(ARROW_UP) == 2, "arrow up moves the highlight back to option 2")
        ok(press(ARROW_UP) == 1, "arrow up returns the highlight to option 1")
        ok(press(ARROW_UP) == 1, "arrow up at the top of the list stays on option 1 rather than wrapping")

        session.write(ARROW_DOWN)
        session.write(ARROW_DOWN)
        session.settle(0.2, 1.5)
        ok(highlighted_option(approval_option_rows(text(bytes(session.raw)))) == 3, "the highlight is parked on option 3 before Enter is pressed")

        pre_enter = len(session.raw)
        session.write("\r")
        session.wait_for("Done.", timeout=15.0)
        session.settle(0.3, 2.0)
        after_enter = text(bytes(session.raw[pre_enter:]))
        ok(RUN_TOOL_CALL_MARKER not in after_enter, "Enter confirms the highlighted option rather than the default one: option 3 denies the call and the run tool never fires")
        ok(highlighted_option(approval_option_rows(text(bytes(session.raw)))) == 3, "the answered prompt keeps the confirmed option highlighted in the transcript")

        check_clean_exit_invariants(session, "arrow-driven approval")
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)


def run_approval_number_key_scenario():
    """#88: a number key jumps straight to that option and confirms it."""
    work_dir = None
    stub_proc = None
    session = None
    try:
        work_dir, stub_proc, session = start_stub_session("joule-terminal-harness-numbers-")
        drive_to_approval(session)
        check_approval_option_list(session, "run", "a fresh approval prompt before a number key")

        session.write("2")
        session.wait_for(RUN_TOOL_CALL_MARKER, timeout=10.0)
        session.wait_for("Done.", timeout=15.0)
        session.settle(0.3, 2.0)
        ok(highlighted_option(approval_option_rows(text(bytes(session.raw)))) == 2, "the number key 2 jumps the highlight onto the always option and confirms it")

        rows_after = parse_redraw_rows(last_redraw_block(text(bytes(session.raw))))
        input_rows = [strip_sgr(c).rstrip() for (_, c) in rows_after if strip_sgr(c).rstrip() == ">" or strip_sgr(c).rstrip().endswith("> 2")]
        ok(all(r == ">" for r in input_rows), "the number key is consumed by the prompt rather than typed into the input line")

        check_clean_exit_invariants(session, "number-key approval")
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)


def run_scenario():
    self_test_color_bleed_detector()

    work_dir = tempfile.mkdtemp(prefix="joule-terminal-harness-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    seed_workspace(repo_dir)

    stub_port = free_port()
    stub_log = os.path.join(work_dir, "stub_requests.log")
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = stub_log

    import subprocess
    stub_proc = subprocess.Popen([STUB_BIN], env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    session = None
    try:
        if not wait_for_port(stub_port, 5.0):
            raise Failure("stub model server did not start")

        joule_env = dict(os.environ)
        joule_env["HOME"] = home_dir
        joule_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
        joule_env["JOULE_CODE_MODEL"] = "stub"
        joule_env["JOULE_CODE_API_KEY"] = "stub-key"  # non-empty so the first-run wizard (#46) does not trigger; the stub model does not check it
        joule_env["TERM"] = "xterm-256color"

        session = PtySession([JOULE_BIN], joule_env, repo_dir, rows=24, cols=80)

        session.wait_for(BANNER, timeout=10.0)
        ok(True, "joule starts under a real pty and prints its banner")

        startup_text = text(bytes(session.raw))
        alt_idx = startup_text.find(ALT_ENTER)
        ok(alt_idx >= 0, "the alt screen enter sequence appears at startup")
        expected_mouse_idx = alt_idx + len(ALT_ENTER) + len(HIDE_CURSOR)
        ok(startup_text.find(MOUSE_ENABLE) == expected_mouse_idx, "mouse reporting (1000h+1006h) is enabled immediately after entering the alt screen and hiding the cursor (ticket #82)")

        session.write("abc")
        session.write("\x7f\x7f\x7f")
        session.settle(0.2, 1.5)
        ok(True, "typing characters and backspacing them redraws without crashing")

        pre_turn_idx = len(session.raw)
        session.write("add a health note\r")
        session.wait_for('-> read {"path":"README.md"}', timeout=10.0)
        session.wait_for(APPROVAL_MARKER, timeout=10.0)
        check_approval_option_list(session, "run", "the approval prompt of a real model turn")
        session.write("y")
        session.wait_for(RUN_TOOL_CALL_MARKER, timeout=10.0)
        session.wait_for("Done.", timeout=15.0)
        session.settle(0.3, 2.0)
        turn_segment = text(bytes(session.raw[pre_turn_idx:]))
        ok(APPROVAL_MARKER in turn_segment, "a real model turn through the stub model produced an approval prompt (proves the marker check below is not vacuous)")
        ok(highlighted_option(approval_option_rows(text(bytes(session.raw)))) == 1, "answering with the y shortcut leaves option 1 as the highlighted, confirmed row (#88 keeps y/n/a working)")
        ok(TOOL_CALL_MARKER in turn_segment, "the same turn produced a tool.call marker (proves the marker check below is not vacuous)")

        rows_after_turn = visible_rows(last_redraw_block(text(bytes(session.raw))))
        garbled_concatenation = "route yet.No health route yet"
        ok(all(garbled_concatenation not in r for r in rows_after_turn), "the read tool.result's last line never runs directly into the run step's resumed text.delta with no separator (ticket #62)")
        ok(any("No health route yet. I will fix it." in r for r in rows_after_turn), "the run step's resumed text.delta appears on its own row after the read tool.result (ticket #62)")

        rows_before_cat_a = visible_rows(last_redraw_block(text(bytes(session.raw))))
        session.write("/cat file_a.txt\r")
        session.wait_for("FILE_A_LINE_050", timeout=10.0)
        session.settle(0.2, 1.5)
        rows_after_cat_a = visible_rows(last_redraw_block(text(bytes(session.raw))))
        new_rows_a = newly_appeared_rows(rows_before_cat_a, rows_after_cat_a)
        ok(any("FILE_A_LINE" in r for r in new_rows_a), "/cat file_a.txt actually rendered new content to check markers against")
        assert_no_model_markers_in_new_rows(new_rows_a, "/cat file_a.txt bypasses the model")

        rows_before_cat_b = visible_rows(last_redraw_block(text(bytes(session.raw))))
        session.write("/cat file_b.txt\r")
        session.wait_for("FILE_B_LINE_050", timeout=10.0)
        session.settle(0.2, 1.5)
        rows_after_cat_b = visible_rows(last_redraw_block(text(bytes(session.raw))))
        new_rows_b = newly_appeared_rows(rows_before_cat_b, rows_after_cat_b)
        ok(any("FILE_B_LINE" in r for r in new_rows_b), "/cat file_b.txt actually rendered new content to check markers against")
        assert_no_model_markers_in_new_rows(new_rows_b, "/cat file_b.txt bypasses the model")

        for _ in range(3):
            session.write(b"\x1b[5~")
            session.settle(0.15, 1.0)
        full_after_pageup = text(bytes(session.raw))
        screen_after_pageup = last_redraw_block(full_after_pageup)
        ok(SCROLL_INDICATOR in screen_after_pageup, "PageUp scrolls the view and shows the scrolled-up indicator")
        rows_after_pageup = parse_redraw_rows(screen_after_pageup)

        session.write("/cat file_a.txt\r")
        session.settle(0.3, 2.0)
        full_after_new_content = text(bytes(session.raw))
        screen_after_new_content = last_redraw_block(full_after_new_content)
        ok(SCROLL_INDICATOR in screen_after_new_content, "the scrolled-up indicator stays up after new content arrives in the background")
        rows_after_new_content = parse_redraw_rows(screen_after_new_content)
        same_view = [strip_sgr(c) for (_, c) in rows_after_pageup] == [strip_sgr(c) for (_, c) in rows_after_new_content]
        ok(same_view, "the scrolled-up view does not move when new content arrives while scrolled")

        for _ in range(6):
            session.write(b"\x1b[6~")
            session.settle(0.15, 1.0)
        full_after_pagedown = text(bytes(session.raw))
        screen_after_pagedown = last_redraw_block(full_after_pagedown)
        ok(SCROLL_INDICATOR not in screen_after_pagedown, "PageDown all the way back down drops the scrolled-up indicator")
        ok("FILE_A_LINE_050" in strip_sgr(screen_after_pagedown), "PageDown resumes auto-follow and shows the newly arrived content")

        for _ in range(3):
            session.write(WHEEL_UP)
            session.settle(0.15, 1.0)
        screen_after_wheel_up = last_redraw_block(text(bytes(session.raw)))
        ok(SCROLL_INDICATOR in screen_after_wheel_up, "SGR wheel-up events scroll the view and show the scrolled-up indicator (ticket #82)")

        for _ in range(5):
            session.write(WHEEL_DOWN)
            session.settle(0.15, 1.0)
        screen_after_wheel_down = last_redraw_block(text(bytes(session.raw)))
        ok(SCROLL_INDICATOR not in screen_after_wheel_down, "SGR wheel-down events return to the bottom and drop the indicator (ticket #82)")
        ok("FILE_A_LINE_050" in strip_sgr(screen_after_wheel_down), "wheel-down all the way resumes auto-follow at the live view (ticket #82)")

        session.write(MOUSE_CLICK)
        session.settle(0.2, 1.0)
        session.write("q")
        session.settle(0.2, 1.5)
        screen_after_click = last_redraw_block(text(bytes(session.raw)))
        rows_after_click = parse_redraw_rows(screen_after_click)
        input_rows = [strip_sgr(c) for (_, c) in rows_after_click if "> " in strip_sgr(c)]
        ok(any(r.endswith("> q") for r in input_rows), "a mouse click press+release pair is consumed silently, the next typed character lands alone on the input row (ticket #82)")
        session.write("\x7f")
        session.settle(0.2, 1.0)

        session.resize(15, 60)
        session.write("z")
        session.write("\x7f")
        session.settle(0.2, 1.5)
        full_after_resize = text(bytes(session.raw))
        screen_after_resize = last_redraw_block(full_after_resize)
        rows_after_resize = parse_redraw_rows(screen_after_resize)
        max_row = max((r for (r, _) in rows_after_resize), default=0)
        ok(max_row <= 15, "a redraw after resizing to 15 rows never addresses a row past the new height, got max row %d" % max_row)

        session.write("\x04")
        exited = session.wait_exit(5.0)
        ok(exited, "joule exits cleanly on ctrl-d")
        session._pump(0.5)

        full_text = text(bytes(session.raw))
        check_zero_newlines(full_text)
        check_cursor_monotonic(full_text)
        check_color_bleed(full_text)
        check_mouse_teardown(full_text, "ctrl-d")

    finally:
        if session is not None:
            session.close()
        try:
            stub_proc.terminate()
            stub_proc.wait(timeout=3)
        except Exception:
            try:
                stub_proc.kill()
            except Exception:
                pass
        shutil.rmtree(work_dir, ignore_errors=True)


def main():
    if not os.path.exists(JOULE_BIN):
        print("terminal_structural_harness: %s not found, run make build first" % JOULE_BIN, file=sys.stderr)
        sys.exit(1)
    if not os.path.exists(STUB_BIN):
        print("terminal_structural_harness: %s not found, run make bin/stub_model first" % STUB_BIN, file=sys.stderr)
        sys.exit(1)

    start = time.time()
    try:
        run_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_ctrl_c_exit_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_approval_arrow_key_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_approval_number_key_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    elapsed = time.time() - start
    print("terminal structural harness finished in %dms" % int(elapsed * 1000))
    if failures:
        print("%d check(s) failed: %s" % (len(failures), "; ".join(failures)), file=sys.stderr)
        sys.exit(1)
    print("terminal structural harness passed")


if __name__ == "__main__":
    main()
