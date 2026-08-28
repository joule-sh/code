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
import json
import os
import re
import select
import shutil
import signal
import socket
import struct
import sys
import termios
import time
import scratch

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
MOUSE_ENABLE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h"
MOUSE_DISABLE = "\x1b[?1006l\x1b[?1002l\x1b[?1000l"
WHEEL_UP = b"\x1b[<64;10;5M"
WHEEL_DOWN = b"\x1b[<65;10;5M"
MOUSE_CLICK = b"\x1b[<0;5;5M\x1b[<0;5;5m"
OSC52_PREFIX = "\x1b]52;c;"
BEL = "\x07"
SELECTING_MARKER = "-- selecting "
COPIED_MARKER = "-- copied "
ASKED_MARKER = "-- asked the terminal for "
# #282: joule writes the clipboard itself where it can, and only falls back to
# asking the terminal over OSC 52 where it cannot. Every scenario here runs
# with no display and no ssh variables, which is the fallback case, so what it
# drives is the OSC 52 path deliberately rather than by accident - a runner
# that happens to have DISPLAY set would otherwise change what these assert.
# The clipboard is actually read back in scripts/verify_clipboard_pty.py.
NO_CLIPBOARD_ENV = ["DISPLAY", "WAYLAND_DISPLAY", "SSH_CONNECTION", "SSH_TTY"]


def mouse_press(row, col):
    return ("\x1b[<0;%d;%dM" % (col, row)).encode()


def mouse_drag(row, col):
    return ("\x1b[<32;%d;%dM" % (col, row)).encode()


def mouse_release(row, col):
    return ("\x1b[<0;%d;%dm" % (col, row)).encode()

TOOL_CALL_MARKER = "  -> "
TOOL_RESULT_OK_MARKER = "     ok:"
TOOL_RESULT_FAIL_MARKER = "     failed:"
APPROVAL_MARKER = "  ? "
ERROR_MARKER = "! "
RUN_TOOL_CALL_MARKER = '-> run {"command":'

