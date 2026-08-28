# Real-pty verification for the startup welcome box and the persistent status
# bar (ticket #63). Reuses terminal_structural_harness.py's PtySession and
# redraw-parsing helpers rather than duplicating them. Checks box/status-bar
# content and row placement at several terminal sizes, including ones
# narrower and shorter than the 80x24 default, since a hardcoded assumption
# about box width or row count is an easy way to break this on a real,
# varied user terminal.

import os
import sys
import shutil
import subprocess
import importlib.util
import scratch

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

# #113: mirrors input_box.ts's own rule (see MIN_ROWS_FOR_BOX there) so this
# script's row math for the panel and the welcome-box viewport check stays
# correct instead of hardcoding the old one-row-prompt assumption. Below the
# threshold the prompt degrades to the plain "> " row it has always been; at
# or above it, it is a three-row bordered box. The two short cases below,
# 80x10 and 45x12, land one on each side of this line on purpose so both
# branches of the rule get exercised here too.
MIN_ROWS_FOR_BOX = 12

def prompt_rows_for(term_rows):
    return 3 if term_rows >= MIN_ROWS_FOR_BOX else 1

def bottom_rows_text(full_text, height, n=3):
    """The stripped content of the last `n` rows of the latest redraw, in
    top-to-bottom order, keyed by position rather than content - unlike
    input_row() this does not skip border rows, so it can tell a box border
    apart from the plain prompt by where each row sits."""
    by_row = {}
    for (row, cell) in harness.parse_redraw_rows(harness.last_redraw_block(full_text)):
        by_row[row] = harness.strip_sgr(cell).rstrip()
    return [by_row.get(row, "") for row in range(max(1, height - n + 1), height + 1)]
# #94: long tool output collapses to a head plus a marker, and ctrl-o expands
# it in place. A large expansion is the hard case for row accounting on a short
# terminal, so every size here drives it while the approval prompt is up, which
# is also where the recorded option rows of #89/#96 are most exposed.
CTRL_O = b"\x0f"
COLLAPSE_MARKER_RE = harness.COLLAPSE_MARKER_RE
LAST_README_LINE = "README_LINE_%03d" % harness.LONG_README_LINES

