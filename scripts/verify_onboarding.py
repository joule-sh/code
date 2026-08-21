# Real-pty verification for the first-run onboarding wizard (ticket #46).
# Reuses terminal_structural_harness.py's PtySession and the stub model
# server rather than duplicating them. Drives bin/joule with no resolvable
# api key from any source, scripts answers through the wizard, confirms the
# config file is written with exactly what was typed, confirms the session
# then runs a real turn through the freshly entered base url and model
# without a restart, and confirms a second launch (config file now present)
# skips the wizard entirely.

import os
import sys
import json
import shutil
import tempfile
import subprocess
import importlib.util

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

WIZARD_HEADER = "joule needs a model provider"


def no_env_config(home_dir):
    env = dict(os.environ)
    env.pop("JOULE_CODE_API_KEY", None)
    env.pop("JOULE_CODE_BASE_URL", None)
    env.pop("JOULE_CODE_MODEL", None)
    env["HOME"] = home_dir
    env["TERM"] = "xterm-256color"
    return env


def run_first_launch(work_dir, stub_port):
    repo_dir = os.path.join(work_dir, "repo")
    home_dir = os.path.join(work_dir, "home")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)

    config_path = os.path.join(home_dir, ".config", "joule-code", "config.json")
    ok(not os.path.exists(config_path), "no config file exists before the first launch")

    session = harness.PtySession([harness.JOULE_BIN], no_env_config(home_dir), repo_dir, rows=24, cols=80)
    typed_base_url = "http://127.0.0.1:%d" % stub_port
    typed_model = "onboarded-stub-model"
    typed_key = "onboarding-test-key-not-real"
    try:
        session.wait_for(WIZARD_HEADER, timeout=10.0)
        ok(True, "the onboarding wizard appears on first launch with no resolvable api key")

        session.wait_for("provider", timeout=5.0)
        session.wait_for("3) custom", timeout=5.0)
        ok(True, "the wizard offers a provider shortlist including custom")

        session.write("3")
        session.wait_for("base url:", timeout=5.0)
        ok(True, "choosing custom moves to the base url field")

        session.write(typed_base_url + "\r")
        session.wait_for("model:", timeout=5.0)
        session.write(typed_model + "\r")

        session.wait_for("api key:", timeout=5.0)
        session.write(typed_key + "\r")

        session.wait_for("saved to ~/.config/joule-code/config.json", timeout=5.0)
        ok(True, "the wizard confirms it saved the config file")

        session.wait_for(harness.BANNER, timeout=10.0)
        ok(True, "normal startup continues right after the wizard, in the same process")

        session.settle(0.2, 1.5)
        full = harness.text(bytes(session.raw))
        ok(typed_model in full, "the welcome box shows the model just entered in the wizard, not a restart placeholder")

        session.write("say hi\r")
        session.wait_for(harness.TOOL_CALL_MARKER, timeout=10.0)
        ok(True, "a real turn was driven through the freshly entered base url without restarting")
        session.wait_for(harness.APPROVAL_MARKER, timeout=10.0)
        session.write("y")
        session.wait_for("Done.", timeout=15.0)
        session.settle(0.3, 2.0)
        ok(True, "the full scripted turn completed against the wizard-entered base url")

        session.write(chr(4))
        ok(session.wait_exit(5.0), "joule exits cleanly on ctrl-d after onboarding")
    finally:
        session.close()

    ok(os.path.exists(config_path), "the config file exists on disk after the wizard ran")
    if os.path.exists(config_path):
        with open(config_path) as f:
            saved = json.load(f)
        ok(saved.get("baseUrl") == typed_base_url, "the saved baseUrl matches what was typed, got %r" % saved.get("baseUrl"))
        ok(saved.get("model") == typed_model, "the saved model matches what was typed, got %r" % saved.get("model"))
        ok(saved.get("apiKey") == typed_key, "the saved apiKey matches what was typed")

    return home_dir, repo_dir, typed_model


def run_second_launch(home_dir, repo_dir, expected_model):
    session = harness.PtySession([harness.JOULE_BIN], no_env_config(home_dir), repo_dir, rows=24, cols=80)
    try:
        session.wait_for(harness.BANNER, timeout=10.0)
        ok(True, "the second launch starts normally straight to the banner")
        session.settle(0.2, 1.0)
        full = harness.text(bytes(session.raw))
        ok(WIZARD_HEADER not in full, "the onboarding wizard does not appear on the second launch, now that a config file exists")
        ok(expected_model in full, "the second launch's welcome box shows the model saved by the wizard")
    finally:
        session.write(chr(4))
        session.wait_exit(5.0)
        session.close()


def main():
    work_dir = tempfile.mkdtemp(prefix="joule-onboarding-verify-")
    stub_log = os.path.join(work_dir, "stub_requests.log")
    stub_port = harness.free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub_env["E2E_STUB_LOG"] = stub_log
    stub_proc = subprocess.Popen([harness.STUB_BIN], env=stub_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        if not harness.wait_for_port(stub_port, 5.0):
            raise harness.Failure("stub model server did not start")

        home_dir, repo_dir, typed_model = run_first_launch(work_dir, stub_port)

        if os.path.exists(stub_log):
            with open(stub_log) as f:
                log_contents = f.read()
            ok('"model":"' + typed_model + '"' in log_contents, "the stub model server actually received a request naming the wizard-entered model")

        run_second_launch(home_dir, repo_dir, typed_model)
    finally:
        stub_proc.terminate()
        try:
            stub_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            stub_proc.kill()
        shutil.rmtree(work_dir, ignore_errors=True)

    if failures:
        print("\n%d failure(s):" % len(failures), file=sys.stderr)
        for f in failures:
            print(" - " + f, file=sys.stderr)
        sys.exit(1)
    print("\nonboarding wizard verification passed")


if __name__ == "__main__":
    main()