ARROW_UP = b"\x1b[A"
ARROW_DOWN = b"\x1b[B"
TAB = b"\t"
BACKSPACE = b"\x7f"
# #83: a completion panel row is an optional marker cursor, the command name
# padded into its own column, then the description. Matched with the SGR
# stripped, and required to carry the two-space column gap so the input row
# ("> /model") can never be mistaken for one.
COMPLETION_ROW_RE = re.compile(r"^(>|\s)\s(/[a-z]+)\s\s")
RULE_CHAR = "\u2500".encode("utf-8").decode("latin1")
REVERSE_SEQ = "\x1b[7m"
# One row of the approval option list (#88): an optional marker cursor, the
# list position, then the label. Matched against the row with its SGR stripped,
# so it holds at narrow widths where the label itself is clipped.
APPROVAL_OPTION_RE = re.compile(r"^\s*(>|\s)\s*([123])\. (.*?)\s*$")
APPROVAL_ALWAYS_LABEL_PREFIX = "Yes, and don't ask again for "
# The marker an open option list draws on the row the keys would confirm.
APPROVAL_MARKER_CURSOR = "> 1. "
# #297: an answered approval collapses to one settled line naming what was
# asked and how it was decided. The decision is anchored at the end of the
# row on purpose: scrollback lines are clipped to the terminal's width rather
# than wrapped, so a settled line that outran 80 columns would lose exactly
# this half, and would then match nothing here.
SETTLED_DECISIONS = (
    "allowed",
    "allowed, and not asked again this session",
    "denied",
    "allowed by the session's approval mode",
)
APPROVAL_SETTLED_RE = re.compile(
    r"^\s*\? (.+?) - (" + "|".join(re.escape(d) for d in SETTLED_DECISIONS) + r")$"
)
CTRL_O = b"\x0f"
# #94: long tool output is collapsed to a head plus a marker naming how many
# rows are hidden, and ctrl-o toggles it. Matched with the SGR stripped, since
# the marker is dim.
COLLAPSE_MARKER_RE = re.compile(r"\.\.\. \+(\d+) lines")
EXPANDED_MARKER_RE = re.compile(r"\.\.\. (\d+) more lines")
LONG_README_LINES = 60

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
            self._close_master()
            return
        try:
            os.kill(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        if not self.wait_exit(2.0):
            # Close the master before the kill, and bound the wait after it.
            # A child that is blocked writing into a pty nobody is reading is
            # not in a state a signal alone gets it out of everywhere, and the
            # blocking waitpid this used to do then never returned - a harness
            # that hangs in its own teardown reports nothing about what it had
            # already found (#282).
            self._close_master()
            try:
                os.kill(self.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.wait_exit(5.0)
        self._close_master()

    def _close_master(self):
        if self.master_fd < 0:
            return
        try:
            os.close(self.master_fd)
        except OSError:
            pass
        self.master_fd = -1


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


def completion_rows(full_text):
    """The slash-command completion panel's entry rows in the latest redraw (#83)."""
    out = []
    for (_, cell) in parse_redraw_rows(last_redraw_block(full_text)):
        m = COMPLETION_ROW_RE.match(strip_sgr(cell))
        if m is None:
            continue
        out.append({"marked": m.group(1) == ">", "name": m.group(2)})
    return out


def completion_names(full_text):
    return [r["name"] for r in completion_rows(full_text)]


def marked_completion(full_text):
    """The single marked command name in the panel, or "" if not exactly one."""
    marked = [r["name"] for r in completion_rows(full_text) if r["marked"]]
    return marked[0] if len(marked) == 1 else ""


def rule_rows(full_text):
    """Rows made up only of the horizontal-rule glyph, so box borders do not count."""
    out = []
    for (_, cell) in parse_redraw_rows(last_redraw_block(full_text)):
        bare = strip_sgr(cell).rstrip()
        if len(bare) > 0 and bare.replace(RULE_CHAR, "") == "":
            out.append(bare)
    return out


BOX_CORNER_TL = "┌".encode("utf-8").decode("latin1")
BOX_CORNER_TR = "┐".encode("utf-8").decode("latin1")


def box_top_border_rows(full_text):
    """Rows that are the input box's own top border (#113): a top-left
    corner, a run of the rule glyph, and a top-right corner, nothing else."""
    out = []
    for (_, cell) in parse_redraw_rows(last_redraw_block(full_text)):
        bare = strip_sgr(cell).rstrip()
        if bare.startswith(BOX_CORNER_TL) and bare.endswith(BOX_CORNER_TR):
            middle = bare[len(BOX_CORNER_TL):len(bare) - len(BOX_CORNER_TR)]
            if middle.replace(RULE_CHAR, "") == "":
                out.append(bare)
    return out


# A CSI escape sequence in general, not just the SGR (`m`) ones strip_sgr
# handles: the real terminal cursor (#113) is repositioned with a trailing
# `ESC [ row ; col H` plus a show-cursor sequence after the last row of
# every redraw, at a column other than 1, so it does not register as a row
# boundary to parse_redraw_rows and instead reads as trailing bytes glued
# onto whatever the last-drawn row was. strip_sgr alone leaves those bytes
# behind; stripping every CSI sequence removes them too.
ANSI_CSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


def strip_ansi(s):
    return ANSI_CSI_RE.sub("", s)


# #113: the prompt is either the bare "> " row it has always been, or a
# three-row bordered box (top, content, bottom) once the terminal is tall
# enough. Either way, the row carrying the marker, the typed text and the
# cursor sits at or just above the terminal's last row - scanning down from
# the bottom for the first row that is not pure box-drawing border finds it
# without the caller needing to know which shape is on screen, and stripping
# the border and its padding leaves the same "> ..." shape callers already
# match on either way.
#
# The captured stream is decoded latin1 (one byte in, one character out, see
# text() above), so each of these glyphs - multi-byte in UTF-8 - has to be
# encoded and re-decoded the same way, or it will never match a byte of it.
def _u(glyph):
    return glyph.encode("utf-8").decode("latin1")


BOX_BORDER_CHARS = _u("┌") + _u("┐") + _u("└") + _u("┘") + _u("─") + _u("│")


def input_row(full_text, height):
    by_row = {}
    for (row, cell) in parse_redraw_rows(last_redraw_block(full_text)):
        by_row[row] = cell
    row = height
    while row > 0 and row > height - 3:
        cell = by_row.get(row)
        if cell is not None:
            bare = strip_ansi(cell).rstrip()
            inner = bare.strip(BOX_BORDER_CHARS + " ")
            if inner != "":
                return inner
        row -= 1
    return ""


def highlighted_option(option_rows):
    """The list position of the single highlighted row, or 0 if not exactly one."""
    lit = [r for r in option_rows if r["highlighted"] and r["marked"]]
    return lit[0]["number"] if len(lit) == 1 else 0


def approval_settled_rows(full_text):
    """The settled approval lines in the latest redraw, in transcript order (#297)."""
    out = []
    for (_, cell) in parse_redraw_rows(last_redraw_block(full_text)):
        m = APPROVAL_SETTLED_RE.match(strip_sgr(cell).rstrip())
        if m is None:
            continue
        out.append({"ask": m.group(1), "decision": m.group(2), "width": display_width(cell)})
    return out


def approval_option_labels(tool):
    """Every decision an open approval offers, in list order.

    This is where the old "exactly three rows" assertion went (#297). The open
    prompt has to offer each of these once and an answered one has to offer
    none of them, and the list's length is whatever this is - so neither check
    restates a row count that goes stale the day a decision is added or taken
    away, and neither one pins a fact about approvals in general that only ever
    held while the prompt was open.
    """
    return ["Yes", APPROVAL_ALWAYS_LABEL_PREFIX + tool + " this session", "No"]


def check_option_list_complete(full_text, label):
    """The open option list is whole on screen, without saying how long it is.

    A narrow terminal clips the labels at the right edge, so only the ends of
    the list are named: it starts at the first decision and ends at the last
    one, numbered straight through, with one marker cursor somewhere on it.
    That catches a row the layout pushed off the screen or failed to repaint
    without restating a row count, which was only ever a fact about the open
    state and stopped being true of approvals in general with #297.
    """
    rows = approval_option_rows(full_text)
    numbers = [r["number"] for r in rows]
    ok(numbers == list(range(1, len(rows) + 1)), label + ": the option rows on screen run 1 upwards with no gaps, got %r" % numbers)
    ends = approval_option_labels("")
    ok(len(rows) > 0 and rows[0]["label"] == ends[0], label + ": the list starts at the first decision, got %r" % [r["label"] for r in rows[:1]])
    ok(len(rows) > 0 and rows[-1]["label"] == ends[-1], label + ": the list ends at the last decision, got %r" % [r["label"] for r in rows[-1:]])
    ok(len([r for r in rows if r["marked"]]) == 1, label + ": exactly one option row carries the marker cursor")
    return rows


def check_approval_open(full_text, tool, label):
    """Assert an approval is drawn open: the whole menu, one cursor, no verdict."""
    rows = check_option_list_complete(full_text, label)
    labels = [r["label"] for r in rows]
    ok(labels == approval_option_labels(tool), label + ": an open approval offers each decision once, in list order, got %r" % labels)
    ok(len([r for r in rows if r["highlighted"]]) == 1, label + ": exactly one option row is drawn in reverse video")
    ok(approval_settled_rows(full_text) == [], label + ": an approval still waiting for an answer has settled nothing")
    return rows


def check_approval_option_list(session, tool, label):
    """Assert the shape of a freshly rendered, not yet answered, option list."""
    session.settle(0.3, 2.0)
    rows = check_approval_open(text(bytes(session.raw)), tool, label)
    if len(rows) == len(approval_option_labels(tool)):
        ok(highlighted_option(rows) == 1, label + ": option 1 is the highlighted one before any key is pressed")
    return rows


def check_approval_settled(full_text, tool, decisions, cols, label):
    """Assert answered approvals left settled lines and no menu at all (#297)."""
    rows = approval_option_rows(full_text)
    ok(rows == [], label + ": an answered approval leaves no option rows on screen, got %r" % [r["label"] for r in rows])
    screen = strip_sgr(last_redraw_block(full_text))
    ok(APPROVAL_ALWAYS_LABEL_PREFIX not in screen, label + ": the wording of an option a reader can no longer take is gone from the transcript")
    ok(APPROVAL_MARKER_CURSOR not in screen, label + ": no marker cursor is left reading as though something is still waiting on it")
    settled = approval_settled_rows(full_text)
    ok([r["decision"] for r in settled] == decisions, label + ": the settled lines record how each approval was decided, got %r" % [r["decision"] for r in settled])
    for r in settled:
        ok(r["ask"].startswith(tool + " ["), label + ": a settled line still records what was asked, got %r" % r["ask"])
        ok(r["width"] <= cols, label + ": a settled line fits the %d column terminal, got %d" % (cols, r["width"]))
    return settled


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


def check_mouse_teardown(full_text, exit_text, exit_label, reporting_on):
    disable_idx = exit_text.rfind(MOUSE_DISABLE)
    exit_idx = exit_text.rfind(ALT_EXIT)
    ok(exit_idx >= 0, "the alt screen exit sequence appears in the byte stream on %s exit" % exit_label)
    if reporting_on:
        ok(disable_idx >= 0, "the mouse reporting disable sequences (1006l+1002l+1000l) appear in the byte stream on %s exit (ticket #82)" % exit_label)
        ok(disable_idx >= 0 and exit_idx >= 0 and disable_idx < exit_idx, "mouse reporting is disabled before the alt screen exits on %s exit (ticket #82)" % exit_label)
    else:
        ok(disable_idx < 0, "with mouse reporting off there is nothing to disable on %s exit, so nothing is written and the pair stays balanced" % exit_label)
    enables = full_text.count(MOUSE_ENABLE)
    disables = full_text.count(MOUSE_DISABLE)
    ok(enables == disables, "every mouse reporting enable in the %s session is paired with a disable, got %d enables and %d disables" % (exit_label, enables, disables))


def config_path(home_dir):
    return os.path.join(home_dir, ".config", "joule-code", "config.json")


def seed_config(home_dir, **fields):
    os.makedirs(os.path.dirname(config_path(home_dir)), exist_ok=True)
    with open(config_path(home_dir), "w") as f:
        json.dump(fields, f)


def read_config(home_dir):
    if not os.path.exists(config_path(home_dir)):
        return {}
    with open(config_path(home_dir)) as f:
        return json.load(f)


def start_ctrl_c_session():
    """A bare joule on a workspace of its own - no stub model, because these
    scenarios never run a turn, they only leave."""
    work_dir = scratch.scratch_dir("joule-terminal-harness-ctrlc-")
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
    return work_dir, PtySession([JOULE_BIN], joule_env, repo_dir, rows=24, cols=80)


def daemon_port_of(work_dir):
    """The port the daemon serving this scenario's workspace registered under
    its own HOME - read from the record joule writes, so the check below is
    about the daemon itself and not about what any command says.

    Asking `joule --stop` instead would be a race: a daemon that is already
    winding down still answers, and still reports as one this command stopped.
    """
    import glob
    found = glob.glob(os.path.join(work_dir, "home", ".config", "joule-code", "daemon", "*.json"))
    if not found:
        return 0
    with open(found[0]) as f:
        return int(json.load(f).get("port", 0))


def wait_port_closed(port, timeout_s):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.settimeout(0.2)
            s.connect(("127.0.0.1", port))
        except OSError:
            return True
        finally:
            s.close()
        time.sleep(0.1)
    return False


def run_ctrl_c_exit_scenario():
    work_dir, session = start_ctrl_c_session()
    try:
        session.wait_for(BANNER, timeout=10.0)
        port = daemon_port_of(work_dir)
        ok(port > 0, "the session this ctrl-c is about is running in a daemon, got port %r" % port)
        pre_exit_idx = len(session.raw)
        session.write("\x03")
        session.wait_for("what should happen to this session", timeout=5.0)
        ok(True, "ctrl-c on an empty input line opens the keep-or-quit prompt instead of exiting outright")
        session.write("q")
        exited = session.wait_exit(10.0)
        ok(exited, "choosing quit at the ctrl-c prompt exits cleanly")
        session._pump(0.5)
        check_mouse_teardown(text(bytes(session.raw)), text(bytes(session.raw[pre_exit_idx:])), "ctrl-c", True)
        ok(wait_port_closed(port, 20.0), "quitting really ended the session: the daemon on port %d stops answering" % port)
    finally:
        if session is not None:
            session.close()
        reap_daemon(work_dir)
        shutil.rmtree(work_dir, ignore_errors=True)


def run_ctrl_c_keep_scenario():
    """The other answer: keeping the session hands it to the background rather
    than ending it, and says how to get back to it."""
    work_dir, session = start_ctrl_c_session()
    try:
        session.wait_for(BANNER, timeout=10.0)
        port = daemon_port_of(work_dir)
        ok(port > 0, "the session this ctrl-c is about is running in a daemon, got port %r" % port)
        pre_exit_idx = len(session.raw)
        session.write("\x03")
        session.wait_for("what should happen to this session", timeout=5.0)
        session.write("k")
        exited = session.wait_exit(10.0)
        ok(exited, "choosing keep at the ctrl-c prompt leaves the terminal")
        session._pump(0.5)
        tail = strip_sgr(text(bytes(session.raw[pre_exit_idx:])))
        ok("running in the background" in tail, "it says the session is now running in the background, got %r" % tail[-200:])
        ok(("127.0.0.1:%d" % port) in tail, "it names the daemon the session was left with")
        ok("joule --stop" in tail, "it says how to end the session it left running")
        check_mouse_teardown(text(bytes(session.raw)), text(bytes(session.raw[pre_exit_idx:])), "ctrl-c keep", True)
        ok(not wait_port_closed(port, 2.0), "keeping it left the daemon on port %d answering, not stopped" % port)
    finally:
        if session is not None:
            session.close()
        reap_daemon(work_dir)
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


def seed_long_readme(repo_dir):
    """A README long enough that reading it trips the #94 collapse threshold."""
    lines = ["# demo", "", "No health route yet."]
    lines += ["README_LINE_%03d of padding" % i for i in range(1, LONG_README_LINES + 1)]
    with open(os.path.join(repo_dir, "README.md"), "w") as f:
        f.write("\n".join(lines))


def start_stub_session(prefix, rows=24, cols=80, script="", env_extra=None, env_drop=None):
    """A fresh workspace, stub model, and joule pty session.

    The stub's scripted step counter lives in the stub process, so a scenario
    that needs its own approval prompt needs its own stub alongside it.
    """
    import subprocess
    work_dir = scratch.scratch_dir(prefix)
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    seed_workspace(repo_dir)

    stub_port = free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = os.path.join(work_dir, "stub_requests.log")
    stub_env["E2E_STUB_SCRIPT"] = script
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
    for name in (env_drop or []):
        joule_env.pop(name, None)
    joule_env.update(env_extra or {})
    return work_dir, stub_proc, PtySession([JOULE_BIN], joule_env, repo_dir, rows=rows, cols=cols)


def reap_daemon(work_dir, home_dir=None):
    """Stop the daemon this scenario started, before its workspace goes away.

    Each scenario runs joule in work_dir/repo with HOME set to work_dir/home, and
    joule starts a daemon that outlives the pty the scenario closes. The daemon picks
    its port by hashing the workspace path into a 400 port range, and it registers
    itself under HOME, so a daemon left over from an earlier scenario is invisible to
    the next scenario's port-collision check and simply squats a port. A later
    scenario that hashes onto that port reaches a stranger rather than a daemon of its
    own, and then reports something other than what the scenario asserts on.

    joule --stop is the product's own path for this: it reads the info file, refuses
    to stop a daemon that is serving a different workspace, and waits for the
    acknowledgement.
    """
    repo_dir = os.path.join(work_dir, "repo")
    if home_dir is None:
        home_dir = os.path.join(work_dir, "home")
    if not os.path.isdir(repo_dir):
        return
    env = dict(os.environ)
    env["HOME"] = home_dir
    import subprocess
    try:
        subprocess.run(
            [JOULE_BIN, "--stop"],
            cwd=repo_dir, env=env, timeout=20,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


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
    reap_daemon(work_dir)
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
        check_approval_settled(text(bytes(session.raw)), "run", ["denied"], session.cols, "a denied approval")

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
        check_approval_settled(text(bytes(session.raw)), "run", ["allowed, and not asked again this session"], session.cols, "an approval answered with the always option")

        rows_after = parse_redraw_rows(last_redraw_block(text(bytes(session.raw))))
        input_rows = [strip_sgr(c).rstrip() for (_, c) in rows_after if strip_sgr(c).rstrip() == ">" or strip_sgr(c).rstrip().endswith("> 2")]
        ok(all(r == ">" for r in input_rows), "the number key is consumed by the prompt rather than typed into the input line")

        check_clean_exit_invariants(session, "number-key approval")
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)


RESUME_HEADER = "resumed previous session"
NO_PREVIOUS_SESSION = "no previous session found for this workspace"


def run_settled_approval_scenario():
    """#297: the three decision kinds settle into three different lines.

    "Yes", "yes, and don't ask again", and an approval the session's own mode
    satisfied without ever asking are separate facts, and the console records
    exactly that distinction. The always answer is what raises the third: the
    turn's second run call meets a session that already decided, so no prompt
    is ever drawn for it, and the only trace it leaves is its settled line.
    """
    work_dir = None
    stub_proc = None
    session = None
    try:
        work_dir, stub_proc, session = start_stub_session("joule-terminal-harness-settled-", script="always")
        drive_to_approval(session)
        check_approval_option_list(session, "run", "the first approval of an always-answered turn")

        session.write("2")
        session.wait_for("Done.", timeout=20.0)
        session.settle(0.4, 3.0)
        full_text = text(bytes(session.raw))
        settled = check_approval_settled(
            full_text, "run",
            ["allowed, and not asked again this session", "allowed by the session's approval mode"],
            session.cols,
            "an always answer and the call it went on to settle without asking",
        )
        if len(settled) == 2:
            ok(settled[0]["ask"] != settled[1]["ask"], "each settled line records the call it settled, not a repeat of the first")
        ok(strip_sgr(last_redraw_block(full_text)).count(RUN_TOOL_CALL_MARKER) == 2, "both run calls of the turn actually fired, so the mode-satisfied line is not describing a call that never happened")
        check_no_row_overflows(full_text, session.cols, "settled approvals")

        check_clean_exit_invariants(session, "settled approval")
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)


def run_resume_scenario():
    """#85: --continue replays a prior turn's history into the transcript at startup."""
    work_dir = scratch.scratch_dir("joule-terminal-harness-resume-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    seed_workspace(repo_dir)

    stub_port = free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = os.path.join(work_dir, "stub_requests.log")
    import subprocess
    stub_proc = subprocess.Popen([STUB_BIN], env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    first = None
    second = None
    third = None
    try:
        if not wait_for_port(stub_port, 5.0):
            raise Failure("stub model server did not start")

        joule_env = dict(os.environ)
        joule_env["HOME"] = home_dir
        joule_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
        joule_env["JOULE_CODE_MODEL"] = "stub"
        joule_env["JOULE_CODE_API_KEY"] = "stub-key"
        joule_env["TERM"] = "xterm-256color"

        first = PtySession([JOULE_BIN], joule_env, repo_dir, rows=24, cols=80)
        first.wait_for(BANNER, timeout=10.0)
        first.write("add a health note\r")
        first.wait_for(APPROVAL_MARKER, timeout=10.0)
        first.write("y")
        first.wait_for("Done.", timeout=15.0)
        first.settle(0.3, 2.0)
        check_clean_exit_invariants(first, "resume: first session before exit")

        second = PtySession([JOULE_BIN, "--continue"], joule_env, repo_dir, rows=24, cols=80)
        second.wait_for(BANNER, timeout=10.0)
        second.settle(0.3, 2.0)
        resumed_text = text(bytes(second.raw))
        ok(RESUME_HEADER in resumed_text, "--continue prints a resumed-session banner in the transcript on startup")
        ok("add a health note" in resumed_text, "--continue replays the prior turn's user prompt into the transcript before any new input")
        ok("Done." in resumed_text, "--continue replays the prior turn's assistant reply into the transcript")
        check_clean_exit_invariants(second, "resume: second session after --continue")

        empty_work_dir = scratch.scratch_dir("joule-terminal-harness-resume-empty-")
        empty_repo_dir = os.path.join(empty_work_dir, "repo")
        seed_workspace(empty_repo_dir)
        empty_env = dict(joule_env)
        third = PtySession([JOULE_BIN, "--continue"], empty_env, empty_repo_dir, rows=24, cols=80)
        third.wait_for(BANNER, timeout=10.0)
        third.settle(0.3, 2.0)
        no_prior_text = text(bytes(third.raw))
        ok(NO_PREVIOUS_SESSION in no_prior_text, "--continue in a workspace with no saved session says so instead of silently starting fresh")
        check_clean_exit_invariants(third, "resume: --continue with no prior session for this workspace")
    finally:
        for session in (first, second, third):
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
        # both workspaces ran under work_dir/home, so both daemons registered
        # themselves there: reap them before that HOME is removed.
        reap_daemon(work_dir)
        try:
            reap_daemon(empty_work_dir, os.path.join(work_dir, "home"))
        except NameError:
            pass
        shutil.rmtree(work_dir, ignore_errors=True)
        try:
            shutil.rmtree(empty_work_dir, ignore_errors=True)
        except NameError:
            pass


def run_completion_panel_scenario():
    """#83: typing a slash opens the completion panel, and the arrow keys drive it."""
    work_dir = None
    stub_proc = None
    session = None
    try:
        work_dir, stub_proc, session = start_stub_session("joule-terminal-harness-completion-")
        session.wait_for(BANNER, timeout=10.0)
        session.settle(0.2, 1.5)

        before = text(bytes(session.raw))
        ok(len(completion_rows(before)) == 0, "no completion panel is drawn before anything is typed")

        session.write("/")
        session.settle(0.2, 1.5)
        opened = text(bytes(session.raw))
        names = completion_names(opened)
        ok(len(names) >= 8, "a bare slash opens the panel listing every command, got %d rows" % len(names))
        for expected in ("/help", "/model", "/mode", "/share", "/cat", "/tasks", "/skills", "/clear"):
            ok(expected in names, "the panel lists %s when the buffer is a bare slash" % expected)
        # How much of the list is on screen when the panel opens is whatever
        # fits the rows it has room for, which moves every time a command is
        # added or removed. What holds either way: narrowing filters to the
        # commands sharing the typed prefix, and backspacing brings back
        # exactly the panel the bare slash first showed.
        session.write("e")
        session.settle(0.2, 1.5)
        narrowed_e = completion_names(text(bytes(session.raw)))
        ok(len(narrowed_e) > 0 and all(n.startswith("/e") for n in narrowed_e), "narrowing to /e leaves only commands starting with /e, got %r" % narrowed_e)
        ok("/exit" in narrowed_e, "narrowing to /e reaches /exit, wherever it sat in the opened panel")
        session.write(BACKSPACE)
        session.settle(0.2, 1.5)
        ok(completion_names(text(bytes(session.raw))) == names, "backspacing to a bare slash reopens the same panel the bare slash first showed")
        # #113: at this session's default 24 rows the input box is in play,
        # and its own top border sits directly under the panel, so the panel
        # leaves out the rule it would otherwise draw there itself (#101)
        # rather than stacking two horizontal lines back to back.
        ok(len(rule_rows(opened)) == 0, "the panel leaves out its own rule once the input box's top border is the separator underneath it")
        ok(len(box_top_border_rows(opened)) == 1, "the input box's top border is the single separator between the panel and the box, in place of a second rule")
        ok(marked_completion(opened) == "/help", "the first match carries the marker cursor when the panel opens")
        ok(input_row(opened, session.rows).endswith("> /"), "the typed slash is still on the input row under the panel")

        session.write("mo")
        session.settle(0.2, 1.5)
        narrowed = text(bytes(session.raw))
        ok(completion_names(narrowed) == ["/model", "/mode", "/mouse"], "typing mo narrows the panel to the commands starting with /mo, got %r" % completion_names(narrowed))
        ok(marked_completion(narrowed) == "/model", "the marker resets to the first match as the list narrows")

        session.write(ARROW_DOWN)
        session.settle(0.2, 1.5)
        ok(marked_completion(text(bytes(session.raw))) == "/mode", "arrow down moves the panel marker to the next match")

        session.write(ARROW_DOWN)
        session.settle(0.2, 1.5)
        ok(marked_completion(text(bytes(session.raw))) == "/mouse", "arrow down carries on to the last match")

        session.write(ARROW_DOWN)
        session.settle(0.2, 1.5)
        ok(marked_completion(text(bytes(session.raw))) == "/mouse", "arrow down at the end of the list stays put rather than wrapping")

        session.write(ARROW_UP)
        session.settle(0.2, 1.5)
        ok(marked_completion(text(bytes(session.raw))) == "/mode", "arrow up moves the panel marker back up the list")

        session.write(ARROW_UP)
        session.settle(0.2, 1.5)
        ok(marked_completion(text(bytes(session.raw))) == "/model", "arrow up keeps walking back up the list")

        session.write(TAB)
        session.settle(0.2, 1.5)
        completed = text(bytes(session.raw))
        ok(input_row(completed, session.rows).endswith("> /model"), "Tab completes the marked entry into the input buffer, got %r" % input_row(completed, session.rows))
        ok(completion_names(completed) == ["/model"], "the panel narrows to the completed command and stays open")

        session.write(BACKSPACE * 6)
        session.settle(0.2, 1.5)
        closed = text(bytes(session.raw))
        ok(len(completion_rows(closed)) == 0, "backspacing the slash away closes the panel")
        ok(len(rule_rows(closed)) == 0, "the horizontal rule goes away with the panel")

        session.write("/mode\r")
        session.wait_for("mode: safe-auto", timeout=10.0)
        session.settle(0.2, 1.5)
        ran = text(bytes(session.raw))
        ok(len(completion_rows(ran)) == 0, "submitting the completed command closes the panel")
        ok("mode: safe-auto" in strip_sgr(last_redraw_block(ran)), "Enter with the panel open runs the command as usual")

        session.write("add a health note\r")
        session.wait_for(APPROVAL_MARKER, timeout=10.0)
        check_approval_option_list(session, "run", "an approval prompt raised after the panel has been used")
        session.write(ARROW_DOWN)
        session.settle(0.2, 1.5)
        ok(highlighted_option(approval_option_rows(text(bytes(session.raw)))) == 2, "the approval prompt still takes the arrow keys after the completion panel has been open (#89/#96 regression check)")
        session.write("\r")
        session.wait_for("Done.", timeout=15.0)
        session.settle(0.3, 2.0)

        session.write(ARROW_UP)
        session.settle(0.2, 1.5)
        recalled = text(bytes(session.raw))
        ok(input_row(recalled, session.rows).endswith("> add a health note"), "with the panel closed the arrow keys still recall input history, got %r" % input_row(recalled, session.rows))
        ok(len(completion_rows(recalled)) == 0, "a recalled history entry that is not a slash command leaves the panel closed")

        session.write(ARROW_UP)
        session.settle(0.2, 1.5)
        ok(input_row(text(bytes(session.raw)), session.rows).endswith("> add a health note"), "a second arrow up stays in history recall rather than jumping into a panel")

        session.write("\x03")
        session.settle(0.2, 1.5)
        check_clean_exit_invariants(session, "completion panel")
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)


def run_collapse_scenario():
    """#94: long tool output collapses, ctrl-o expands it, and doing that while a
    real approval prompt is up must leave the #89/#96 option rows repaintable."""
    work_dir = None
    stub_proc = None
    session = None
    try:
        work_dir, stub_proc, session = start_stub_session("joule-collapse-harness-")
        seed_long_readme(os.path.join(work_dir, "repo"))
        session.wait_for(BANNER, timeout=10.0)
        session.write("add a health note\r")
        session.wait_for(APPROVAL_MARKER, timeout=10.0)
        session.settle(0.3, 2.0)

        collapsed_screen = strip_sgr(last_redraw_block(text(bytes(session.raw))))
        marker = COLLAPSE_MARKER_RE.search(collapsed_screen)
        ok(marker is not None, "a long read tool.result collapses to a row naming the hidden line count")
        hidden = int(marker.group(1)) if marker else 0
        ok(hidden >= 40, "the collapsed marker counts every hidden row of a %d line file, got +%d" % (LONG_README_LINES, hidden))
        ok("ctrl-o" in collapsed_screen, "the collapsed marker names the key that expands it")
        ok("README_LINE_001" in collapsed_screen, "the head of the collapsed output stays on screen")
        last_line = "README_LINE_%03d" % LONG_README_LINES
        ok(last_line not in collapsed_screen, "the tail of the collapsed output is off screen while it is collapsed")

        check_approval_open(text(bytes(session.raw)), "run", "an approval beside a collapsed group")

        session.write(CTRL_O)
        session.settle(0.3, 2.0)
        expanded_full = text(bytes(session.raw))
        expanded_screen = strip_sgr(last_redraw_block(expanded_full))
        ok(EXPANDED_MARKER_RE.search(expanded_screen) is not None or last_line in expanded_screen, "ctrl-o expands the collapsed group")
        ok(last_line in expanded_screen, "expanding brings the previously hidden tail of the output on screen")
        ok(COLLAPSE_MARKER_RE.search(expanded_screen) is None, "the collapsed marker is gone once the group is expanded")

        rows_expanded = parse_redraw_rows(last_redraw_block(expanded_full))
        max_row_expanded = max((r for (r, _) in rows_expanded), default=0)
        ok(max_row_expanded <= session.rows, "no row of the expanded redraw addresses past the terminal height, got max row %d of %d" % (max_row_expanded, session.rows))

        check_approval_open(expanded_full, "run", "an approval whose neighbouring group was expanded")

        session.write(ARROW_DOWN)
        session.settle(0.3, 2.0)
        moved = check_approval_open(text(bytes(session.raw)), "run", "an approval repainted while the group above it is expanded")
        ok(highlighted_option(moved) == 2, "the arrow keys still repaint the right approval rows while a group above them is expanded (#96 offsets)")

        session.write(CTRL_O)
        session.settle(0.3, 2.0)
        recollapsed_full = text(bytes(session.raw))
        recollapsed_screen = strip_sgr(last_redraw_block(recollapsed_full))
        ok(COLLAPSE_MARKER_RE.search(recollapsed_screen) is not None, "ctrl-o collapses the group again")
        ok(last_line not in recollapsed_screen, "the tail of the output goes back off screen when the group is collapsed again")
        recollapsed_options = approval_option_rows(recollapsed_full)
        ok(highlighted_option(recollapsed_options) == 2, "the approval highlight survives collapsing the group above it")

        session.write("\r")
        session.wait_for("Done.", timeout=15.0)
        session.settle(0.3, 2.0)
        after_turn = text(bytes(session.raw))
        ok("Done." in strip_sgr(last_redraw_block(after_turn)), "the turn finishes normally after the collapse and expand round trip")

        check_clean_exit_invariants(session, "collapsed tool output")
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)


def run_scenario():
    self_test_color_bleed_detector()

    work_dir = scratch.scratch_dir("joule-terminal-harness-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    seed_config(home_dir, mouse="on")
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
        ok(startup_text.find(MOUSE_ENABLE) == expected_mouse_idx, "with mouse: on in the config file, mouse reporting (1000h+1006h) is enabled immediately after entering the alt screen and hiding the cursor (ticket #82)")

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
        check_approval_settled(text(bytes(session.raw)), "run", ["allowed"], session.cols, "an approval granted with the y shortcut (#88 keeps y/n/a working)")
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
        ok(input_row(text(bytes(session.raw)), session.rows).endswith("> q"), "a mouse click press+release pair is consumed silently, the next typed character lands alone on the input row (ticket #82)")
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

        pre_exit_idx = len(session.raw)
        session.write("\x04")
        exited = session.wait_exit(5.0)
        ok(exited, "joule exits cleanly on ctrl-d")
        session._pump(0.5)

        full_text = text(bytes(session.raw))
        check_zero_newlines(full_text)
        check_cursor_monotonic(full_text)
        check_color_bleed(full_text)
        check_mouse_teardown(full_text, text(bytes(session.raw[pre_exit_idx:])), "ctrl-d", True)

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
        reap_daemon(work_dir)
        shutil.rmtree(work_dir, ignore_errors=True)


def run_mouse_setting_scenario():
    """#170: reporting is on out of the box now that joule does the selecting
    itself, and /mouse off is still there for anyone who wants their emulator's
    own selection back."""
    work_dir = None
    stub_proc = None
    session = None
    try:
        work_dir, stub_proc, session = start_stub_session("joule-terminal-harness-mouse-", env_drop=NO_CLIPBOARD_ENV)
        home_dir = os.path.join(work_dir, "home")
        session.wait_for(BANNER, timeout=10.0)
        session.settle(0.2, 1.5)

        startup_text = text(bytes(session.raw))
        alt_idx = startup_text.find(ALT_ENTER)
        ok(alt_idx >= 0, "joule with no config file still enters the alt screen at startup")
        ok(startup_text.find(HIDE_CURSOR) == alt_idx + len(ALT_ENTER), "the cursor hide still follows the alt screen enter with nothing between them")
        expected_mouse_idx = alt_idx + len(ALT_ENTER) + len(HIDE_CURSOR)
        ok(startup_text.find(MOUSE_ENABLE) == expected_mouse_idx, "with no config file at all, mouse reporting (1000h+1002h+1006h) is enabled right after the alt screen, because joule now does the selecting itself (#170)")

        session.write("/cat file_a.txt\r")
        session.wait_for("FILE_A_LINE_050", timeout=10.0)
        session.settle(0.2, 1.5)

        for _ in range(3):
            session.write(WHEEL_UP)
            session.settle(0.15, 1.0)
        ok(SCROLL_INDICATOR in last_redraw_block(text(bytes(session.raw))), "out of the box the wheel scrolls the transcript, with nothing to turn on first (#170)")

        for _ in range(5):
            session.write(WHEEL_DOWN)
            session.settle(0.15, 1.0)
        ok(SCROLL_INDICATOR not in last_redraw_block(text(bytes(session.raw))), "wheel-down all the way returns to the live view")

        for _ in range(3):
            session.write(b"\x1b[5~")
            session.settle(0.15, 1.0)
        ok(SCROLL_INDICATOR in last_redraw_block(text(bytes(session.raw))), "PageUp still scrolls the transcript with reporting on, which is what the status line promises (#157)")

        for _ in range(6):
            session.write(b"\x1b[6~")
            session.settle(0.15, 1.0)
        ok(SCROLL_INDICATOR not in last_redraw_block(text(bytes(session.raw))), "PageDown returns to the live view")

        session.write("/mouse\r")
        session.settle(0.3, 2.0)
        state_screen = strip_sgr(last_redraw_block(text(bytes(session.raw))))
        ok("mouse reporting on" in state_screen, "/mouse with no argument says which state it is in")
        ok("OSC 52" in state_screen, "/mouse names the mechanism the copy will really travel over here - no clipboard command on this box, so OSC 52 (#282)")
        ok("clipboard command" in state_screen, "and says why, rather than presenting OSC 52 as the only thing joule knows how to do")

        before_off = len(session.raw)
        session.write("/mouse off\r")
        session.settle(0.3, 2.0)
        turned_off = text(bytes(session.raw[before_off:]))
        ok(MOUSE_DISABLE in turned_off, "/mouse off writes the disable sequences (1006l+1002l+1000l) back to the live terminal")
        ok("mouse reporting off" in strip_sgr(last_redraw_block(text(bytes(session.raw)))), "/mouse off says so in the transcript")
        ok(read_config(home_dir).get("mouse") == "off", "/mouse off writes the setting to the config file, so the next run starts with it")

        before_on = len(session.raw)
        session.write("/mouse on\r")
        session.settle(0.3, 2.0)
        turned_on = text(bytes(session.raw[before_on:]))
        ok(MOUSE_ENABLE in turned_on, "/mouse on writes the enable sequences (1000h+1002h+1006h) back to the terminal it is already running in")
        ok(read_config(home_dir).get("mouse") == "on", "/mouse on writes that back to the config file too")

        pre_exit_idx = len(session.raw)
        session.write("\x04")
        exited = session.wait_exit(5.0)
        ok(exited, "joule exits cleanly on ctrl-d after the mouse setting has been toggled")
        session._pump(0.5)

        full_text = text(bytes(session.raw))
        check_zero_newlines(full_text)
        check_cursor_monotonic(full_text)
        check_color_bleed(full_text)
        check_mouse_teardown(full_text, text(bytes(session.raw[pre_exit_idx:])), "ctrl-d with reporting toggled back on", True)
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)


def file_a_rows(full_text):
    return [row for (row, cell) in parse_redraw_rows(last_redraw_block(full_text)) if "FILE_A_LINE_" in strip_sgr(cell)]


def row_text(full_text, wanted):
    for (row, cell) in parse_redraw_rows(last_redraw_block(full_text)):
        if row == wanted:
            return strip_sgr(cell)
    return None


def reversed_rows(block):
    return [row for (row, cell) in parse_redraw_rows(block) if REVERSE_SEQ in cell]


def osc52_payloads(segment):
    out = []
    idx = 0
    while True:
        start = segment.find(OSC52_PREFIX, idx)
        if start < 0:
            return out
        end = segment.find(BEL, start)
        if end < 0:
            return out
        out.append(segment[start + len(OSC52_PREFIX):end])
        idx = end + 1


def drag_over(session, top_row, bottom_row, cols):
    session.write(mouse_press(top_row, 1))
    session.settle(0.2, 1.0)
    session.write(mouse_drag(bottom_row, cols))
    session.settle(0.2, 1.5)


def run_mouse_selection_scenario():
    """#170: with reporting on, joule does the selecting itself. A drag over the
    transcript highlights the rows it covers and says so in words, the release
    hands exactly those rows to the clipboard, the wheel keeps scrolling
    throughout, and /mouse off takes the whole thing away again.

    This session has no display and no ssh variables, so there is no clipboard
    command for joule to run and OSC 52 is the only mechanism left - which is
    what makes the payload assertions below meaningful. That the clipboard
    itself ends up holding the text is a different claim, and the one #282 was
    about; scripts/verify_clipboard_pty.py reads it back to make it."""
    import base64
    work_dir = None
    stub_proc = None
    session = None
    try:
        work_dir, stub_proc, session = start_stub_session("joule-terminal-harness-select-", env_drop=NO_CLIPBOARD_ENV)
        session.wait_for(BANNER, timeout=10.0)
        session.write("/cat file_a.txt\r")
        session.wait_for("FILE_A_LINE_050", timeout=10.0)
        session.settle(0.3, 2.0)

        rows = file_a_rows(text(bytes(session.raw)))
        ok(len(rows) >= 4, "the transcript is showing enough /cat output to drag across, got %d rows" % len(rows))
        if len(rows) < 4:
            raise Failure("not enough transcript rows to run the selection scenario")
        top_row, bottom_row = rows[-4], rows[-2]

        drag_over(session, top_row, bottom_row, session.cols)
        drag_block = last_redraw_block(text(bytes(session.raw)))
        highlighted = reversed_rows(drag_block)
        ok(highlighted == list(range(top_row, bottom_row + 1)), "a press and drag puts every row it covers into reverse video and no others, wanted rows %d..%d, got %r" % (top_row, bottom_row, highlighted))
        ok(SELECTING_MARKER in strip_sgr(drag_block), "while the drag is live the screen says how much is selected in words, so the highlight is not the only signal (colour degrades)")

        session.write(WHEEL_UP)
        session.settle(0.2, 1.5)
        during = last_redraw_block(text(bytes(session.raw)))
        ok(SCROLL_INDICATOR in during, "the wheel still scrolls the transcript while a drag is in progress (#170 keeps #82 working)")
        ok(SELECTING_MARKER in strip_sgr(during), "the selection survives the view scrolling underneath it, because it is anchored to transcript lines and not to screen rows")
        for _ in range(4):
            session.write(WHEEL_DOWN)
            session.settle(0.15, 1.0)
        ok(SCROLL_INDICATOR not in last_redraw_block(text(bytes(session.raw))), "wheel-down returns to the live view with the drag still held")

        session.write(mouse_drag(bottom_row, session.cols))
        session.settle(0.2, 1.5)
        pre_release = text(bytes(session.raw))
        covered = [row_text(pre_release, r) for r in range(top_row, bottom_row + 1)]
        ok(all(r is not None for r in covered), "every row the selection covers is on the screen the release will copy from")
        expected = "\n".join(covered)

        release_idx = len(session.raw)
        session.write(mouse_release(bottom_row, session.cols))
        session.settle(0.3, 2.0)
        released = text(bytes(session.raw[release_idx:]))

        payloads = osc52_payloads(released)
        ok(len(payloads) == 1, "the release writes exactly one OSC 52 clipboard sequence, got %d" % len(payloads))
        want = base64.b64encode(expected.encode("latin1")).decode("ascii")
        ok(payloads and payloads[0] == want, "the OSC 52 payload is the base64 of exactly the rows the drag covered")
        ok((OSC52_PREFIX + want + BEL) in released, "the clipboard write is a well-formed OSC 52: ESC ] 52 ; c ; <base64> BEL")
        if payloads:
            ok(base64.b64decode(payloads[0]).decode("latin1") == expected, "and it decodes back to the selected text, line breaks and all")

        copied_screen = strip_sgr(last_redraw_block(text(bytes(session.raw))))
        ok(ASKED_MARKER in copied_screen, "after the release the screen says what happened, in words")
        ok(COPIED_MARKER not in copied_screen, "and does not claim a copy that only a terminal could have completed, because OSC 52 has no reply to wait on (#282)")
        ok("/mouse off" in copied_screen, "and names the way out")
        ok(reversed_rows(last_redraw_block(text(bytes(session.raw)))) == list(range(top_row, bottom_row + 1)), "the copied range stays highlighted until it is cleared")

        session.write(b"\x1b")
        session.settle(0.4, 2.0)
        cleared = last_redraw_block(text(bytes(session.raw)))
        ok(not reversed_rows(cleared), "Escape clears the highlight")
        ok(ASKED_MARKER not in strip_sgr(cleared), "and takes the copy note away with it")

        for _ in range(3):
            session.write(WHEEL_UP)
            session.settle(0.15, 1.0)
        ok(SCROLL_INDICATOR in last_redraw_block(text(bytes(session.raw))), "the wheel still scrolls after a selection has been made and cleared")
        for _ in range(5):
            session.write(WHEEL_DOWN)
            session.settle(0.15, 1.0)

        session.write("/mouse off\r")
        session.settle(0.3, 2.0)
        off_idx = len(session.raw)
        off_rows = file_a_rows(text(bytes(session.raw)))
        ok(len(off_rows) >= 4, "there is still /cat output on screen to try dragging over with reporting off")
        if len(off_rows) >= 4:
            drag_over(session, off_rows[-4], off_rows[-2], session.cols)
            session.write(mouse_release(off_rows[-2], session.cols))
            session.settle(0.3, 2.0)
            off_segment = text(bytes(session.raw[off_idx:]))
            ok(not osc52_payloads(off_segment), "with /mouse off a press, drag and release copy nothing at all")
            off_block = last_redraw_block(text(bytes(session.raw)))
            ok(not reversed_rows(off_block), "and no row on screen is highlighted")
            off_screen = strip_sgr(off_block)
            ok(SELECTING_MARKER not in off_screen and ASKED_MARKER not in off_screen, "and the selection indicator is absent entirely, so the whole feature is gone")

        session.resize(15, 45)
        session.write("z")
        session.write("\x7f")
        session.settle(0.2, 1.5)
        session.write("/mouse on\r")
        session.settle(0.3, 2.0)
        narrow_rows = file_a_rows(text(bytes(session.raw)))
        if len(narrow_rows) >= 3:
            drag_over(session, narrow_rows[-3], narrow_rows[-1], session.cols)
            narrow_block = last_redraw_block(text(bytes(session.raw)))
            ok(SELECTING_MARKER in strip_sgr(narrow_block), "a 45 column terminal still says a selection is live rather than dropping the row")
            max_row = max((r for (r, _) in parse_redraw_rows(narrow_block)), default=0)
            ok(max_row <= 15, "the selection indicator never pushes a redraw past the terminal height, got max row %d" % max_row)
            session.write(mouse_release(narrow_rows[-1], session.cols))
            session.settle(0.3, 2.0)

        pre_exit_idx = len(session.raw)
        session.write("\x04")
        exited = session.wait_exit(5.0)
        ok(exited, "joule exits cleanly on ctrl-d after a drag, a copy and a toggle")
        session._pump(0.5)

        full_text = text(bytes(session.raw))
        check_zero_newlines(full_text)
        check_cursor_monotonic(full_text)
        check_color_bleed(full_text, " (selection highlight)")
        check_mouse_teardown(full_text, text(bytes(session.raw[pre_exit_idx:])), "ctrl-d after a selection", True)
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)



