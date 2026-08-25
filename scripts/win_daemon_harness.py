#!/usr/bin/env python3
# Drives the real daemon on Windows: joule.exe spawns bin/joule-daemon.exe
# detached, attaches to it, a turn runs through it, a second client joins the
# same session, and `joule --stop` ends it.
#
# It is a separate harness from win_terminal_harness.py because it asserts
# different things through a different window. That one asks what the terminal
# draws; this one asks what the daemon does, and most of what it checks is not
# on a screen at all - a record file, a listening port, a process that is still
# there after the client that started it has gone.
#
# Three of its checks exist because of a specific way the Windows spawn can
# look like it works and not:
#
# `joule` starting and not returning. The POSIX spelling is `nohup ... &`,
# which leaves nothing holding the shell's pipes. PowerShell's Start-Process
# with -RedirectStandardOutput starts the child with handle inheritance on, so
# the daemon ends up holding a copy of the pipes joule handed PowerShell, and
# joule's own spawnSync waits on those pipes for a daemon that never exits.
# The wall-clock assertion on the ensure step is what catches that.
#
# The daemon dying with the window that started it. A console process started
# into its parent's console gets that console's ctrl-c and close events. This
# closes the first client's pseudoconsole outright and then asks the daemon
# whether it is still listening.
#
# The daemon's own output going nowhere. Its stdout is where it says why it
# would not start, so the harness reads the log the spawn redirected it to
# rather than trusting that the redirect happened.

import glob
import json
import os
import re
import socket
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scratch
from win_conpty import ConPty

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOULE = os.path.join(REPO_ROOT, "bin", "joule.exe")
DAEMON = os.path.join(REPO_ROOT, "bin", "joule-daemon.exe")
STUB = os.path.join(REPO_ROOT, "bin", "stub_model.exe")

PROMPT = "summarise the readme"
README = "# demo workspace\n\nA line the model will read.\n"
REPLAYED_LINE = "No health route yet. I will fix it."

# `joule daemon-ensure` connects, waits, spawns and waits again, so a healthy
# cold start is seconds rather than instant. What this number is there to
# catch is not slowness: it is a spawn that never returns at all.
ENSURE_DEADLINE = 60


class Checks(object):
    def __init__(self):
        self.failed = 0

    def that(self, passed, label):
        print(("ok   " if passed else "FAIL ") + label)
        if not passed:
            self.failed += 1
        return passed


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def port_open(port):
    sock = socket.socket()
    sock.settimeout(0.5)
    try:
        sock.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def wait_for_port(port, timeout, want=True):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_open(port) == want:
            return True
        time.sleep(0.1)
    return port_open(port) == want


def workspace():
    work = scratch.scratch_dir("joule-win-daemon-")
    home = os.path.join(work, "home")
    ws = os.path.join(work, "ws")
    os.makedirs(home)
    os.makedirs(ws)
    with open(os.path.join(ws, "README.md"), "w") as f:
        f.write(README)
    return work, home, ws


def joule_env(home, port):
    env = dict(os.environ)
    env.pop("HOME", None)
    env["USERPROFILE"] = home
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % port
    env["JOULE_CODE_MODEL"] = "stub"
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env["TERM"] = "xterm-256color"
    return env


def daemon_dir(home):
    return os.path.join(home, ".config", "joule-code", "daemon")


def records(home):
    return sorted(glob.glob(os.path.join(daemon_dir(home), "*.json")))


def daemon_logs(home):
    return sorted(glob.glob(os.path.join(daemon_dir(home), "*.log")))


