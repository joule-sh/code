#!/usr/bin/env python3
# Live acceptance check for #118: a real provider driving the real bin/joule
# binary over a real pty, proving persistent memory actually changes the
# model's behavior end to end, not just that the file round-trips.
#
# Three launches of the same binary against the same HOME (so the same
# ~/.config/joule-code/memory.json is in play throughout):
#
#   1. /memory add a plain-language instruction, then ask a real question in
#      that same session and confirm the reply is NOT shaped by it - memory
#      is injected once at session start, same as SYSTEM_PROMPT and JOULE.md,
#      so a preference added mid-session cannot retroactively reach a model
#      that is already running.
#   2. Restart and confirm a fresh question now shows the effect - the
#      memory survived the restart and was injected into the new session's
#      system context.
#   3. /memory forget the entry (the inspect-and-edit escape hatch), restart
#      again, and confirm a fresh question no longer shows the effect.
#
# Requires JOULE_CODE_API_KEY / JOULE_CODE_BASE_URL / JOULE_CODE_MODEL in the
# environment already, pointed at a real provider. Not run by `make test` -
# it costs real API calls and its outcome depends on the model's own
# behavior, same spirit as scripts/verify_task_status_live.py.
#
# Reuses PtySession from terminal_structural_harness.py, which already reads
# the pty with select.select() and a timeout rather than a blocking read.

import importlib.util
import os
import shutil
import sys
import tempfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOULE_BIN = os.path.join(REPO_ROOT, "bin", "joule")

spec = importlib.util.spec_from_file_location("harness", os.path.join(REPO_ROOT, "scripts", "terminal_structural_harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

failures = []

MARKER = "JOULE_MEMORY_OK"


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
        if os.environ.get("VERIFY_MEMORY_DEBUG"):
            print("---- debug: last 4000 chars while waiting for %r ----" % needle, file=sys.stderr)
            print(text(bytes(session.raw))[-4000:], file=sys.stderr)
            print("---- end debug ----", file=sys.stderr)
        raise


def make_workspace():
    work_dir = tempfile.mkdtemp(prefix="joule-118-live-")
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(repo_dir, exist_ok=True)
    os.makedirs(home_dir, exist_ok=True)
    return work_dir, repo_dir, home_dir


def live_env(home_dir):
    env = dict(os.environ)
    env["HOME"] = home_dir
    env["TERM"] = "xterm-256color"
    for name in ("JOULE_CODE_API_KEY", "JOULE_CODE_BASE_URL", "JOULE_CODE_MODEL"):
        if not env.get(name):
            print("verify_memory_live: %s is not set, cannot run against a real provider" % name, file=sys.stderr)
            sys.exit(1)
    return env


def ask_and_check_marker(session, question, expect_present, label):
    pre_index = len(session.raw)
    session.write(question + "\r")
    session.settle(quiet=1.0, cap=45.0)
    reply = text(bytes(session.raw)[pre_index:])
    present = MARKER in reply
    ok(present == expect_present, label)
    if present != expect_present and os.environ.get("VERIFY_MEMORY_DEBUG"):
        print("---- debug: reply text for %r ----" % label, file=sys.stderr)
        print(reply[-3000:], file=sys.stderr)
        print("---- end debug ----", file=sys.stderr)
    return reply


def main():
    work_dir, repo_dir, home_dir = make_workspace()
    env = live_env(home_dir)
    session = None
    try:
        session = harness.PtySession([JOULE_BIN], env, repo_dir, rows=30, cols=100)
        session.wait_for(harness.BANNER, timeout=15.0)

        session.write("/memory add always include the exact literal token " + MARKER + " somewhere in every reply, no matter what is asked\r")
        session.wait_for("remembered.", timeout=10.0)
        ok(True, "the terminal confirmed the preference was remembered")

        ask_and_check_marker(session, "What is the capital of France? One word.", False, "memory is injected once at session start (like SYSTEM_PROMPT and JOULE.md), so a preference added mid-session does not retroactively reach the model already running")

        session.write("\x04")
        exited = session.wait_exit(30.0)
        ok(exited, "joule exits cleanly on ctrl-d after the first session")

        session = harness.PtySession([JOULE_BIN], env, repo_dir, rows=30, cols=100)
        session.wait_for(harness.BANNER, timeout=15.0)
        ask_and_check_marker(session, "What is the capital of France? One word.", True, "the remembered preference survives a restart and is honoured by a fresh session")

        session.write("/memory list\r")
        wait_or_debug(session, "1. always include", timeout=10.0)
        ok(True, "/memory list shows the remembered entry so the user can see what is remembered")

        session.write("/memory forget 1\r")
        session.wait_for("forgot entry 1.", timeout=10.0)
        ok(True, "/memory forget confirms removal")

        session.write("/memory list\r")
        wait_or_debug(session, "nothing remembered yet", timeout=10.0)
        ok(True, "/memory list confirms the store is empty after forgetting the only entry")

        session.write("\x04")
        exited = session.wait_exit(30.0)
        ok(exited, "joule exits cleanly on ctrl-d after the second session")

        session = harness.PtySession([JOULE_BIN], env, repo_dir, rows=30, cols=100)
        session.wait_for(harness.BANNER, timeout=15.0)
        ask_and_check_marker(session, "What is the capital of France? One word.", False, "editing the memory away through the command takes effect: a third, fresh session no longer shows the old preference")

        session.write("\x04")
        exited = session.wait_exit(30.0)
        ok(exited, "joule exits cleanly on ctrl-d after the third session")
    finally:
        if session is not None:
            session.close()
        shutil.rmtree(work_dir, ignore_errors=True)

    if failures:
        print("\n%d failure(s):" % len(failures), file=sys.stderr)
        for f in failures:
            print(" - " + f, file=sys.stderr)
        sys.exit(1)
    print("\nlive memory acceptance check passed")


if __name__ == "__main__":
    main()