WRAP_PROSE = (
    "I read the server and the handler it registers, and the only thing missing is a "
    "health route, so I will add one now and then run the whole test suite to be sure "
    "nothing else moved while I was in there."
)
WRAP_RUN_COMMAND = (
    "npm run build --silent && npm test -- --reporter=verbose --runInBand "
    "tests/health.spec.js tests/routes.spec.js"
)


def display_width(cell):
    plain = strip_ansi(cell).rstrip()
    try:
        return len(plain.encode("latin1").decode("utf-8"))
    except UnicodeDecodeError:
        return len(plain)


def squashed_screen(full_text):
    """Every painted row of the latest redraw, joined the way a wrap reads back.

    A wrapped row drops the space it broke on, so rejoining the rows with a
    single space puts a sentence spread over several rows back together. Any
    text a row lost to clipping instead of a wrap simply will not be there.
    """
    rows = [strip_ansi(c).strip() for (_, c) in parse_redraw_rows(last_redraw_block(full_text))]
    return re.sub(r"\s+", " ", " ".join(r for r in rows if r != ""))


def check_no_row_overflows(full_text, cols, label):
    widest = 0
    for (_, cell) in parse_redraw_rows(last_redraw_block(full_text)):
        widest = max(widest, display_width(cell))
    ok(widest <= cols, "no painted row is wider than the %d column terminal in the %s scenario, widest was %d" % (cols, label, widest))