def read_text(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def session_history(home, timeout):
    pattern = os.path.join(home, ".config", "joule-code", "sessions", "*.json")
    deadline = time.time() + timeout
    while time.time() < deadline:
        for path in glob.glob(pattern):
            try:
                with open(path, encoding="utf-8") as f:
                    doc = json.load(f)
            except (ValueError, OSError):
                continue
            roles = [m.get("role") for m in doc.get("history", [])]
            if roles.count("assistant") >= 2:
                return doc["history"]
        time.sleep(0.2)
    return None


def tool_names(history):
    out = []
    for m in history:
        for call in m.get("toolCalls", []):
            out.append(call.get("tool"))
    return out


def drive_turn(pty, checks):
    pty.wait_for(r"type a request", 60, "the banner of the first client")
    pty.write(PROMPT + "\r")
    pty.wait_for(re.escape(PROMPT), 30, "the typed line echoed back")
    pty.wait_for(r"\?\s*run", 60, "the run tool's approval prompt, which only the daemon can send")
    checks.that(True, "the daemon asked the client to approve the run tool")
    pty.write("\r")


def stop_daemon(ws, env):
    try:
        return subprocess.run([JOULE, "--stop"], cwd=ws, env=env, timeout=60,
                              capture_output=True, text=True)
    except (OSError, subprocess.SubprocessError):
        return None


def main():
    for path in (JOULE, DAEMON, STUB):
        if not os.path.exists(path):
            print("FAIL missing %s - run `make build bin/stub_model.exe`" % path)
            return 1

    work, home, ws = workspace()
    stub_port = free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub = subprocess.Popen([STUB], env=stub_env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    env = joule_env(home, stub_port)
    checks = Checks()
    first = None
    second = None
    daemon_port = 0

    try:
        wait_for_port(stub_port, 15)

        started = time.time()
        try:
            ensure = subprocess.run([JOULE, "daemon-ensure"], cwd=ws, env=env,
                                    capture_output=True, text=True,
                                    timeout=ENSURE_DEADLINE)
            elapsed = time.time() - started
            returned = True
        except subprocess.TimeoutExpired:
            elapsed = time.time() - started
            returned = False
            ensure = None

        if not checks.that(returned,
                           "the spawn hands the daemon over and returns, rather than "
                           "waiting on pipes the daemon inherited (%ds)" % ENSURE_DEADLINE):
            raise AssertionError("joule daemon-ensure never returned")

        print("     daemon-ensure took %.1fs and said: %s" % (elapsed, ensure.stdout.strip()))
        report = {}
        for line in ensure.stdout.splitlines():
            if line.startswith("{"):
                report = json.loads(line)
        checks.that(ensure.returncode == 0 and report.get("ok") is True,
                    "joule attached to a daemon for this workspace")
        checks.that(report.get("spawned") is True,
                    "and it was this client that started it")
        checks.that(report.get("workspace") == ws,
                    "the daemon it started is serving this workspace, %r" % report.get("workspace"))

        # A cold start is the one moment joule asks about a port before
        # anything is on it. The runtime's own connect answers that with a
        # diagnostic and a stack trace on Windows rather than an error
        # (lumen#44), which is why the port is asked about through the
        # platform shim first. This is what says the shim is still in front
        # of it.
        noise = [l for l in ensure.stderr.splitlines()
                 if "NTSTATUS" in l or "error.Unexpected" in l]
        if noise:
            print("     stderr: %r" % noise[:3])
        checks.that(not noise,
                    "a cold start writes no runtime trace to the console")

        found = records(home)
        checks.that(len(found) == 1, "the daemon wrote exactly one record under the config root")
        if found:
            record = json.loads(read_text(found[0]))
            daemon_port = record.get("port", 0)
            checks.that(record.get("workspace") == ws and daemon_port == report.get("port"),
                        "the record names the workspace and the port joule reported")

        checks.that(daemon_port and port_open(daemon_port),
                    "the daemon is still listening after the client that started it exited")

        log = "".join(read_text(p) for p in daemon_logs(home))
        checks.that("listening on 127.0.0.1:%d" % daemon_port in log,
                    "the daemon's own stdout reached the log the spawn redirected it to")

        first = ConPty([JOULE], env, ws, cols=100, rows=30)
        drive_turn(first, checks)

        history = session_history(home, 90)
        if history is None:
            raise AssertionError(
                "no session with a completed turn was persisted\n"
                "--- last 2500 characters ---\n%s" % first.plain()[-2500:])
        called = tool_names(history)
        checks.that("read" in called and "run" in called,
                    "the turn ran through the daemon: it called read and run, got %r" % called)
        first.wait_for(re.escape(REPLAYED_LINE), 60, "the assistant's text in the first client")
        checks.that(True, "the model's text came back through the daemon to the client")

        # Not a graceful quit: the pseudoconsole is closed under the client and
        # the client is killed. A daemon that had been started into that
        # console would go with it.
        first.close()
        first = None
        checks.that(wait_for_port(daemon_port, 10),
                    "the daemon outlives its client's console being closed under it")

        second = ConPty([JOULE], env, ws, cols=100, rows=30)
        second.wait_for(r"type a request", 60, "the banner of the second client")
        second.wait_for(re.escape(REPLAYED_LINE), 60,
                        "the second client to be replayed the session it did not take part in")
        checks.that(True, "a second client attaches to the same session and is replayed it")
        checks.that(len(records(home)) == 1,
                    "the second client attached rather than starting a daemon of its own")

        second.close()
        second = None

        stopped = stop_daemon(ws, env)
        checks.that(stopped is not None and "acknowledged the request" in stopped.stdout,
                    "joule --stop got an acknowledgement from the daemon")
        checks.that(wait_for_port(daemon_port, 20, want=False),
                    "the daemon's port stops accepting after the stop request")
        checks.that(records(home) == [],
                    "the daemon removed its record on the way out, got %r" % records(home))
    except AssertionError as e:
        print("FAIL %s" % e)
        checks.failed += 1
    finally:
        for pty in (first, second):
            if pty is not None:
                pty.close()
        if daemon_port and port_open(daemon_port):
            stop_daemon(ws, env)
        stub.kill()

    if checks.failed:
        print("%d check(s) failed" % checks.failed)
        return 1
    print("windows daemon harness: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
