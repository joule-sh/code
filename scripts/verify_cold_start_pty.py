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
PAINT_BUDGET_S = 20.0

failures = []


def ok(cond, label):
    if cond:
        print("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr)


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
            if "joule" in line and "verify_cold_start" not in line:
                print("ps: " + line, file=sys.stderr)
    sample = shutil.which("sample")
    if sample is not None:
        try:
            print(subprocess.run([sample, str(session.pid), "2", "-mayDie"], capture_output=True, text=True, timeout=60).stdout, file=sys.stderr)
        except Exception:
            pass
    else:
        for tid in os.listdir("/proc/%d/task" % session.pid) if os.path.isdir("/proc/%d/task" % session.pid) else []:
            try:
                with open("/proc/%d/task/%s/stack" % (session.pid, tid), errors="replace") as f:
                    print("thread %s kernel stack: %s" % (tid, f.read().strip()), file=sys.stderr)
            except OSError:
                pass
            try:
                with open("/proc/%d/task/%s/wchan" % (session.pid, tid), errors="replace") as f:
                    print("thread %s wchan: %s" % (tid, f.read().strip()), file=sys.stderr)
            except OSError:
                pass


def live_daemons(home):
    out = []
    d = daemon_dir(home)
    if not os.path.isdir(d):
        return out
    try:
        listing = subprocess.run(["ps", "-eo", "pid,command"], capture_output=True, text=True, timeout=15).stdout
    except Exception:
        return out
    for line in listing.splitlines():
        if os.path.join(REPO_ROOT, "bin", "joule-daemon") in line:
            out.append(line.strip())
    return out


def stop_daemon(home, workspace, stub_port):
    try:
        subprocess.run([JOULE_BIN, "--stop"], cwd=workspace, env=client_env(home, stub_port), capture_output=True, timeout=30)
    except Exception:
        pass


def main():
    home = tempfile.mkdtemp(prefix="joule-cold-home-")
    workspace = tempfile.mkdtemp(prefix="joule-cold-ws-")
    os.makedirs(os.path.join(home, ".config", "joule-code"), exist_ok=True)
    with open(os.path.join(workspace, "README.md"), "w") as f:
        f.write("# demo\n")

    stub_port = free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub = subprocess.Popen([STUB_BIN], cwd=workspace, env=stub_env)
    ok(harness.wait_for_port(stub_port, 5.0), "stub model came up")

    env = client_env(home, stub_port)
    ok(len(live_daemons(home)) == 0, "no daemon is running for this workspace before the client starts")

    session = PtySession([JOULE_BIN], env, workspace, rows=24, cols=100)
    painted = False
    started = time.time()
    try:
        try:
            session.wait_for(BANNER, timeout=PAINT_BUDGET_S)
            painted = True
        except Failure:
            report_stuck(session, home, workspace)
        ok(painted, "a first run in a fresh workspace paints within %ds" % int(PAINT_BUDGET_S))
        if painted:
            print("   painted after %.1fs" % (time.time() - started))
            ok(len(daemon_logs(home)) > 0, "the client spawned a daemon of its own")
            session.write("\x04")
            ok(session.wait_exit(10.0), "the client exits cleanly on ctrl-d")
    finally:
        session.close()
        stop_daemon(home, workspace, stub_port)
        stub.terminate()
        try:
            stub.wait(timeout=5)
        except Exception:
            stub.kill()

    leftover = live_daemons(home)
    ok(len(leftover) == 0, "the run leaves no daemon behind")
    for line in leftover:
        print("   orphan: " + line, file=sys.stderr)
        try:
            os.kill(int(line.split()[0]), signal.SIGKILL)
        except Exception:
            pass

    shutil.rmtree(home, ignore_errors=True)
    shutil.rmtree(workspace, ignore_errors=True)

    if failures:
        print("\n%d check(s) failed" % len(failures), file=sys.stderr)
        sys.exit(1)
    print("\ncold-start verification passed")


if __name__ == "__main__":
    main()
