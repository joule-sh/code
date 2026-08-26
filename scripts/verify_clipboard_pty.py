#!/usr/bin/env python3
# #282: mouse copy has to reach the system clipboard, not merely emit an escape
# sequence asking the terminal to write one. Emitting the escape is exactly
# what already "worked" while the feature did not, so every check here reads
# the clipboard back with the platform's own paste command and compares it to
# the rows that were dragged over.
#
# Four sessions of the real binary under a real pty:
#
#   local        a display and a clipboard command    -> clipboard holds the
#                                                        text, no OSC 52
#   tool gone    a PATH with no clipboard command      -> OSC 52, clipboard
#                                                        untouched
#   remote       SSH_CONNECTION set, command present   -> OSC 52, clipboard
#                                                        untouched, because the
#                                                        clipboard that matters
#                                                        is at the far end
#   dead display a clipboard command that will fail    -> nothing claimed
#
# On Linux the display is an Xvfb this script starts and stops, and the paste
# command is xclip; on macOS it is the desktop the runner already has, and
# pbcopy/pbpaste. The dead-display case is Linux-only: it needs a DISPLAY that
# parses and does not answer, which macOS has no equivalent of.
#
# The clipboard is read while the session that wrote it is still on screen,
# because that is when a person pastes, and because an X selection lives in the
# process that owns it rather than in the server.
#
# Every session here is started with nothing else running, so joule starts its
# own daemon, on both platforms. That shape produced zero bytes on macOS until
# #281 fixed the spawn that held the client's pipe, which is why this could not
# have been written this way a day earlier.
#
# Zero-dependency: stdlib only, and the pty machinery is the terminal
# structural harness's own rather than a second copy of it.

import faulthandler
import os
import shutil
import subprocess
import sys
import time

# Line buffering, because a run that has to be killed still has to say how far
# it got: block-buffered output on a CI pipe is thrown away with the process,
# and a step that times out having printed nothing is not diagnosable.
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scratch
import terminal_structural_harness as h

# Every wait below is bounded, so passing this means something blocked in a
# call that was not supposed to be able to. Dumping the stack beats being
# killed by the job timeout with nothing to read.
WATCHDOG_SECONDS = 420
CLIPBOARD_TIMEOUT = 15
SENTINEL = "joule-clipboard-sentinel-not-the-selection"
DEAD_DISPLAY = ":91"
DROPPED = ["DISPLAY", "WAYLAND_DISPLAY", "SSH_CONNECTION", "SSH_TTY"]
CLIPBOARD_COMMANDS = ("xclip", "xsel", "wl-copy", "wl-paste", "pbcopy", "pbpaste", "clip.exe")

failures = []


