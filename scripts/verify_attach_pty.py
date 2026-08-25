import os
import sys
import shutil
import socket
import subprocess
import time
import scratch
import importlib.util

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("harness", os.path.join(REPO_ROOT, "scripts", "terminal_structural_harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

PtySession = harness.PtySession
text = harness.text
wait_for_port = harness.wait_for_port

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


def main():
    workspace = scratch.scratch_dir("joule-attach-pty-")
    with open(os.path.join(workspace, "README.md"), "w") as f:
        f.write("# demo\n")

    stub_port = free_port()
    daemon_port = free_port()

    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub = subprocess.Popen([os.path.join(REPO_ROOT, "bin", "stub_model")], cwd=workspace, env=stub_env)

    daemon_env = dict(os.environ)
    daemon_env["JOULE_DAEMON_PORT"] = str(daemon_port)
    daemon_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    daemon_env["JOULE_CODE_MODEL"] = "stub-model"
    daemon_env["JOULE_CODE_API_KEY"] = "test-key"
    daemon_log = open(os.path.join(workspace, "daemon.log"), "w")
    daemon = subprocess.Popen([os.path.join(REPO_ROOT, "bin", "joule-daemon")], cwd=workspace, env=daemon_env, stdout=daemon_log, stderr=daemon_log)

    session = None
    try:
        ok(wait_for_port(stub_port, 5.0), "stub model came up")
        ok(wait_for_port(daemon_port, 5.0), "daemon came up")

        # The daemon already wrote its own info file under the real HOME
        # (lifecycle.ts's writeDaemonInfo) as part of coming up above, so
        # `joule attach` just needs to run with that same HOME to find it.
        # attach mode never touches the model itself (the daemon owns that),
        # but loadConfig() still runs and would trip onboarding without a
        # key present, so it gets the same harmless stub credentials.
        attach_env = dict(os.environ)
        attach_env["TERM"] = "xterm-256color"
        attach_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
        attach_env["JOULE_CODE_MODEL"] = "stub-model"
        attach_env["JOULE_CODE_API_KEY"] = "test-key"

        session = PtySession([os.path.join(REPO_ROOT, "bin", "joule"), "attach"], attach_env, workspace, rows=24, cols=80)
        session.wait_for("connected to a daemon", timeout=8.0)
        ok(True, "attach TUI connected to the daemon over a real pty")

        session.write("fix the health route\r")
        session.wait_for("Let me check the README", timeout=8.0)
        ok(True, "streamed model text rendered in the attached terminal")

        session.wait_for("run", timeout=8.0)
        session.write("y")
        session.wait_for("Done.", timeout=8.0)
        ok(True, "the turn completed after approving the run tool from the attached terminal")

        with open(os.path.join(workspace, "README.md")) as f:
            content = f.read()
        ok("Added a health check note." in content, "the tool's effect landed on the real workspace filesystem")

        session.write("\x04")
        ok(session.wait_exit(5.0), "joule attach exits cleanly on ctrl-d")
    finally:
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
        shutil.rmtree(workspace, ignore_errors=True)

    if failures:
        print("\n%d check(s) failed" % len(failures), file=sys.stderr)
        sys.exit(1)
    print("\nlive-pty attach verification passed")


if __name__ == "__main__":
    main()