def run_case(rows, cols, label_suffix, wait_full_banner):
    work_dir = scratch.scratch_dir("joule-layout-verify-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)
    harness.seed_long_readme(repo_dir)

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
        joule_env["JOULE_CODE_API_KEY"] = "stub-key"  # non-empty so the first-run wizard (#46) does not trigger; the stub model does not check it
        joule_env["TERM"] = "xterm-256color"

        session = harness.PtySession([harness.JOULE_BIN], joule_env, repo_dir, rows=rows, cols=cols)
        if wait_full_banner:
            session.wait_for(harness.BANNER, timeout=10.0)
        else:
            session.wait_for("safe-auto", timeout=10.0)
        session.settle(0.2, 1.5)

        full = harness.text(bytes(session.raw))

        ok("stub-model-xyz" in full, "welcome box shows the configured model" + label_suffix)
        ok("safe-auto" in full, "welcome box shows the current approval mode" + label_suffix)

        prompt_rows = prompt_rows_for(rows)
        box_fits_in_viewport = (rows - 1 - prompt_rows) >= 11
        if box_fits_in_viewport:
            ok(CORNER_TL in full, "a top-left box corner was drawn" + label_suffix)
        else:
            print("skip: terminal too short for the whole box to be in view at once, checking the bottom edge only" + label_suffix)
        ok(CORNER_BL in full, "a bottom-left box corner was drawn" + label_suffix)

        # #113: state and test the row-budget degrade rule directly - the
        # input box is three rows at or above MIN_ROWS_FOR_BOX, and the
        # plain single "> " row below it. Looked at by position (the exact
        # last three rows of the terminal) rather than by content, so this
        # cannot be satisfied by the welcome box's own border, which sits
        # higher up in the transcript.
        bottom3 = bottom_rows_text(full, rows)
        if prompt_rows == 3:
            ok(bottom3[0].startswith(CORNER_TL), "at %d rows (at or above the %d row box threshold) the input box's top border is the row right above its content row" % (rows, MIN_ROWS_FOR_BOX) + label_suffix)
            ok(bottom3[2].startswith(CORNER_BL), "the input box's bottom border is the terminal's very last row" + label_suffix)
        else:
            ok(not bottom3[2].startswith(CORNER_TL) and not bottom3[2].startswith(CORNER_BL), "at %d rows (below the %d row box threshold) the prompt degrades to the plain row, not a box border" % (rows, MIN_ROWS_FOR_BOX) + label_suffix)
        ok(harness.input_row(full, rows) == ">", "the prompt carries just the bare marker right after startup, box or plain" + label_suffix)

        screen1 = harness.last_redraw_block(full)
        rows1 = harness.parse_redraw_rows(screen1)
        status_rows_1 = [c for (_, c) in rows1 if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows_1) == 1, "exactly one status-bar row is present right after startup" + label_suffix)
        ok(any("/help" in harness.strip_sgr(c) for (_, c) in rows1 if "mode:" in harness.strip_sgr(c)), "the status bar shows the help hint at startup" + label_suffix)
        ok(any("safe-auto" in harness.strip_sgr(c) for (_, c) in rows1 if "mode:" in harness.strip_sgr(c)), "the status bar shows the current mode at startup" + label_suffix)

        max_row_1 = max((r for (r, _) in rows1), default=0)
        ok(max_row_1 <= rows, "no row of the startup redraw exceeds the terminal height" + label_suffix + (" (max row %d, height %d)" % (max_row_1, rows)))

        # #83: the completion panel eats rows above the status bar. It must fit
        # the terminal at every size, and where it cannot fit at all it has to
        # step aside rather than push a row off the bottom.
        session.write("/")
        session.settle(0.2, 1.5)
        full_panel = harness.text(bytes(session.raw))
        panel_names = harness.completion_names(full_panel)
        rows_panel = harness.parse_redraw_rows(harness.last_redraw_block(full_panel))
        max_row_panel = max((r for (r, _) in rows_panel), default=0)
        ok(max_row_panel <= rows, "no row of the completion-panel redraw exceeds the terminal height" + label_suffix + (" (max row %d, height %d)" % (max_row_panel, rows)))
        ok(len(panel_names) > 0, "the completion panel opens on a bare slash" + label_suffix + (" (got %d rows)" % len(panel_names)))
        # #113: with the box present, its own top border is the separator
        # directly under the panel, so the panel leaves out the rule it
        # would otherwise draw there itself - two horizontal lines back to
        # back would be a redundant, competing border.
        if prompt_rows == 3:
            ok(len(harness.rule_rows(full_panel)) == 0, "the completion panel leaves out its own rule once the input box's top border is the separator underneath it" + label_suffix)
            ok(len(harness.box_top_border_rows(full_panel)) == 1, "the input box's top border is drawn as the single separator between the panel and the box" + label_suffix)
            # the box's top border is one of the box's own three rows,
            # already subtracted out via prompt_rows below - the panel is
            # not spending a row of its own budget on it.
            separator_rows = 0
        else:
            ok(len(harness.rule_rows(full_panel)) == 1, "the completion panel draws exactly one horizontal rule" + label_suffix)
            separator_rows = 1
        status_rows_panel = [c for (_, c) in rows_panel if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows_panel) == 1, "exactly one status-bar row is present while the completion panel is open" + label_suffix)
        ok(len(panel_names) + separator_rows <= rows - 1 - prompt_rows, "the panel leaves the status bar, the input row(s) and at least one transcript row alone" + label_suffix + (" (%d panel rows, height %d, prompt rows %d)" % (len(panel_names) + separator_rows, rows, prompt_rows)))

        session.resize(4, cols)
        session.write("x")
        session.write("\x7f")
        session.settle(0.2, 1.5)
        full_squeezed = harness.text(bytes(session.raw))
        rows_squeezed = harness.parse_redraw_rows(harness.last_redraw_block(full_squeezed))
        max_row_squeezed = max((r for (r, _) in rows_squeezed), default=0)
        ok(max_row_squeezed <= 4, "a terminal with no room for the panel drops it instead of addressing a row past the height" + label_suffix + (" (max row %d)" % max_row_squeezed))
        ok(len(harness.completion_rows(full_squeezed)) == 0, "the panel is not drawn at all when the terminal is too short to hold it" + label_suffix)
        session.resize(rows, cols)
        session.write("\x7f")
        session.settle(0.2, 1.5)

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
        session.settle(0.2, 1.5)

        # #88: the option list adds rows to the prompt. They have to all land
        # on screen, and inside the terminal, at every size we support. The
        # labels themselves are clipped at narrow widths, so only the row
        # structure is asserted here, not the label text.
        full_at_approval = harness.text(bytes(session.raw))
        option_rows = harness.check_option_list_complete(full_at_approval, "the approval option list" + label_suffix)
        ok(harness.highlighted_option(option_rows) == 1, "the first approval option is the highlighted one" + label_suffix)

        rows_at_approval = harness.parse_redraw_rows(harness.last_redraw_block(full_at_approval))
        max_row_approval = max((r for (r, _) in rows_at_approval), default=0)
        ok(max_row_approval <= rows, "no row of the approval redraw exceeds the terminal height" + label_suffix + (" (max row %d, height %d)" % (max_row_approval, rows)))
        status_rows_approval = [c for (_, c) in rows_at_approval if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows_approval) == 1, "exactly one status-bar row is present while the approval prompt is up" + label_suffix)

        screen_collapsed = harness.strip_sgr(harness.last_redraw_block(full_at_approval))
        ok(COLLAPSE_MARKER_RE.search(screen_collapsed) is not None, "the long read tool.result is collapsed to a marker row" + label_suffix)
        ok(LAST_README_LINE not in screen_collapsed, "the hidden tail of the collapsed output is off screen" + label_suffix)

        session.write(CTRL_O)
        session.settle(0.3, 2.0)
        full_expanded = harness.text(bytes(session.raw))
        screen_expanded = harness.strip_sgr(harness.last_redraw_block(full_expanded))
        ok(LAST_README_LINE in screen_expanded, "ctrl-o expands the group and brings its hidden tail on screen" + label_suffix)
        ok(COLLAPSE_MARKER_RE.search(screen_expanded) is None, "the collapsed marker is gone once the group is expanded" + label_suffix)
        rows_expanded = harness.parse_redraw_rows(harness.last_redraw_block(full_expanded))
        max_row_expanded = max((r for (r, _) in rows_expanded), default=0)
        ok(max_row_expanded <= rows, "no row of the expanded redraw exceeds the terminal height" + label_suffix + (" (max row %d, height %d)" % (max_row_expanded, rows)))
        status_rows_expanded = [c for (_, c) in rows_expanded if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows_expanded) == 1, "exactly one status-bar row is present while a group is expanded" + label_suffix)
        options_expanded = harness.approval_option_rows(full_expanded)
        ok([r["number"] for r in options_expanded] == [1, 2, 3], "the approval option rows stay whole and in order while a group above them is expanded" + label_suffix)

        session.write(CTRL_O)
        session.settle(0.3, 2.0)
        full_recollapsed = harness.text(bytes(session.raw))
        screen_recollapsed = harness.strip_sgr(harness.last_redraw_block(full_recollapsed))
        ok(COLLAPSE_MARKER_RE.search(screen_recollapsed) is not None, "ctrl-o collapses the group again" + label_suffix)
        ok(LAST_README_LINE not in screen_recollapsed, "the hidden tail goes back off screen when the group is collapsed again" + label_suffix)
        rows_recollapsed = harness.parse_redraw_rows(harness.last_redraw_block(full_recollapsed))
        max_row_recollapsed = max((r for (r, _) in rows_recollapsed), default=0)
        ok(max_row_recollapsed <= rows, "no row of the recollapsed redraw exceeds the terminal height" + label_suffix + (" (max row %d, height %d)" % (max_row_recollapsed, rows)))
        status_rows_recollapsed = [c for (_, c) in rows_recollapsed if "mode:" in harness.strip_sgr(c)]
        ok(len(status_rows_recollapsed) == 1, "exactly one status-bar row is present after collapsing again" + label_suffix)
        options_recollapsed = harness.approval_option_rows(full_recollapsed)
        ok([r["number"] for r in options_recollapsed] == [1, 2, 3], "the approval option rows are still whole and in order after collapsing again" + label_suffix)

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
        # #171 gave the structural harness this; the same reasoning applies here,
        # and this script needs it more. Each case starts a daemon that outlives
        # the pty, registered under a HOME that is about to be deleted, so nothing
        # ever stops it and it squats a port in the 400 port range until the box is
        # rebuilt. Four cases per run is how a runner ends up carrying a hundred of
        # them, and a later run that hashes onto one of those ports reaches a
        # stranger instead of a daemon of its own.
        harness.reap_daemon(work_dir)
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