def ok(cond, label):
    if cond:
        print("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr)


def is_macos():
    return sys.platform == "darwin"


def copy_cmd():
    if is_macos():
        return ["pbcopy"]
    return ["xclip", "-selection", "clipboard"]


def paste_cmd():
    if is_macos():
        return ["pbpaste"]
    return ["xclip", "-o", "-selection", "clipboard"]


def clip_env(display):
    env = dict(os.environ)
    if display is not None:
        env["DISPLAY"] = display
        env.pop("WAYLAND_DISPLAY", None)
    return env


def set_clipboard(display, value):
    subprocess.run(copy_cmd(), input=value.encode(), env=clip_env(display),
                   timeout=CLIPBOARD_TIMEOUT, check=True)


def get_clipboard(display):
    done = subprocess.run(paste_cmd(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          env=clip_env(display), timeout=CLIPBOARD_TIMEOUT)
    return done.stdout.decode("utf-8", "replace")


def clipboard_round_trips(display):
    """Whether this machine has a clipboard at all, asked before anything is
    asserted about one. A CI runner with no window session is a normal thing
    to be; being unable to tell that apart from a failing product is not."""
    probe = SENTINEL + "-preflight"
    try:
        set_clipboard(display, probe)
        return get_clipboard(display) == probe
    except Exception as e:
        print("verify_clipboard_pty: %s round trip failed: %s" % (copy_cmd()[0], e), file=sys.stderr)
        return False


def free_display():
    n = 90
    while n < 200:
        if not os.path.exists("/tmp/.X11-unix/X%d" % n) and not os.path.exists("/tmp/.X%d-lock" % n):
            return ":%d" % n
        n += 1
    raise h.Failure("no free X display number")


def start_display():
    """An Xvfb of this script's own, so nothing here touches a real desktop."""
    if is_macos():
        return None, None
    display = free_display()
    proc = subprocess.Popen(
        ["Xvfb", display, "-screen", "0", "1024x768x24", "-nolisten", "tcp"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    deadline = time.time() + 15.0
    while time.time() < deadline:
        if proc.poll() is not None:
            raise h.Failure("Xvfb exited immediately on %s" % display)
        if os.path.exists("/tmp/.X11-unix/X%s" % display[1:]):
            return display, proc
        time.sleep(0.1)
    proc.kill()
    raise h.Failure("Xvfb never came up on %s" % display)


def stop_display(proc):
    if proc is None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def path_without_clipboard(work_root):
    """This machine's PATH with every clipboard command taken out of it.

    A directory of symlinks rather than an empty PATH, because the session
    under test is a real one and still needs the ordinary utilities - joule
    starts its daemon with nohup - and because an empty PATH is a broken
    machine rather than the case #282 is about, which is a working machine
    with no clipboard command installed on it.
    """
    d = os.path.join(work_root, "path-without-clipboard")
    if os.path.isdir(d):
        return d
    os.makedirs(d, exist_ok=True)
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry.strip() == "":
            continue
        try:
            names = os.listdir(entry)
        except OSError:
            continue
        for name in names:
            if name in CLIPBOARD_COMMANDS:
                continue
            link = os.path.join(d, name)
            if os.path.islink(link) or os.path.exists(link):
                continue
            try:
                os.symlink(os.path.join(entry, name), link)
            except OSError:
                pass
    for name in CLIPBOARD_COMMANDS:
        if os.path.exists(os.path.join(d, name)):
            raise h.Failure("%s survived into the no-clipboard PATH" % name)
    return d


class Session:
    """joule started with nothing else running, which starts its own daemon."""

    def __init__(self, prefix, env_extra, env_drop):
        self.work_dir, self.stub, self.session = h.start_stub_session(
            prefix, env_extra=env_extra, env_drop=env_drop)
        self.session.wait_for(h.BANNER, timeout=20.0)

    def close(self):
        h.stop_stub_session(self.work_dir, self.stub, self.session)


def drag_and_release(prefix, env_extra, probe):
    """Drive one session of the real binary to a completed mouse selection.

    `probe` is called while that session is still running, right after the
    release, and its answer is handed back with everything else.
    """
    holder = Session(prefix, env_extra, DROPPED)
    try:
        session = holder.session
        session.write("/cat file_a.txt\r")
        session.wait_for("FILE_A_LINE_050", timeout=15.0)
        session.settle(0.3, 2.0)

        rows = h.file_a_rows(h.text(bytes(session.raw)))
        if len(rows) < 4:
            raise h.Failure("not enough transcript rows to drag over, got %d" % len(rows))
        top_row, bottom_row = rows[-4], rows[-2]

        h.drag_over(session, top_row, bottom_row, session.cols)
        session.write(h.mouse_drag(bottom_row, session.cols))
        session.settle(0.2, 1.5)

        pre_release = h.text(bytes(session.raw))
        covered = [h.row_text(pre_release, r) for r in range(top_row, bottom_row + 1)]
        if any(r is None for r in covered):
            raise h.Failure("a row the selection covers was not on the screen the release copies from")
        expected = "\n".join(covered)

        release_idx = len(session.raw)
        session.write(h.mouse_release(bottom_row, session.cols))
        session.settle(0.5, 3.0)
        released = h.text(bytes(session.raw[release_idx:]))
        screen = h.strip_sgr(h.last_redraw_block(h.text(bytes(session.raw))))
        probed = probe()

        session.write("/mouse\r")
        session.settle(0.3, 2.0)
        state = h.strip_sgr(h.last_redraw_block(h.text(bytes(session.raw))))

        session.write("\x04")
        session.settle(0.3, 3.0)
        session.wait_exit(5.0)
        return {"released": released, "screen": screen, "expected": expected, "state": state, "probed": probed}
    finally:
        holder.close()


def with_display(display, extra):
    env = dict(extra)
    if display is not None:
        env["DISPLAY"] = display
    return env


def run_local_case(display):
    """A local session with a clipboard command: the clipboard holds the text."""
    print("case: local session, clipboard command present")
    set_clipboard(display, SENTINEL)
    r = drag_and_release("joule-clipboard-local-", with_display(display, {}), lambda: get_clipboard(display))

    tool = paste_cmd()[0]
    ok(r["probed"] == r["expected"],
       "a local session's drag puts exactly the dragged rows on the system clipboard, read back with %s (wanted %d chars, got %d)"
       % (tool, len(r["expected"]), len(r["probed"])))
    ok(r["probed"] != SENTINEL, "and the clipboard no longer holds what it held before the drag")
    ok(not h.osc52_payloads(r["released"]),
       "no OSC 52 is emitted once the platform write succeeded, so a terminal that prints unknown sequences shows nothing")
    ok("-- copied " in r["screen"], "the screen reports the copy that actually happened")
    ok("-- asked the terminal" not in r["screen"], "and does not describe it as a request to the terminal")
    ok(copy_cmd()[0] in r["state"], "/mouse names %s, the command this machine will really run" % copy_cmd()[0])
    ok("OSC 52" not in r["state"], "and does not offer OSC 52 as the mechanism when it is not the one in use")


def run_tool_gone_case(display, bare_path):
    """A display, but no clipboard command anywhere on PATH."""
    print("case: no clipboard command on PATH")
    set_clipboard(display, SENTINEL)
    r = drag_and_release("joule-clipboard-notool-", with_display(display, {"PATH": bare_path}),
                         lambda: get_clipboard(display))

    ok(len(h.osc52_payloads(r["released"])) == 1,
       "with no clipboard command on PATH the release falls back to exactly one OSC 52, got %d"
       % len(h.osc52_payloads(r["released"])))
    ok("-- asked the terminal for " in r["screen"],
       "and the screen says the terminal was asked rather than that a copy happened")
    ok("-- copied " not in r["screen"], "so nothing claims success only the terminal could have delivered")
    ok(r["probed"] == SENTINEL, "the system clipboard is untouched, because there was no command to touch it with")
    ok("OSC 52" in r["state"], "/mouse names OSC 52 as the mechanism, since it is the only one left here")


def run_remote_case(display):
    """SSH_CONNECTION set with a working clipboard command present: this
    machine's clipboard is the wrong one to write, so it is left alone."""
    print("case: remote session over ssh")
    set_clipboard(display, SENTINEL)
    env = with_display(display, {"SSH_CONNECTION": "10.0.0.1 52000 10.0.0.2 22", "SSH_TTY": "/dev/pts/9"})
    r = drag_and_release("joule-clipboard-remote-", env, lambda: get_clipboard(display))

    ok(len(h.osc52_payloads(r["released"])) == 1,
       "over ssh the release emits OSC 52, the only thing that reaches the machine at the keyboard, got %d"
       % len(h.osc52_payloads(r["released"])))
    ok(r["probed"] == SENTINEL,
       "and %s is never run, so this machine's clipboard still holds what it held before" % copy_cmd()[0])
    ok("-- asked the terminal for " in r["screen"], "the screen says the terminal was asked")
    ok("-- copied " not in r["screen"], "and claims no copy it cannot know happened")
    ok("ssh" in r["state"], "/mouse says the session is remote, which is why the mechanism changed")


def run_dead_display_case(display):
    """A clipboard command that is installed and fails when it runs: no
    mechanism worked, and the screen has to say so rather than report a copy."""
    print("case: clipboard command present and failing")
    set_clipboard(display, SENTINEL)
    r = drag_and_release("joule-clipboard-dead-", {"DISPLAY": DEAD_DISPLAY}, lambda: get_clipboard(display))

    ok(not h.osc52_payloads(r["released"]),
       "a failed local write is not papered over with an OSC 52 the same local terminal would refuse too")
    ok("-- no clipboard here" in r["screen"], "the screen says plainly that nothing reached a clipboard")
    ok("-- copied " not in r["screen"] and "-- asked the terminal" not in r["screen"],
       "and reports neither of the two things that did not happen")
    ok("/mouse off" in r["screen"], "and names /mouse off as the way to get the terminal's own selection back")
    ok(r["probed"] == SENTINEL, "the working display's clipboard is untouched by a session pointed at a dead one")


def main():
    for name, path in (("bin/joule", h.JOULE_BIN), ("bin/stub_model", h.STUB_BIN)):
        if not os.path.exists(path):
            print("verify_clipboard_pty: %s not found, run make build bin/stub_model first" % name, file=sys.stderr)
            sys.exit(1)
    if shutil.which(paste_cmd()[0]) is None:
        print("verify_clipboard_pty: %s is not installed, and this check exists to read the clipboard back"
              % paste_cmd()[0], file=sys.stderr)
        sys.exit(1)
    if not is_macos() and shutil.which("Xvfb") is None:
        print("verify_clipboard_pty: Xvfb is not installed, and this check needs a display of its own",
              file=sys.stderr)
        sys.exit(1)

    print("clipboard harness on %s" % sys.platform)
    faulthandler.dump_traceback_later(WATCHDOG_SECONDS, exit=True)
    start = time.time()
    xvfb = None
    work_root = scratch.scratch_dir("joule-clipboard-harness-")
    try:
        display, xvfb = start_display()
        print("clipboard harness: display=%r, clipboard command=%s" % (display, copy_cmd()[0]))
        if not clipboard_round_trips(display):
            print("SKIPPED: this machine's own %s and %s do not round trip, so it has no clipboard for "
                  "joule to write and nothing here could tell a working copy from a broken one"
                  % (copy_cmd()[0], paste_cmd()[0]))
            sys.exit(0)
        print("ok: this machine's own clipboard round trips, so the checks below mean something")
        cases = [
            lambda: run_local_case(display),
            lambda: run_tool_gone_case(display, path_without_clipboard(work_root)),
            lambda: run_remote_case(display),
        ]
        if is_macos():
            print("skip: the failing-clipboard-command case is Linux-only, macOS has no equivalent of a "
                  "DISPLAY that parses and does not answer")
        else:
            cases.append(lambda: run_dead_display_case(display))
        for case in cases:
            try:
                case()
            except h.Failure as e:
                print("FAIL: " + str(e), file=sys.stderr)
                failures.append(str(e))
    finally:
        stop_display(xvfb)
        shutil.rmtree(work_root, ignore_errors=True)
        faulthandler.cancel_dump_traceback_later()

    print("clipboard harness finished in %dms" % int((time.time() - start) * 1000))
    if failures:
        print("%d check(s) failed: %s" % (len(failures), "; ".join(failures)), file=sys.stderr)
        sys.exit(1)
    print("clipboard harness passed")


if __name__ == "__main__":
    main()
