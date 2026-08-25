#!/usr/bin/env python3
# The cold path: no daemon anywhere, no JOULE_DAEMON_PORT handed in, a real
# client under a real pty that has to spawn its own daemon and then paint.
# Every other daemon harness starts the daemon itself and points a client at
# it, so the spawn-and-attach code this exercises had no coverage at all -
# which is how a first run in a fresh workspace could hang with a blank
# screen and nothing noticed.
#
# HOME is redirected at a scratch directory so the daemon record, the daemon
# log and the update cache are all this run own, and so a daemon belonging to
# the machine can never make this pass.

import atexit
import importlib.util
import io
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("harness", os.path.join(REPO_ROOT, "scripts", "terminal_structural_harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

PtySession = harness.PtySession
Failure = harness.Failure

JOULE_BIN = os.path.join(REPO_ROOT, "bin", "joule")
STUB_BIN = os.path.join(REPO_ROOT, "bin", "stub_model")
BANNER = "type a request, /help for commands"
IN_PROCESS_NOTE = "running in-process instead"
PAINT_BUDGET_S = 20.0
SILENCE_BUDGET_S = 2.0
ORPHAN_SETTLE_S = 15.0

failures = []
stage = "starting"
WHOLE_RUN_BUDGET_S = 240


def say(line):
    print(line, flush=True)


def mark(name):
    global stage
    stage = name
    print("-- " + name, flush=True)


def give_up(signum, frame):
    print("FAIL: the harness itself hung at stage %r" % stage, file=sys.stderr, flush=True)
    os._exit(1)


def ok(cond, label):
    if cond:
        say("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr, flush=True)


def free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def client_env(home, stub_port):
    env = dict(os.environ)
    env["HOME"] = home
    env["TERM"] = "xterm-256color"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    env["JOULE_CODE_MODEL"] = "stub-model"
    env["JOULE_CODE_API_KEY"] = "test-key"
    env["JOULE_UPDATE_CHECK"] = "off"
    env.pop("JOULE_DAEMON_PORT", None)
    return env


def daemon_dir(home):
    return os.path.join(home, ".config", "joule-code", "daemon")


def daemon_logs(home):
    out = []
    d = daemon_dir(home)
    if not os.path.isdir(d):
        return out
    for name in sorted(os.listdir(d)):
        path = os.path.join(d, name)
        try:
            with open(path, errors="replace") as f:
                out.append((name, f.read()))
        except OSError:
            pass
    return out


def wait_exit_draining(session, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if session.wait_exit(0.0):
            return True
        session._pump(0.05)
    return session.wait_exit(0.5)


def sample_process(pid):
    sample = shutil.which("sample")
    if sample is not None:
        try:
            print(subprocess.run([sample, str(pid), "2", "-mayDie"], capture_output=True, text=True, timeout=120).stdout, file=sys.stderr, flush=True)
        except Exception:
            pass
        return
    task = "/proc/%d/task" % pid
    if not os.path.isdir(task):
        return
    for tid in os.listdir(task):
        for what in ("wchan", "stack", "syscall"):
            try:
                with io.open("%s/%s/%s" % (task, tid, what), errors="replace") as f:
                    print("thread %s %s: %s" % (tid, what, f.read().strip()), file=sys.stderr, flush=True)
            except OSError:
                pass


def report_not_exiting(session, home):
    print("--- the client did not exit on ctrl-d; here is where it is", file=sys.stderr, flush=True)
    for name, body in daemon_logs(home):
        print("--- %s" % name, file=sys.stderr, flush=True)
        print(body, file=sys.stderr, flush=True)
    sample_process(session.pid)
    try:
        os.kill(session.pid, signal.SIGKILL)
    except OSError:
        pass
    wait_exit_draining(session, 10.0)


def report_stuck(session, home, workspace):
    print("--- the client never painted; here is what it left behind", file=sys.stderr)
    print("captured %d bytes from the pty:" % len(session.raw), file=sys.stderr)
    print(repr(bytes(session.raw[:2000])), file=sys.stderr)
    for name, body in daemon_logs(home):
        print("--- %s" % name, file=sys.stderr)
        print(body, file=sys.stderr)
    for cmd in (["ps", "-eo", "pid,ppid,stat,command"],):
        try:
            listing = subprocess.run(cmd, capture_output=True, text=True, timeout=15).stdout
        except Exception:
            continue
        for line in listing.splitlines():
            if REPO_ROOT in line and "verify_cold_start" not in line:
                print("ps: " + line[:400], file=sys.stderr)
    sample_process(session.pid)


def first_byte_after(session, budget):
    deadline = time.time() + budget
    started = time.time()
    while time.time() < deadline:
        if len(session.raw) > 0:
            return time.time() - started
        session._pump(0.05)
    return None


def live_daemons(home):
    d = daemon_dir(home)
    if not os.path.isdir(d):
        return []
    return [os.path.join(d, n) for n in sorted(os.listdir(d)) if n.endswith(".json")]


def kill_quietly(proc):
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()
        try:
            proc.wait(timeout=5)
        except Exception:
            pass


def stop_daemon(home, workspace, stub_port):
    stopper = subprocess.Popen([JOULE_BIN, "--stop"], cwd=workspace, env=client_env(home, stub_port), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        stopper.wait(timeout=30)
    except Exception:
        kill_quietly(stopper)


def main():
    signal.signal(signal.SIGALRM, give_up)
    signal.alarm(WHOLE_RUN_BUDGET_S)
    mark("setting up")
    home = tempfile.mkdtemp(prefix="joule-cold-home-")
    workspace = tempfile.mkdtemp(prefix="joule-cold-ws-")
    os.makedirs(os.path.join(home, ".config", "joule-code"), exist_ok=True)
    with open(os.path.join(workspace, "README.md"), "w") as f:
        f.write("# demo\n")

    stub_port = free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub = subprocess.Popen([STUB_BIN], cwd=workspace, env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atexit.register(kill_quietly, stub)
    ok(harness.wait_for_port(stub_port, 5.0), "stub model came up")

    env = client_env(home, stub_port)
    ok(len(live_daemons(home)) == 0, "no daemon is recorded for this workspace before the client starts")

    mark("starting the client")
    session = PtySession([JOULE_BIN], env, workspace, rows=24, cols=100)
    painted = False
    started = time.time()
    try:
        spoke = first_byte_after(session, SILENCE_BUDGET_S)
        ok(spoke is not None, "the first run says something within %.1fs rather than sitting on a blank screen" % SILENCE_BUDGET_S)
        if spoke is not None:
            say("   first byte after %.1fs" % spoke)
        try:
            session.wait_for(BANNER, timeout=PAINT_BUDGET_S)
            painted = True
        except Failure:
            report_stuck(session, home, workspace)
        ok(painted, "a first run in a fresh workspace paints within %ds" % int(PAINT_BUDGET_S))
        if painted:
            say("   painted after %.1fs" % (time.time() - started))
            ok(len(daemon_logs(home)) > 0, "the client spawned a daemon of its own")
            ok(IN_PROCESS_NOTE not in bytes(session.raw).decode("utf-8", "replace"), "the client attached to the daemon it started rather than falling back in-process")
            mark("sending ctrl-d")
            session.write("\x04")
            left = wait_exit_draining(session, 15.0)
            if not left:
                report_not_exiting(session, home)
            ok(left, "the client exits cleanly on ctrl-d")
    finally:
        mark("closing the pty")
        try:
            os.kill(session.pid, signal.SIGKILL)
        except OSError:
            pass
        wait_exit_draining(session, 10.0)
        try:
            os.close(session.master_fd)
        except OSError:
            pass
        mark("stopping the daemon")
        stop_daemon(home, workspace, stub_port)
        mark("stopping the stub")
        kill_quietly(stub)

    mark("looking for orphans")
    settle = time.time() + ORPHAN_SETTLE_S
    leftover = live_daemons(home)
    while leftover and time.time() < settle:
        time.sleep(0.25)
        leftover = live_daemons(home)
    ok(len(leftover) == 0, "the run leaves no daemon of its own behind")
    for record in leftover:
        try:
            with io.open(record, errors="replace") as f:
                print("   orphan: " + record + " " + f.read().strip(), file=sys.stderr, flush=True)
        except OSError:
            pass

    shutil.rmtree(home, ignore_errors=True)
    shutil.rmtree(workspace, ignore_errors=True)
    signal.alarm(0)

    if failures:
        print("\n%d check(s) failed" % len(failures), file=sys.stderr, flush=True)
        sys.exit(1)
    say("\ncold-start verification passed")


if __name__ == "__main__":
    main()
