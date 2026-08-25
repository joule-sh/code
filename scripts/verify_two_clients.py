"""Two real terminals on one daemon session, asserted on what each one paints.

Ticket #227: a prompt typed in one client never appeared in the other, and the
two disagreed about the mode. Both are properties of the rendered screen, not
of the frames that arrived - #147 was a bug where the frames arrived and
nothing painted - so every assertion here reads the latest redraw of a real
pty and looks at the rows a person would be looking at.
"""

import os
import shutil
import socket
import subprocess
import sys
import time
import importlib.util
import scratch

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("harness", os.path.join(REPO_ROOT, "scripts", "terminal_structural_harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

PtySession = harness.PtySession
Failure = harness.Failure

ROWS = 40
COLS = 100
EXIT_TIMEOUT_S = 20.0
PORT_TIMEOUT_S = 20.0
ATTACH_TIMEOUT_S = 30.0
PAINT_TIMEOUT_S = 30.0
PROMPT_FROM_B = "what does the health route do"
PROMPT_FROM_A = "and where does it live"

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


def painted_rows(session):
    session._pump(0.05)
    try:
        block = harness.last_redraw_block(harness.text(session.raw))
    except Failure:
        return []
    return [row.rstrip() for row in harness.visible_rows(block)]


def rows_holding(session, needle):
    return [row for row in painted_rows(session) if needle in row]


def wait_painted(session, needle, timeout, label):
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = rows_holding(session, needle)
        if rows:
            ok(True, label)
            return rows
        time.sleep(0.1)
    print("  the last screen this client painted held:", file=sys.stderr)
    for row in painted_rows(session):
        if row.strip() != "":
            print("    " + row, file=sys.stderr)
    ok(False, label)
    return []


def attach_session(env, workspace):
    session = PtySession([os.path.join(REPO_ROOT, "bin", "joule"), "attach"], env, workspace, rows=ROWS, cols=COLS)
    session.wait_for("connected to a daemon", timeout=ATTACH_TIMEOUT_S)
    return session


def main():
    root = scratch.scratch_dir("joule-two-clients-")
    workspace = os.path.join(root, "workspace")
    home = os.path.join(root, "home")
    os.makedirs(workspace)
    os.makedirs(home)
    with open(os.path.join(workspace, "README.md"), "w") as f:
        f.write("# demo\n")

    stub_port = free_port()
    daemon_port = free_port()

    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub = subprocess.Popen([os.path.join(REPO_ROOT, "bin", "stub_model")], cwd=workspace, env=stub_env)

    daemon_env = dict(os.environ)
    daemon_env["HOME"] = home
    daemon_env["JOULE_DAEMON_PORT"] = str(daemon_port)
    daemon_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    daemon_env["JOULE_CODE_MODEL"] = "stub-model"
    daemon_env["JOULE_CODE_API_KEY"] = "test-key"
    daemon_log = open(os.path.join(root, "daemon.log"), "w")
    daemon = subprocess.Popen([os.path.join(REPO_ROOT, "bin", "joule-daemon")], cwd=workspace, env=daemon_env, stdout=daemon_log, stderr=daemon_log)

    first = None
    second = None
    latecomer = None
    try:
        ok(harness.wait_for_port(stub_port, PORT_TIMEOUT_S), "stub model came up")
        ok(harness.wait_for_port(daemon_port, PORT_TIMEOUT_S), "daemon came up")

        attach_env = dict(os.environ)
        attach_env["HOME"] = home
        attach_env["TERM"] = "xterm-256color"
        attach_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
        attach_env["JOULE_CODE_MODEL"] = "stub-model"
        attach_env["JOULE_CODE_API_KEY"] = "test-key"

        first = attach_session(attach_env, workspace)
        second = attach_session(attach_env, workspace)
        ok(True, "two terminals attached to the same daemon session over real ptys")

        ok(len(rows_holding(first, "mode: auto-edit")) == 1,
           "both terminals start out painting the mode the session actually says it is in")

        second.write("/mode full-auto\r")
        wait_painted(second, "mode set to full-auto", PAINT_TIMEOUT_S,
                     "the terminal that set the mode paints the daemon's answer")
        wait_painted(first, "mode: full-auto", PAINT_TIMEOUT_S,
                     "the other terminal's status line follows a mode set from a second client")

        latecomer = attach_session(attach_env, workspace)
        wait_painted(latecomer, "may run", PAINT_TIMEOUT_S, "a terminal attaching mid-session paints a welcome box")
        ok(any("full-auto" in row for row in rows_holding(latecomer, "may run")),
           "the welcome box of a terminal that attached after the change names the mode the session is in, not a local guess")
        wait_painted(latecomer, "mode: full-auto", PAINT_TIMEOUT_S,
                     "and its status line agrees with the terminals that were already there")

        second.write(PROMPT_FROM_B + "\r")
        painted = wait_painted(second, "> " + PROMPT_FROM_B, PAINT_TIMEOUT_S,
                               "the terminal the prompt was typed into paints it")
        ok(len(painted) == 1,
           "the terminal that typed it paints it once, not once for its own echo and once for the frame")
        wait_painted(first, "> " + PROMPT_FROM_B, PAINT_TIMEOUT_S,
                     "the prompt typed in one terminal is part of the other terminal's transcript too")
        wait_painted(latecomer, "> " + PROMPT_FROM_B, PAINT_TIMEOUT_S,
                     "and part of the transcript of the terminal that joined last")

        second.wait_for("Done.", timeout=PAINT_TIMEOUT_S)
        wait_painted(first, "Done.", PAINT_TIMEOUT_S,
                     "the answer to that prompt paints in the terminal that did not ask")

        first.write(PROMPT_FROM_A + "\r")
        painted = wait_painted(first, "> " + PROMPT_FROM_A, PAINT_TIMEOUT_S,
                               "a prompt typed in the first terminal paints there")
        ok(len(painted) == 1, "the first terminal paints its own prompt once as well")
        wait_painted(second, "> " + PROMPT_FROM_A, PAINT_TIMEOUT_S,
                     "and reaches the second terminal, so the transcript records who asked what either way round")

        leaving = [(first, "first"), (second, "second"), (latecomer, "latecomer")]
        for session, name in leaving:
            session.write("\x04")
        gone = set()
        deadline = time.time() + EXIT_TIMEOUT_S
        while len(gone) < len(leaving) and time.time() < deadline:
            for session, name in leaving:
                if name in gone:
                    continue
                session._pump(0.02)
                if session.wait_exit(0.05):
                    gone.add(name)
        for session, name in leaving:
            ok(name in gone, "the %s terminal exits cleanly on ctrl-d" % name)
    finally:
        for session in [first, second, latecomer]:
            if session is not None:
                session.close()
        daemon.terminate()
        stub.terminate()
        try:
            daemon.wait(timeout=3)
        except Exception:
            daemon.kill()
        try:
            stub.wait(timeout=3)
        except Exception:
            stub.kill()
        daemon_log.close()
        shutil.rmtree(root, ignore_errors=True)

    if failures:
        print("\n%d check(s) failed" % len(failures), file=sys.stderr)
        sys.exit(1)
    print("\ntwo-client verification passed")


if __name__ == "__main__":
    main()
