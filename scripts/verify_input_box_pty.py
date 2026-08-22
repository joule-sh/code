# Live-pty verification for the bordered input box's real terminal cursor
# (#113): that it sits exactly where typing inserts, that it survives a
# resize (including crossing the box/plain degrade threshold), that the
# completion panel, thinking indicator and scroll indicator all still
# render correctly with the box present, and that the cursor is restored on
# exit. Reuses terminal_structural_harness.py's PtySession and redraw
# parsing rather than duplicating them - select.select() with a timeout is
# already how PtySession._pump reads, so a read here never blocks forever.

import os
import re
import sys
import shutil
import subprocess
import tempfile
import importlib.util

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("harness", os.path.join(REPO_ROOT, "scripts", "terminal_structural_harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

failures = []
def ok(cond, label):
    if cond:
        print("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr)

CURSOR_SHOW_RE = re.compile(r"\x1b\[(\d+);(\d+)H\x1b\[\?25h")
HIDE_CURSOR = harness.HIDE_CURSOR
SHOW_CURSOR = "\x1b[?25h"

def last_cursor_show(full_text):
    """The (row, col) of the most recent 'position, then reveal' cursor
    sequence in the stream - the real terminal cursor's last known place."""
    matches = list(CURSOR_SHOW_RE.finditer(full_text))
    if not matches:
        return None
    m = matches[-1]
    return (int(m.group(1)), int(m.group(2)))

def start(rows, cols):
    work_dir = tempfile.mkdtemp(prefix="joule-inputbox-pty-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)

    stub_port = harness.free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = os.path.join(work_dir, "stub_requests.log")
    stub_proc = subprocess.Popen([harness.STUB_BIN], env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not harness.wait_for_port(stub_port, 5.0):
        raise harness.Failure("stub model server did not start")

    joule_env = dict(os.environ)
    joule_env["HOME"] = home_dir
    joule_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    joule_env["JOULE_CODE_MODEL"] = "stub"
    joule_env["JOULE_CODE_API_KEY"] = "stub-key"
    joule_env["TERM"] = "xterm-256color"
    session = harness.PtySession([harness.JOULE_BIN], joule_env, repo_dir, rows=rows, cols=cols)
    return work_dir, stub_proc, session

def stop(work_dir, stub_proc, session):
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

def run():
    work_dir, stub_proc, session = start(24, 80)
    try:
        session.wait_for(harness.BANNER, timeout=10.0)
        session.settle(0.2, 1.5)

        # --- cursor tracks the insertion point, box mode (24 rows) ---
        full = harness.text(bytes(session.raw))
        pos = last_cursor_show(full)
        ok(pos is not None, "a real cursor position-and-reveal sequence follows the startup redraw")
        ok(pos == (23, 5), "on an empty buffer the cursor sits right after the box's '> ' marker, got %r" % (pos,))
        row = harness.input_row(full, session.rows)
        ok(row == ">", "the content row under that cursor is the bare marker, got %r" % row)

        session.write("hi")
        session.settle(0.2, 1.5)
        full = harness.text(bytes(session.raw))
        pos = last_cursor_show(full)
        ok(pos == (23, 7), "after typing 'hi' the cursor sits two columns further right, got %r" % (pos,))
        ok(harness.input_row(full, session.rows) == "> hi", "the box content row shows the typed text under the cursor")

        session.write("hello world")
        session.settle(0.2, 1.5)
        full = harness.text(bytes(session.raw))
        pos_after_more = last_cursor_show(full)
        ok(pos_after_more[0] == 23, "the cursor stays on the box's content row as more is typed")
        ok(pos_after_more[1] > pos[1], "the cursor keeps moving right as each character is appended")

        # --- the panel, thinking indicator and scroll indicator alongside the box ---
        session.write("\x7f" * len("hihello world"))
        session.settle(0.2, 1.0)
        session.write("/")
        session.settle(0.2, 1.5)
        full = harness.text(bytes(session.raw))
        ok(len(harness.completion_names(full)) > 0, "the completion panel still opens on a bare slash with the box present")
        ok(len(harness.box_top_border_rows(full)) == 1, "the box's top border still separates the panel from the box")
        pos_panel = last_cursor_show(full)
        ok(pos_panel is not None and pos_panel[0] == 23, "the real cursor still sits on the box's content row while the panel is open, got %r" % (pos_panel,))
        session.write("\x7f")
        session.settle(0.2, 1.0)

        pre_turn = len(session.raw)
        session.write("add a health note\r")
        session.wait_for(harness.APPROVAL_MARKER, timeout=10.0)
        session.settle(0.2, 1.5)
        full = harness.text(bytes(session.raw))
        ok(len(harness.approval_option_rows(full)) == harness.APPROVAL_OPTION_COUNT, "the approval option list still renders in full with the box present")
        session.write("y")
        session.wait_for("Done.", timeout=15.0)
        session.settle(0.3, 2.0)

        for _ in range(3):
            session.write(b"\x1b[5~")
            session.settle(0.15, 1.0)
        full = harness.text(bytes(session.raw))
        rows_scrolled = harness.parse_redraw_rows(harness.last_redraw_block(full))
        ok(any(harness.SCROLL_INDICATOR in harness.strip_sgr(c) for (_, c) in rows_scrolled), "the scroll indicator still renders above the box when scrolled up")
        status_rows = [c for (_, c) in rows_scrolled if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows) == 1, "the status bar still renders once, above the box, while scrolled")
        pos_scrolled = last_cursor_show(full)
        ok(pos_scrolled is not None and pos_scrolled[0] == 23, "the cursor still lands on the box's content row while scrolled up, got %r" % (pos_scrolled,))
        for _ in range(6):
            session.write(b"\x1b[6~")
            session.settle(0.15, 1.0)
        session.settle(0.2, 1.0)

        # --- the cursor survives a resize, including crossing the degrade threshold ---
        session.resize(12, 45)
        session.write("z")
        session.settle(0.2, 1.5)
        full = harness.text(bytes(session.raw))
        pos_45x12 = last_cursor_show(full)
        ok(pos_45x12 == (11, 6), "after resizing to 45x12 (still at the box threshold) the box content row and cursor column track the new size, got %r" % (pos_45x12,))
        ok(len(harness.box_top_border_rows(full)) >= 1, "the box is still drawn just above the degrade threshold after a resize")

        session.resize(10, 80)
        session.write("z")
        session.settle(0.2, 1.5)
        full = harness.text(bytes(session.raw))
        pos_10 = last_cursor_show(full)
        ok(pos_10 is not None and pos_10[0] == 10, "resizing below the box threshold moves the cursor back onto the terminal's very last row, got %r" % (pos_10,))
        row10 = harness.input_row(full, 10)
        ok(row10 == "> zz", "the degraded plain prompt keeps the buffer typed across the resize, got %r" % row10)

        session.resize(24, 80)
        session.write("\x7f\x7f")
        session.settle(0.2, 1.5)
        full = harness.text(bytes(session.raw))
        pos_back = last_cursor_show(full)
        ok(pos_back is not None and pos_back[0] == 23, "resizing back above the box threshold restores the box and its cursor row, got %r" % (pos_back,))

        # --- the cursor is restored (shown) on exit ---
        pre_exit = len(session.raw)
        session.write("\x04")
        exited = session.wait_exit(5.0)
        ok(exited, "joule exits cleanly on ctrl-d")
        session._pump(0.5)
        tail = harness.text(bytes(session.raw[pre_exit:]))
        show_idx = tail.rfind(SHOW_CURSOR)
        exit_idx = tail.rfind(harness.ALT_EXIT)
        ok(show_idx >= 0, "the cursor is explicitly shown again on exit")
        ok(exit_idx >= 0, "the alt screen exit sequence appears on exit")
        ok(show_idx >= 0 and exit_idx >= 0 and show_idx < exit_idx, "the cursor is restored before the alt screen exits, so it is visible in the shell again")

        harness.check_cursor_monotonic(harness.text(bytes(session.raw)))
        harness.check_color_bleed(harness.text(bytes(session.raw)))
    finally:
        stop(work_dir, stub_proc, session)

def run_ctrl_c_restores_cursor():
    work_dir, stub_proc, session = start(24, 80)
    try:
        session.wait_for(harness.BANNER, timeout=10.0)
        session.write("some text")
        session.settle(0.2, 1.0)
        session.write("\x03")
        session.settle(0.2, 1.0)
        full = harness.text(bytes(session.raw))
        ok(harness.input_row(full, session.rows) == ">", "ctrl-c with text in the buffer clears it rather than exiting")

        pre_exit = len(session.raw)
        session.write("\x03")
        exited = session.wait_exit(5.0)
        ok(exited, "ctrl-c on an empty buffer exits cleanly")
        session._pump(0.5)
        tail = harness.text(bytes(session.raw[pre_exit:]))
        ok(SHOW_CURSOR in tail, "the cursor is restored on a ctrl-c exit too")
    finally:
        stop(work_dir, stub_proc, session)

def run_slash_exit_restores_cursor():
    work_dir, stub_proc, session = start(24, 80)
    try:
        session.wait_for(harness.BANNER, timeout=10.0)
        pre_exit = len(session.raw)
        session.write("/exit\r")
        exited = session.wait_exit(5.0)
        ok(exited, "/exit exits cleanly")
        session._pump(0.5)
        tail = harness.text(bytes(session.raw[pre_exit:]))
        ok(SHOW_CURSOR in tail, "the cursor is restored on a /exit exit too")
    finally:
        stop(work_dir, stub_proc, session)

try:
    run()
except harness.Failure as e:
    print("FAIL: " + str(e), file=sys.stderr)
    failures.append(str(e))
try:
    run_ctrl_c_restores_cursor()
except harness.Failure as e:
    print("FAIL: " + str(e), file=sys.stderr)
    failures.append(str(e))
try:
    run_slash_exit_restores_cursor()
except harness.Failure as e:
    print("FAIL: " + str(e), file=sys.stderr)
    failures.append(str(e))

if failures:
    print("%d check(s) failed" % len(failures), file=sys.stderr)
    for f in failures:
        print(" - " + f, file=sys.stderr)
    sys.exit(1)
print("all live-pty input box checks passed")
