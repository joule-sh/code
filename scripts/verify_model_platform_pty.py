#!/usr/bin/env python3
# Acceptance check for the platform-qualified model name, driving the real
# bin/joule binary over a real pty.
#
# Four things this proves that a unit test cannot:
#
#   1. The welcome box and /model both name the platform a model came from,
#      so a model is never shown as a bare name that two platforms could each
#      have served.
#   2. The name that goes over the wire is still the one the platform itself
#      knows. A provider reached directly is sent "deepseek-chat"; the prefix
#      is display, not something the provider is asked to understand. The
#      check reads the stub's logged request bodies, so it is about what went
#      over the wire rather than what a function returned.
#   3. The qualified name that was just shown can be typed straight back into
#      /model and lands on the same model, so what is displayed round-trips.
#   4. A base url this build knows no platform for - the console, which serves
#      its models under ids that already carry the platform - has the model id
#      passed through untouched, which is what a console-issued
#      "deepseek/deepseek-chat" needs.
#
# The base url in the first case names a platform and still reaches the stub:
# the platform is read off the url's text and the stub answers on any path, so
# one url does both. That is what lets a real turn run against a real binary
# on a box with no provider credentials.
#
# Reuses PtySession and friends from terminal_structural_harness.py.

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOULE_BIN = os.path.join(REPO_ROOT, "bin", "joule")
STUB_BIN = os.path.join(REPO_ROOT, "bin", "stub_model")

spec = importlib.util.spec_from_file_location("harness", os.path.join(REPO_ROOT, "scripts", "terminal_structural_harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

PtySession = harness.PtySession
free_port = harness.free_port
wait_for_port = harness.wait_for_port
text = harness.text
BANNER = harness.BANNER

failures = []


def ok(cond, label):
    if cond:
        print("ok: " + label)
    else:
        failures.append(label)
        print("FAIL: " + label, file=sys.stderr)


def start_case(prefix, base_url_suffix, model):
    work_dir = tempfile.mkdtemp(prefix=prefix)
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)

    stub_port = free_port()
    log_path = os.path.join(work_dir, "stub_requests.log")
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = log_path
    stub_env["E2E_STUB_SCRIPT"] = ""
    stub = subprocess.Popen([STUB_BIN], env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_for_port(stub_port, 5.0):
        raise harness.Failure("stub model server did not start")

    env = dict(os.environ)
    env["HOME"] = home_dir
    env["TERM"] = "xterm-256color"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d%s" % (stub_port, base_url_suffix)
    env["JOULE_CODE_MODEL"] = model
    env["JOULE_CODE_API_KEY"] = "stub-key"

    session = PtySession([JOULE_BIN], env, repo_dir, rows=40, cols=200)
    session.wait_for(BANNER, timeout=60.0)
    return work_dir, log_path, stub, session


def stop(work_dir, stub, session):
    try:
        if session is not None:
            session.close()
    except Exception:
        pass
    try:
        stub.terminate()
        stub.wait(timeout=5)
    except Exception:
        pass
    shutil.rmtree(work_dir, ignore_errors=True)


def wire_models(log_path, want, timeout=20.0):
    """Every "model" a request body carried, once at least `want` have arrived."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        seen = []
        if os.path.exists(log_path):
            with open(log_path) as f:
                blob = f.read()
            for record in blob.split("\n<<<END>>>\n"):
                mark = record.find('"model":"')
                if mark >= 0:
                    rest = record[mark + len('"model":"'):]
                    seen.append(rest[:rest.find('"')])
        if len(seen) >= want:
            return seen
        time.sleep(0.1)
    return seen


def drive_turn(session, prompt):
    """Start a turn and let it reach the model; the approval it then raises is
    not this check's subject, so nothing answers it."""
    session.write(prompt + "\r")
    session.settle(0.4, 8.0)


def known_platform_case():
    """A provider reached directly: shown with its platform, sent without it."""
    work_dir, log_path, stub, session = start_case("joule-model-platform-known-", "/api.deepseek.com", "deepseek-chat")
    try:
        session.settle(0.3, 2.0)
        full = text(bytes(session.raw))
        ok("deepseek/deepseek-chat" in full,
           "the welcome box names the platform the model came from")

        mark = len(session.raw)
        session.write("/model\r")
        session.wait_for("model: deepseek/deepseek-chat", timeout=10.0, from_index=mark)
        ok(True, "/model with no argument answers with the platform-qualified name")

        mark = len(session.raw)
        session.write("/model deepseek/deepseek-chat\r")
        session.wait_for("model set to deepseek/deepseek-chat", timeout=10.0, from_index=mark)
        ok(True, "the qualified name that was shown is accepted back by /model")

        mark = len(session.raw)
        session.write("/model\r")
        session.wait_for("model: deepseek/deepseek-chat", timeout=10.0, from_index=mark)
        ok(True, "the model survives that round trip unchanged")

        drive_turn(session, "say hi")
        seen = wire_models(log_path, 1)
        ok(seen[:1] == ["deepseek-chat"],
           "the wire carries the name the platform knows, not the qualified one (saw %r)" % (seen[:1],))
    finally:
        stop(work_dir, stub, session)


def unknown_platform_case():
    """The console: its model ids already carry the platform, so nothing is added
    and nothing is taken away."""
    work_dir, log_path, stub, session = start_case("joule-model-platform-console-", "", "deepseek/deepseek-chat")
    try:
        session.settle(0.3, 2.0)
        full = text(bytes(session.raw))
        ok("deepseek/deepseek-chat" in full,
           "a console-issued model id is shown as the console issued it")

        mark = len(session.raw)
        session.write("/model\r")
        session.wait_for("model: deepseek/deepseek-chat", timeout=10.0, from_index=mark)
        ok(True, "/model answers with the console's own model id")

        drive_turn(session, "say hi")
        seen = wire_models(log_path, 1)
        ok(seen[:1] == ["deepseek/deepseek-chat"],
           "the console's model id goes over the wire untouched (saw %r)" % (seen[:1],))
    finally:
        stop(work_dir, stub, session)


def bare_model_case():
    """No platform to name: the model is shown exactly as it was configured."""
    work_dir, log_path, stub, session = start_case("joule-model-platform-bare-", "", "stub-model")
    try:
        mark = len(session.raw)
        session.write("/model\r")
        session.wait_for("model: stub-model", timeout=10.0, from_index=mark)
        ok(True, "a model on an unrecognised base url keeps the name it was given")
    finally:
        stop(work_dir, stub, session)


def main():
    if not os.path.exists(JOULE_BIN) or not os.path.exists(STUB_BIN):
        print("build bin/joule and bin/stub_model first (make build bin/stub_model)", file=sys.stderr)
        return 2
    known_platform_case()
    unknown_platform_case()
    bare_model_case()
    if failures:
        print("\n%d check(s) failed" % len(failures), file=sys.stderr)
        return 1
    print("\nall model-platform checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
