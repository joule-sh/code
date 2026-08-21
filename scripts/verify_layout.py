# Real-pty verification for the startup welcome box and the persistent status
# bar (ticket #63). Reuses terminal_structural_harness.py's PtySession and
# redraw-parsing helpers rather than duplicating them. Checks box/status-bar
# content and row placement at several terminal sizes, including ones
# narrower and shorter than the 80x24 default, since a hardcoded assumption
# about box width or row count is an easy way to break this on a real,
# varied user terminal.

import os
import sys
import tempfile
import shutil
import subprocess
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

def u(s):
    return s.encode("utf-8").decode("latin1")

CORNER_TL = u("┌")
CORNER_BL = u("└")
SCROLLED_UP_SHORT = "scrolled up"

def run_case(rows, cols, label_suffix, wait_full_banner):
    work_dir = tempfile.mkdtemp(prefix="joule-layout-verify-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)

    stub_port = harness.free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = os.path.join(work_dir, "stub_requests.log")
    stub_proc = subprocess.Popen([harness.STUB_BIN], env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    session = None
    try:
        if not harness.wait_for_port(stub_port, 5.0):
            raise harness.Failure("stub model server did not start")
        joule_env = dict(os.environ)
        joule_env["HOME"] = home_dir
        joule_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
        joule_env["JOULE_CODE_MODEL"] = "stub-model-xyz"
        joule_env["JOULE_CODE_API_KEY"] = ""
        joule_env["TERM"] = "xterm-256color"

        session = harness.PtySession([harness.JOULE_BIN], joule_env, repo_dir, rows=rows, cols=cols)
        if wait_full_banner:
            session.wait_for(harness.BANNER, timeout=10.0)
        else:
            session.wait_for("auto-edit", timeout=10.0)
        session.settle(0.2, 1.5)

        full = harness.text(bytes(session.raw))

        ok("stub-model-xyz" in full, "welcome box shows the configured model" + label_suffix)
        ok("auto-edit" in full, "welcome box shows the current approval mode" + label_suffix)

        box_fits_in_viewport = (rows - 2) >= 11
        if box_fits_in_viewport:
            ok(CORNER_TL in full, "a top-left box corner was drawn" + label_suffix)
        else:
            print("skip: terminal too short for the whole box to be in view at once, checking the bottom edge only" + label_suffix)
        ok(CORNER_BL in full, "a bottom-left box corner was drawn" + label_suffix)

        screen1 = harness.last_redraw_block(full)
        rows1 = harness.parse_redraw_rows(screen1)
        status_rows_1 = [c for (_, c) in rows1 if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows_1) == 1, "exactly one status-bar row is present right after startup" + label_suffix)
        ok(any("/help" in harness.strip_sgr(c) for (_, c) in rows1 if "mode:" in harness.strip_sgr(c)), "the status bar shows the help hint at startup" + label_suffix)
        ok(any("auto-edit" in harness.strip_sgr(c) for (_, c) in rows1 if "mode:" in harness.strip_sgr(c)), "the status bar shows the current mode at startup" + label_suffix)

        max_row_1 = max((r for (r, _) in rows1), default=0)
        ok(max_row_1 <= rows, "no row of the startup redraw exceeds the terminal height" + label_suffix + (" (max row %d, height %d)" % (max_row_1, rows)))

        session.write("hello there")
        session.settle(0.2, 1.0)
        full_after_typing = harness.text(bytes(session.raw))
        screen_after_typing = harness.last_redraw_block(full_after_typing)
        rows_after_typing = harness.parse_redraw_rows(screen_after_typing)
        status_rows_2 = [c for (_, c) in rows_after_typing if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows_2) == 1, "exactly one status-bar row is present after typing" + label_suffix)

        session.write("\r")
        session.wait_for('-> read', timeout=10.0)
        session.wait_for(harness.APPROVAL_MARKER, timeout=10.0)
        session.write("y")
        session.wait_for("Done.", timeout=15.0)
        session.settle(0.3, 2.0)
        full_after_turn = harness.text(bytes(session.raw))

        screen_after_turn = harness.last_redraw_block(full_after_turn)
        rows_after_turn = harness.parse_redraw_rows(screen_after_turn)
        status_rows_3 = [c for (_, c) in rows_after_turn if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows_3) == 1, "exactly one status-bar row is present after a tool call" + label_suffix)
        max_row_3 = max((r for (r, _) in rows_after_turn), default=0)
        ok(max_row_3 <= rows, "no row of the post-turn redraw exceeds the terminal height" + label_suffix + (" (max row %d, height %d)" % (max_row_3, rows)))

        for _ in range(3):
            session.write(b"\x1b[5~")
            session.settle(0.15, 1.0)
        full_after_scroll = harness.text(bytes(session.raw))
        screen_after_scroll = harness.last_redraw_block(full_after_scroll)
        rows_after_scroll = harness.parse_redraw_rows(screen_after_scroll)
        status_rows_4 = [c for (_, c) in rows_after_scroll if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows_4) == 1, "exactly one status-bar row is present after scrolling" + label_suffix)
        ok(any(SCROLLED_UP_SHORT in harness.strip_sgr(c) for (_, c) in rows_after_scroll), "the scroll indicator still shows up above the status bar and input row" + label_suffix)

        session.write("\x04")
        exited = session.wait_exit(5.0)
        ok(exited, "joule exits cleanly on ctrl-d" + label_suffix)

        full_final = harness.text(bytes(session.raw))
        newline_count = full_final.count("\n")
        ok(newline_count == 0, "zero raw newline bytes in the full captured stream" + label_suffix + (" (got %d)" % newline_count))
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

def check_box_appended_once():
    path = os.path.join(REPO_ROOT, "src", "terminal", "terminal.ts")
    with open(path) as f:
        src = f.read()
    call_count = src.count("buildWelcomeBox(")
    ok(call_count == 1, "buildWelcomeBox is called exactly once in terminal.ts, at startup, so the box is appended to scrollback a single time regardless of how many times drawScreen repaints it while it stays in view (got %d call sites)" % call_count)

check_box_appended_once()

cases = [
    (24, 80, " [80x24 default]", True),
    (24, 40, " [40x24 narrow]", False),
    (10, 80, " [80x10 short]", True),
    (12, 45, " [45x12 narrow+short]", False),
]
for (rows, cols, suffix, wait_full) in cases:
    print("=== rows=%d cols=%d ===" % (rows, cols))
    try:
        run_case(rows, cols, suffix, wait_full)
    except harness.Failure as e:
        print("FAIL: " + str(e) + suffix, file=sys.stderr)
        failures.append(str(e) + suffix)

if failures:
    print("%d check(s) failed" % len(failures), file=sys.stderr)
    for f in failures:
        print(" - " + f, file=sys.stderr)
    sys.exit(1)
print("all layout verification checks passed")
