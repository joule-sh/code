#!/usr/bin/env python3
# Starts the real bin/joule.exe inside a real Windows pseudoconsole and drives
# a turn against bin/stub_model.exe. The point is that `joule --version`
# exiting 0 says nothing about the half of a Windows port that had to be
# written from scratch - raw mode, VT input, console size, keys arriving as
# bytes - and this repository has been bitten before by a green harness over a
# product that did not work (#233, #235).
#
# It asserts two different things through two different windows, deliberately.
#
# What the terminal does is asserted against the pseudoconsole's byte stream:
# the banner renders, the alternate screen is entered, a typed line echoes.
# Those are the things only a terminal can tell you and they are stable.
#
# What the turn did is asserted twice over: against the session joule
# persisted and the requests the model server logged, and against the screen.
# The session file is where the turn's outcome lives and it stayed
# byte-correct all through #248; the screen is where #248 actually was, so a
# harness that reads only the first of the two would have stayed green through
# a build nobody could use.
#
# The turn it drives runs through a daemon, because that is what joule does on
# Windows now (#173). What the daemon itself has to do - spawn detached,
# outlive its client, take a second client, stop on request - is asserted by
# win_daemon_harness.py rather than here.
#
# What it deliberately does not assert, because it does not work yet and is
# tracked on #173 rather than hidden here:
#   background tasks and --share, neither of which start on Windows

import glob
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from win_conpty import ConPty

# What this prints on a failure is a dump of a terminal, box drawing and all,
# and a Windows console that has not been told otherwise encodes stdout as
# cp1252 - so the diagnostic died encoding itself and hid the failure it was
# there to report.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOULE = os.path.join(REPO_ROOT, "bin", "joule.exe")
STUB = os.path.join(REPO_ROOT, "bin", "stub_model.exe")

PROMPT = "summarise the readme"
README = "# demo workspace\n\nA line the model will read.\n"

ASSISTANT_LINES = ["Let me check the README first.",
                   "No health route yet. I will fix it.",
                   "Done."]

# The shapes #248 drew into the pane: a window into the request body, and a
# line carrying a C0 byte after the pane has already had its escapes stripped.
# Neither can reach the screen from anything the renderer legitimately holds.
LEAKED_MARKERS = ['"tool_calls"', '"content":"', '"role":"assistant"',
                  '"messages":', "Bearer "]


def leaked_lines(pane):
    out = []
    for line in pane.splitlines():
        if any(m in line for m in LEAKED_MARKERS):
            out.append(line)
            continue
        if any(ord(c) < 32 and c != "\t" for c in line):
            out.append(line)
    return out


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
        f.write(README)
    return work, home, ws


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


def on_screen(pty, text, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if text in pty.plain():
            return True
        time.sleep(0.1)
    return text in pty.plain()


def stop_daemon(ws, env):
    try:
        subprocess.run([JOULE, "--stop"], cwd=ws, env=env, timeout=60,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError):
        pass


class Checks(object):
    def __init__(self):
        self.failed = 0

    def that(self, passed, label):
        print(("ok   " if passed else "FAIL ") + label)
        if not passed:
            self.failed += 1
        return passed


def role_texts(history, role):
    return [m.get("text", "") for m in history if m.get("role") == role]


def tool_calls(history):
    out = []
    for m in history:
        for call in m.get("toolCalls", []):
            out.append((call.get("tool"), call.get("args", "")))
    return out


def main():
    for path in (JOULE, STUB):
        if not os.path.exists(path):
            print("FAIL missing %s - run `make build bin/stub_model.exe`" % path)
            return 1

    work, home, ws = workspace()
    port = free_port()
    stub_log = os.path.join(work, "stub_requests.log")
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(port)
    stub_env["E2E_STUB_LOG"] = stub_log
    stub = subprocess.Popen([STUB], env=stub_env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    time.sleep(1.0)

    pty = ConPty([JOULE], joule_env(home, port), ws, cols=100, rows=30)
    checks = Checks()
    try:
        pty.wait_for(r"type a request", 60, "the banner")
        checks.that(True, "the banner renders in a pseudoconsole")
        checks.that("\x1b[?1049h" in pty.text(), "the alternate screen is entered")

        pty.write(PROMPT + "\r")
        pty.wait_for(re.escape(PROMPT), 30, "the typed line echoed back")
        checks.that(True, "keystrokes reach the app in raw mode and echo")

        # The approval prompt is the one screen element the turn cannot get
        # past without an answer, and it renders reliably.
        pty.wait_for(r"\?\s*run", 60, "the run tool's approval prompt")
        checks.that(True, "the run tool asked for approval")
        pty.write("\r")

        history = session_history(home, 60)
        if history is None:
            raise AssertionError(
                "joule never persisted a session with a completed turn\n"
                "--- last 2500 characters ---\n%s" % pty.plain()[-2500:])

        checks.that(PROMPT in role_texts(history, "user"),
                    "the turn recorded what was typed")
        called = [name for name, _ in tool_calls(history)]
        checks.that("read" in called, "the model called the read tool")
        checks.that("run" in called, "the model called the run tool")
        results = role_texts(history, "tool")
        checks.that(any("demo workspace" in r for r in results),
                    "the read tool read the workspace file through a Windows path")
        checks.that(any(t.strip() for t in role_texts(history, "assistant")),
                    "the model's own text came back")
        checks.that(os.path.exists(stub_log) and os.path.getsize(stub_log) > 0,
                    "the model server saw a real request")

        # Waited for rather than read once. The session above is written by the
        # daemon when the turn ends; the last line of it reaches this client
        # afterwards, over a socket, so the two are not the same moment any
        # more and a fast enough runner is the only reason they ever looked
        # like it.
        for line in ASSISTANT_LINES:
            checks.that(on_screen(pty, line),
                        "the transcript holds the assistant line %r" % line)
        pane = pty.plain()
        leaked = leaked_lines(pane)
        if leaked:
            print("     leaked rows: %r" % leaked[:4])
        checks.that(not leaked,
                    "the transcript holds nothing but what was rendered into it")

        pty.write("\x04")
        deadline = time.time() + 20
        while time.time() < deadline and pty.exit_code() is None:
            time.sleep(0.2)
        checks.that(pty.exit_code() == 0, "ctrl-d quits with a zero status")
        checks.that("\x1b[?1049l" in pty.text(),
                    "the alternate screen is left on the way out")
    except AssertionError as e:
        print("FAIL %s" % e)
        checks.failed += 1
    finally:
        pty.close()
        stop_daemon(ws, joule_env(home, port))
        stub.kill()

    if checks.failed:
        print("%d check(s) failed" % checks.failed)
        return 1
    print("windows terminal harness: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
