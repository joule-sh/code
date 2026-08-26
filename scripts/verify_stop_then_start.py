#!/usr/bin/env python3
# `joule --stop` followed immediately by `joule`. The stop used to return on
# the daemon's acknowledgement while the daemon still held its socket, so the
# next client attached to a daemon on its way out and exited with "the daemon
# stopped" instead of starting a session. HOME is redirected at a scratch
# directory so the daemon record this reads is the one this run wrote.

import importlib.util
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
STOPPED_MESSAGE = "the daemon stopped"
PAINT_BUDGET_S = 25.0

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


def wait_exit_draining(session, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if session.wait_exit(0.0):
            return True
        session._pump(0.05)
    return session.wait_exit(0.5)


def close_bounded(session):
    try:
        os.kill(session.pid, signal.SIGKILL)
    except OSError:
        pass
    wait_exit_draining(session, 10.0)
    try:
        os.close(session.master_fd)
    except OSError:
        pass


def free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def run_until_painted(env, workspace, label):
    mark("running joule in " + workspace)
    session = PtySession([JOULE_BIN], env, workspace, rows=24, cols=100)
    painted = True
    try:
        session.wait_for(BANNER, timeout=PAINT_BUDGET_S)
    except Failure:
        painted = False
    if painted:
        mark("sending ctrl-d")
        session.write("\x04")
        ok(wait_exit_draining(session, 15.0), "the client exits on ctrl-d")
    text = bytes(session.raw).decode("utf-8", "replace")
    close_bounded(session)
    ok(painted, label)
    return text


def main():
    signal.signal(signal.SIGALRM, give_up)
    signal.alarm(WHOLE_RUN_BUDGET_S)
    mark("setting up")
    home = tempfile.mkdtemp(prefix="joule-stop-home-")
    workspace = tempfile.mkdtemp(prefix="joule-stop-ws-")
    os.makedirs(os.path.join(home, ".config", "joule-code"), exist_ok=True)

    stub_port = free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub = subprocess.Popen([STUB_BIN], cwd=workspace, env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok(harness.wait_for_port(stub_port, 5.0), "stub model came up")

    env = dict(os.environ)
    env["HOME"] = home
    env["TERM"] = "xterm-256color"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    env["JOULE_CODE_MODEL"] = "stub-model"
    env["JOULE_CODE_API_KEY"] = "test-key"
    env.pop("JOULE_DAEMON_PORT", None)

    try:
        run_until_painted(env, workspace, "a first run starts a daemon and paints")

        mark("stopping the daemon")
        stopped = subprocess.run([JOULE_BIN, "--stop"], cwd=workspace, env=env, capture_output=True, text=True, timeout=60)
        say("   joule --stop said: " + " | ".join(stopped.stdout.strip().splitlines()))
        ok(stopped.returncode == 0, "joule --stop exits cleanly")

        record_dir = os.path.join(home, ".config", "joule-code", "daemon")
        records = [n for n in os.listdir(record_dir) if n.endswith(".json")] if os.path.isdir(record_dir) else []
        ok(len(records) == 0, "joule --stop does not return while the daemon still has a record")

        text = run_until_painted(env, workspace, "a joule started straight after the stop paints")
        ok(STOPPED_MESSAGE not in text, "the run after the stop starts a session rather than attaching to the daemon on its way out")
    finally:
        mark("tearing down")
        try:
            subprocess.run([JOULE_BIN, "--stop"], cwd=workspace, env=env, capture_output=True, timeout=60)
        except Exception:
            pass
        stub.terminate()
        try:
            stub.wait(timeout=5)
        except Exception:
            stub.kill()
        shutil.rmtree(home, ignore_errors=True)
        shutil.rmtree(workspace, ignore_errors=True)
        signal.alarm(0)

    if failures:
        print("\n%d check(s) failed" % len(failures), file=sys.stderr, flush=True)
        sys.exit(1)
    say("\nstop-then-start verification passed")


if __name__ == "__main__":
    main()
