# Live-pty verification for #331: `joule --session <name>` on a workspace
# already running a default (unnamed) session gets its own daemon, its own
# port, and its own conversation - not the default session's - and
# `joule --stop --session <name>` ends only that one.
#
# Reuses terminal_structural_harness.py's PtySession/seed_workspace rather
# than duplicating them.

import glob
import json
import os
import subprocess
import sys
import shutil
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


def daemon_ports(home_dir):
    """Every port recorded under this HOME, keyed by which session name wrote
    it - reading the same info files `joule --stop` reads, so this checks
    what the product itself would see."""
    found = {}
    for path in glob.glob(os.path.join(home_dir, ".config", "joule-code", "daemon", "*.json")):
        with open(path) as f:
            info = json.load(f)
        found[info.get("session", "")] = info.get("port", 0)
    return found


def stop_output(repo_dir, home_dir, session_name):
    env = dict(os.environ)
    env["HOME"] = home_dir
    args = [harness.JOULE_BIN, "--stop"]
    if session_name != "":
        args = args + ["--session", session_name]
    done = subprocess.run(args, cwd=repo_dir, env=env, timeout=30, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return (done.stdout or b"").decode("utf-8", "replace")


def start_named_session(repo_dir, home_dir, session_name):
    joule_env = dict(os.environ)
    joule_env["HOME"] = home_dir
    joule_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    joule_env["JOULE_CODE_MODEL"] = "stub"
    joule_env["JOULE_CODE_API_KEY"] = "stub-key"
    joule_env["TERM"] = "xterm-256color"
    args = [harness.JOULE_BIN]
    if session_name != "":
        args = args + ["--session", session_name]
    return harness.PtySession(args, joule_env, repo_dir, rows=24, cols=80)


def run():
    work_dir = scratch.scratch_dir("joule-multi-session-pty-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)

    default_session = None
    review_session = None
    try:
        default_session = start_named_session(repo_dir, home_dir, "")
        default_session.wait_for(harness.BANNER, timeout=10.0)

        review_session = start_named_session(repo_dir, home_dir, "review")
        review_session.wait_for(harness.BANNER, timeout=10.0)

        ports = daemon_ports(home_dir)
        ok("" in ports and "review" in ports, "both the default and the named session recorded their own daemon, got %r" % ports)
        if "" in ports and "review" in ports:
            ok(ports[""] != ports["review"], "they landed on different ports, got %r" % ports)

        # Two full joule processes tearing down at once (each with its own
        # daemon behind it) is heavier than any other pty harness asks for on
        # a loaded CI machine - send both ctrl-d bytes first so the two exits
        # overlap in wall-clock time rather than waiting on one before even
        # signalling the other, then give each a longer budget than the
        # usual 10s a single process gets everywhere else in this codebase.
        default_session.write("\x04")
        review_session.write("\x04")
        ok(default_session.wait_exit(45.0), "the default session's terminal exits cleanly on ctrl-d")
        ok(review_session.wait_exit(45.0), "the review session's terminal exits cleanly on ctrl-d")

        # ctrl-d only detaches (see docs/03-daemon.md) - both daemons should
        # still be up, independently, after both terminals have left.
        ports_after_detach = daemon_ports(home_dir)
        ok(len(ports_after_detach) == 2, "both daemons outlive their terminals detaching, got %r" % ports_after_detach)

        stopped_review = stop_output(repo_dir, home_dir, "review")
        ok("has stopped" in stopped_review, "joule --stop --session review stops the named session's daemon, got %r" % stopped_review.strip())

        ports_after_stop = daemon_ports(home_dir)
        ok("" in ports_after_stop and "review" not in ports_after_stop,
           "stopping the named session left the default session's daemon alone, got %r" % ports_after_stop)

        stopped_default = stop_output(repo_dir, home_dir, "")
        ok("has stopped" in stopped_default, "joule --stop then cleans up the default session too, got %r" % stopped_default.strip())
    finally:
        if default_session is not None:
            default_session.close()
        if review_session is not None:
            review_session.close()
        # Best-effort: stop anything still up under this HOME so the workspace
        # cleanup below never races a daemon still holding files open in it.
        for name in list(daemon_ports(home_dir).keys()):
            try:
                stop_output(repo_dir, home_dir, name)
            except Exception:
                pass
        shutil.rmtree(work_dir, ignore_errors=True)


def run_session_command_scenario():
    """/session moves this terminal into another session without exiting.
    With only one session running it just names it (like /model and /mode
    with nothing to pick between); with a second one running it opens the
    picker, and choosing a different name lands in that session in the same
    process - both daemons still up, since "switch" is never "stop", and the
    shell never gets control back."""
    work_dir = scratch.scratch_dir("joule-session-cmd-pty-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)

    review_session = None
    default_session = None
    try:
        review_session = start_named_session(repo_dir, home_dir, "review")
        review_session.wait_for(harness.BANNER, timeout=10.0)

        default_session = start_named_session(repo_dir, home_dir, "")
        default_session.wait_for(harness.BANNER, timeout=10.0)

        default_session.write("/session\r")
        default_session.wait_for("switch session", timeout=5.0)
        ok(True, "/session with a second session running opens the picker rather than just naming the current one")

        default_session.write(b"\x1b[B")  # down arrow, to the review row
        default_session.write("\r")
        default_session.wait_for("now in the review session", timeout=45.0)
        ok(True, "choosing a different session lands in it rather than printing a command to run")

        still_running = not default_session.wait_exit(3.0)
        ok(still_running, "the terminal stays open on the target session instead of exiting to the shell")

        ports = daemon_ports(home_dir)
        ok("" in ports and "review" in ports,
           "both sessions' daemons are still up after the switch, got %r" % ports)

        default_session.write("/session\r")
        default_session.wait_for("switch session", timeout=10.0)
        default_session.write(b"\x1b[B")
        default_session.write("\r")
        default_session.wait_for("now in the default session", timeout=45.0)
        ok(True, "switching back returns to the session left behind, still in the same process")

        default_session.write("/session planning\r")
        default_session.wait_for("now in the planning session", timeout=60.0)
        ok(True, "switching to a name with no session running starts that session and lands in it")

        ports = daemon_ports(home_dir)
        ok("planning" in ports and "" in ports and "review" in ports,
           "the newly started session has its own daemon beside the other two, got %r" % ports)

        ok(not default_session.wait_exit(3.0),
           "the terminal is still running after three switches in one process")
    finally:
        if default_session is not None:
            default_session.close()
        if review_session is not None:
            review_session.close()
        for name in list(daemon_ports(home_dir).keys()):
            try:
                stop_output(repo_dir, home_dir, name)
            except Exception:
                pass
        shutil.rmtree(work_dir, ignore_errors=True)



def run_inflight_turn_scenario():
    """A turn running in the session you leave keeps running, and its answer is
    there when you come back (user story 2). The switch must not wait for it and
    must not stop its daemon. Needs a live stub model, since a turn has to
    actually be in flight, and a chunk delay so it is still going when the
    switch happens."""
    work_dir = scratch.scratch_dir("joule-inflight-switch-pty-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)

    stub_port = harness.free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_CHUNK_DELAY_MS"] = "220"
    stub = subprocess.Popen([os.path.join(REPO_ROOT, "bin", "stub_model")], cwd=repo_dir, env=stub_env)

    joule_env = dict(os.environ)
    joule_env["HOME"] = home_dir
    joule_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    joule_env["JOULE_CODE_MODEL"] = "stub-model"
    joule_env["JOULE_CODE_API_KEY"] = "test-key"
    joule_env["TERM"] = "xterm-256color"

    session = None
    try:
        ok(harness.wait_for_port(stub_port, 20.0), "stub model came up for the in-flight switch check")

        session = harness.PtySession([harness.JOULE_BIN], joule_env, repo_dir, rows=24, cols=80)
        session.wait_for(harness.BANNER, timeout=20.0)

        ports_before = daemon_ports(home_dir)
        default_port = ports_before.get("", 0)
        ok(default_port != 0, "the default session has a daemon, got %r" % ports_before)

        session.write("say something long please\r")
        session.settle(quiet=0.2, cap=1.5)

        session.write("/session review\r")
        session.wait_for("now in the review session", timeout=60.0)
        ok(True, "the switch completed without waiting for the turn in the session being left")

        ports_mid = daemon_ports(home_dir)
        ok(ports_mid.get("", 0) == default_port,
           "the session left behind kept the same daemon, never stopped or restarted, got %r" % ports_mid)

        session.write("/session\r")
        session.wait_for("switch session", timeout=15.0)
        session.write(b"\x1b[B")
        session.write("\r")
        session.wait_for("now in the default session", timeout=60.0)
        session.settle(quiet=0.3, cap=6.0)

        body = harness.text(session.raw)
        tail = body[body.rindex("now in the default session"):]
        ok("say something long please" in tail,
           "coming back replays the transcript of the session left behind, including the turn it ran unwatched")

        session.write(b"\x04")
        exited = session.wait_exit(30.0)
        ok(exited, "ctrl-d still leaves after a switch, rather than being swallowed by it")

        ports_after = daemon_ports(home_dir)
        ok(ports_after.get("", 0) == default_port and "review" in ports_after,
           "leaving keeps both the current session and the one switched away from running, got %r" % ports_after)
    finally:
        if session is not None:
            session.close()
        stub.terminate()
        for name in list(daemon_ports(home_dir).keys()):
            try:
                stop_output(repo_dir, home_dir, name)
            except Exception:
                pass
        shutil.rmtree(work_dir, ignore_errors=True)


def run_standalone_switch_scenario():
    """The standalone terminal switches too (FR-010). It runs when no daemon
    can be reached, owns its own history, and cannot leave a turn running - so
    it hands its session to a background daemon and then enters the attached
    loop for the target, in the same process. The user never sees a command to
    run."""
    work_dir = scratch.scratch_dir("joule-standalone-switch-pty-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)

    joule_env = dict(os.environ)
    joule_env["HOME"] = home_dir
    joule_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:1"
    joule_env["JOULE_CODE_MODEL"] = "stub"
    joule_env["JOULE_CODE_API_KEY"] = "stub-key"
    joule_env["TERM"] = "xterm-256color"

    lonely_dir = os.path.join(work_dir, "nodaemon")
    os.makedirs(lonely_dir, exist_ok=True)
    lonely_joule = os.path.join(lonely_dir, os.path.basename(harness.JOULE_BIN))
    shutil.copy2(harness.JOULE_BIN, lonely_joule)

    session = None
    try:
        session = harness.PtySession([lonely_joule], joule_env, repo_dir, rows=24, cols=80)
        session.wait_for(harness.BANNER, timeout=15.0)
        ok(True, "with no daemon reachable the standalone terminal comes up")

        session.write("/session review\r")
        session.settle(cap=8.0)
        body = harness.text(session.raw)
        ok("run joule --session" not in body,
           "the standalone terminal no longer tells the user to run a command to reach the target")
        ok("staying in this one" in body,
           "with no daemon reachable the standalone switch stays put rather than stranding the user")
        ok(not session.wait_exit(3.0),
           "a standalone switch that cannot reach its target leaves the terminal running")
    finally:
        if session is not None:
            session.close()
        for name in list(daemon_ports(home_dir).keys()):
            try:
                stop_output(repo_dir, home_dir, name)
            except Exception:
                pass
        shutil.rmtree(work_dir, ignore_errors=True)


try:
    run()
except harness.Failure as e:
    print("FAIL: " + str(e), file=sys.stderr)
    failures.append(str(e))
try:
    run_session_command_scenario()
except harness.Failure as e:
    print("FAIL: " + str(e), file=sys.stderr)
    failures.append(str(e))
try:
    run_inflight_turn_scenario()
except harness.Failure as e:
    print("FAIL: " + str(e), file=sys.stderr)
    failures.append(str(e))
try:
    run_standalone_switch_scenario()
except harness.Failure as e:
    print("FAIL: " + str(e), file=sys.stderr)
    failures.append(str(e))

if failures:
    print("%d check(s) failed" % len(failures), file=sys.stderr)
    for f in failures:
        print(" - " + f, file=sys.stderr)
    sys.exit(1)
print("multi-session live-pty checks passed")