def run_wrapped_transcript_scenario():
    """A line too long for the terminal wraps instead of losing its tail.

    Both halves of what the owner sees are here: the model's prose, which is
    one long line, and the approval prompt's command, which is another. The
    check is not that they are painted somewhere - it is that all of the text
    is still on screen once the rows are read back, which clipping cannot do.
    """
    work_dir = None
    stub_proc = None
    session = None
    try:
        work_dir, stub_proc, session = start_stub_session("joule-terminal-harness-wrap-", rows=30, script="wrap")
        session.wait_for(BANNER, timeout=10.0)
        session.write("add a health route\r")
        session.wait_for(APPROVAL_MARKER, timeout=15.0)
        session.settle(0.4, 6.0)
        full_text = text(bytes(session.raw))

        screen = squashed_screen(full_text)
        ok(WRAP_PROSE in screen, "the whole of a long assistant line is on screen, not clipped at the terminal's width")
        ok(WRAP_RUN_COMMAND in screen, "the whole of a long approval command is on screen, not clipped at the terminal's width")
        check_no_row_overflows(full_text, session.cols, "wrapped transcript")

        options = check_approval_open(full_text, "run", "an approval beside wrapped text")
        ok(highlighted_option(options) == 1, "the first approval option is still the highlighted one beside wrapped text")

        check_clean_exit_invariants(session, "wrapped transcript")
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)


