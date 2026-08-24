#!/usr/bin/env python3
# Starts the real bin/joule.exe inside a real Windows pseudoconsole and drives
# a turn against bin/stub_model.exe. The point is that `joule --version`
# exiting 0 says nothing about the half of a Windows port that had to be
# written from scratch - raw mode, VT input, console size, keys arriving as
# bytes - and this repository has been bitten before by a green harness over a
# product that did not work (#233, #235).
#
# What it asserts is what a Windows build does today:
#   the banner renders, so the renderer reached a console and sized it
#   a typed line echoes, so raw mode and the reader thread deliver keys
#   the model is called and its tool call runs, so a turn completes
#   the read tool succeeds, so the workspace jail accepts a Windows path
#
# What it deliberately does not assert, because it does not work yet and is
# tracked on #173 rather than hidden here:
#   the streamed transcript renders cleanly - some lines come out as a window
#     into the raw response JSON instead of the assistant's text
#   ctrl-d quits - the key arrives (the shim is verified separately) but the
#     loop does not exit, so this harness kills the child instead
#   the daemon, background tasks and --share, none of which start on Windows

import os
import re
import socket
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from win_conpty import ConPty

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOULE = os.path.join(REPO_ROOT, "bin", "joule.exe")
STUB = os.path.join(REPO_ROOT, "bin", "stub_model.exe")

BANNER = r"type a request"
PROMPT = "summarise the readme"


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def workspace():
    work = tempfile.mkdtemp(prefix="joule-win-harness-")
    home = os.path.join(work, "home")
    ws = os.path.join(work, "ws")
    os.makedirs(home)
    os.makedirs(ws)
    with open(os.path.join(ws, "README.md"), "w") as f:
        f.write("# demo workspace\n\nA line the model will read.\n")
    return work, home, ws


def start_stub(work, port):
    env = dict(os.environ)
    env["E2E_STUB_PORT"] = str(port)
    env["E2E_STUB_LOG"] = os.path.join(work, "stub_requests.log")
    return subprocess.Popen([STUB], env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)


def joule_env(home, port):
    env = dict(os.environ)
    # HOME is what a Git Bash step leaves behind and it would win over the
    # throwaway profile below, which is the whole point of setting it.
    env.pop("HOME", None)
    env["USERPROFILE"] = home
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % port
    env["JOULE_CODE_MODEL"] = "stub"
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env["TERM"] = "xterm-256color"
    return env


def check(passed, label):
    print(("ok   " if passed else "FAIL ") + label)
    return passed


def main():
    for path in (JOULE, STUB):
        if not os.path.exists(path):
            print("FAIL missing %s - run `make build bin/stub_model.exe`" % path)
            return 1

    work, home, ws = workspace()
    port = free_port()
    stub = start_stub(work, port)
    time.sleep(1.0)

    pty = ConPty([JOULE], joule_env(home, port), ws, cols=100, rows=30)
    failures = 0
    try:
        pty.wait_for(BANNER, 40, "the banner, which means the renderer sized a console")
        check(True, "the banner renders in a pseudoconsole")

        size_seen = "\x1b[?1049h" in pty.text()
        failures += not check(size_seen, "the alternate screen is entered")

        pty.write(PROMPT + "\r")
        pty.wait_for(re.escape(PROMPT), 20, "the typed line echoed back")
        check(True, "keystrokes reach the app in raw mode and echo")

        pty.wait_for(r"->\s*read", 40, "the model's read tool call")
        check(True, "a turn ran and the model called the read tool")

        pty.wait_for(r"ok:", 40, "the read tool succeeding")
        check(True, "the read tool accepted a Windows workspace path")

        pty.wait_for(r"\?\s*run", 40, "the run tool's approval prompt")
        check(True, "the run tool asked for approval")

        log = os.path.join(work, "stub_requests.log")
        served = os.path.exists(log) and os.path.getsize(log) > 0
        failures += not check(served, "the model server saw a real request")
    except AssertionError as e:
        print("FAIL %s" % e)
        failures += 1
    finally:
        pty.close()
        stub.kill()

    if failures:
        print("%d check(s) failed" % failures)
        return 1
    print("windows terminal harness: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
