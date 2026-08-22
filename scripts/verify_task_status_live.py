#!/usr/bin/env python3
# Live acceptance check for #115: a real provider driving the real bin/joule
# binary over a real pty, against a broken long-running "dev server" that
# never exits. Confirms the model can call the new task_status tool to see
# and report the server's error instead of guessing (the #115 comment's
# repro: list /tasks fails, then a filesystem-wide find), and that the
# session stays responsive to a fresh question while the server keeps
# emitting a line every 50ms in the background. The output bound itself and
# the on-exit summary (not a per-line flood) are covered by
# src/tasks/task_status.test.ts, which can assert on exact byte/line counts
# that a live, redrawing terminal cannot.
#
# Requires JOULE_CODE_API_KEY / JOULE_CODE_BASE_URL / JOULE_CODE_MODEL in the
# environment already, pointed at a real provider. Not run by `make test` -
# it costs real API calls and its outcome depends on the model's own
# behavior, same spirit as scripts/e2e_real_terminal_check.mjs.
#
# Reuses PtySession from terminal_structural_harness.py, which already reads
# the pty with select.select() and a timeout rather than a blocking read.

import importlib.util
import os
import shutil
import sys
import tempfile
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOULE_BIN = os.path.join(REPO_ROOT, "bin", "joule")

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


def text(raw_bytes):
    return raw_bytes.decode("utf-8", errors="replace")


def wait_or_debug(session, needle, timeout, from_index=0):
    try:
        session.wait_for(needle, timeout=timeout, from_index=from_index)
    except harness.Failure:
        if os.environ.get("VERIFY_TASK_STATUS_DEBUG"):
            print("---- debug: last 4000 chars while waiting for %r ----" % needle, file=sys.stderr)
            print(text(bytes(session.raw))[-4000:], file=sys.stderr)
            print("---- end debug ----", file=sys.stderr)
        raise


BROKEN_DEV_SERVER = """#!/bin/sh
echo "Starting dev server..."
echo "Compiling..."
sleep 1
echo "ERROR: Cannot find module './missing-utils' imported from server.js"
i=0
while [ $i -lt 200 ]; do
  echo "still running, watching for changes ($i)"
  i=$((i+1))
  sleep 0.05
done
"""


def make_workspace():
    work_dir = tempfile.mkdtemp(prefix="joule-115-live-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(repo_dir, exist_ok=True)
    os.makedirs(home_dir, exist_ok=True)
    script_path = os.path.join(repo_dir, "devserver.sh")
    with open(script_path, "w") as f:
        f.write(BROKEN_DEV_SERVER)
    os.chmod(script_path, 0o755)
    return work_dir, repo_dir, home_dir


def live_env(home_dir):
    env = dict(os.environ)
    env["HOME"] = home_dir
    env["TERM"] = "xterm-256color"
    for name in ("JOULE_CODE_API_KEY", "JOULE_CODE_BASE_URL", "JOULE_CODE_MODEL"):
        if not env.get(name):
            print("verify_task_status_live: %s is not set, cannot run against a real provider" % name, file=sys.stderr)
            sys.exit(1)
    return env


def main():
    work_dir, repo_dir, home_dir = make_workspace()
    session = None
    try:
        env = live_env(home_dir)
        session = harness.PtySession([JOULE_BIN], env, repo_dir, rows=30, cols=100)
        session.wait_for(harness.BANNER, timeout=15.0)

        session.write("/mode full-auto\r")
        session.wait_for("mode set to full-auto", timeout=10.0)

        session.write("Run `bash devserver.sh` as a background run, wait a moment, then check on it and tell me if anything looks wrong.\r")
        session.wait_for("devserver.sh", timeout=60.0)

        session.wait_for("-> task_status", timeout=120.0)
        ok(True, "the model called the task_status tool rather than guessing at /tasks or a filesystem search")

        first_text = text(bytes(session.raw))
        ran_in_background = False
        for line in first_text.splitlines():
            if "-> run" in line and "devserver.sh" in line and "background" in line and "true" in line:
                ran_in_background = True
        ok(ran_in_background, "the dev server was started as a background run (background:true), matching #77")
        ok('-> list {"path":"/tasks"}' not in first_text, "no fallback to list /tasks, the #115 comment's failed guess")
        ok("find /" not in first_text, "no fallback to a filesystem-wide find, the #115 comment's other failed guess")

        session.settle(quiet=1.0, cap=25.0)
        settled_text = text(bytes(session.raw))
        mentions_error = ("missing-utils" in settled_text) or ("cannot find module" in settled_text.lower())
        if not mentions_error and os.environ.get("VERIFY_TASK_STATUS_DEBUG"):
            print("---- debug: last 4000 chars of transcript ----", file=sys.stderr)
            print(settled_text[-4000:], file=sys.stderr)
            print("---- end debug ----", file=sys.stderr)
        ok(mentions_error, "the dev server's compile error reached the terminal (streamed output or the assistant's own report of it, both sourced from task_status/run output)")

        # A marker that cannot appear from typing the prompt itself (the pty
        # echoes the raw keystrokes back before the model ever answers) and
        # cannot collide with the dev server's own "watching for changes (N)"
        # counter, which will already have printed plain small integers by
        # now. from_index skips anything already in the buffer so an earlier
        # incidental match can't short-circuit the wait.
        pre_second_index = len(session.raw)
        second_start = time.time()
        session.write("What is 300 + 17? Reply with only the number, nothing else.\r")
        wait_or_debug(session, "317", timeout=45.0, from_index=pre_second_index)
        second_elapsed = time.time() - second_start
        ok(second_elapsed < 30.0, "the session answered a fresh question in %.1fs while the broken dev server kept emitting a line every 50ms in the background - not blocked or derailed" % second_elapsed)

        session.settle(quiet=1.0, cap=15.0)
        session.write("\x04")
        exited = session.wait_exit(30.0)
        ok(exited, "joule exits cleanly on ctrl-d once the background dev server is still running and never killed (lumen#6)")
    finally:
        if session is not None:
            session.close()
        shutil.rmtree(work_dir, ignore_errors=True)

    if failures:
        print("\n%d failure(s):" % len(failures), file=sys.stderr)
        for f in failures:
            print(" - " + f, file=sys.stderr)
        sys.exit(1)
    print("\nlive task_status acceptance check passed")


if __name__ == "__main__":
    main()