def run_command_echo_scenario():
    """A slash command is echoed like a prompt, so its answer is not orphaned.

    #186 and before: `/model` printed a bare "model: <name>" line with nothing
    saying what asked for it, so asking twice read as one line duplicated.
    """
    work_dir = None
    stub_proc = None
    session = None
    try:
        work_dir, stub_proc, session = start_stub_session("joule-terminal-harness-echo-")
        session.wait_for(BANNER, timeout=10.0)
        session.write("/model\r")
        session.settle(0.4, 5.0)
        session.write("/model\r")
        session.settle(0.4, 5.0)
        full_text = text(bytes(session.raw))

        rows = [strip_ansi(c).strip() for (_, c) in parse_redraw_rows(last_redraw_block(full_text))]
        echoes = [r for r in rows if r == "> /model"]
        answers = [r for r in rows if r.startswith("model: ")]
        ok(len(echoes) == 2, "each /model is echoed into the transcript like a typed prompt, got %d echo row(s)" % len(echoes))
        ok(len(answers) == 2, "each /model prints its own answer, got %d answer row(s)" % len(answers))
        adjacent = any(rows[i] == rows[i + 1] and rows[i].startswith("model: ") for i in range(len(rows) - 1))
        ok(not adjacent, "two answers to /model never sit next to each other unattributed, which reads as one duplicated line")

        check_clean_exit_invariants(session, "command echo")
    finally:
        if work_dir is not None:
            stop_stub_session(work_dir, stub_proc, session)


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
        run_ctrl_c_keep_scenario()
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
    try:
        run_settled_approval_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_completion_panel_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_resume_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_collapse_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_mouse_setting_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_mouse_selection_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_wrapped_transcript_scenario()
    except Failure as e:
        print("FAIL: " + str(e), file=sys.stderr)
        failures.append(str(e))
    try:
        run_command_echo_scenario()
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
