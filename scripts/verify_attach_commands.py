import os
import sys
import shutil
import socket
import subprocess
import tempfile
import time
import importlib.util

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("harness", os.path.join(REPO_ROOT, "scripts", "terminal_structural_harness.py"))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

PtySession = harness.PtySession
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
    workspace = tempfile.mkdtemp(prefix="joule-attach-commands-")
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

        attach_env = dict(os.environ)
        attach_env["TERM"] = "xterm-256color"
        attach_env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
        attach_env["JOULE_CODE_MODEL"] = "stub-model"
        attach_env["JOULE_CODE_API_KEY"] = "test-key"

        session = PtySession([os.path.join(REPO_ROOT, "bin", "joule"), "attach"], attach_env, workspace, rows=24, cols=80)
        session.wait_for("connected to a daemon", timeout=8.0)
        ok(True, "attach TUI connected to the daemon over a real pty")

        session.write("/mode\r")
        session.wait_for("mode: auto-edit", timeout=5.0)
        ok(True, "/mode with no argument shows the daemon's current mode")

        session.write("/mode full-auto\r")
        session.wait_for("mode set to full-auto", timeout=5.0)
        ok(True, "/mode full-auto is accepted and echoed back as mode set to full-auto")

        session.write("/mode not-a-real-mode\r")
        session.wait_for("mode.invalid", timeout=5.0)
        ok(True, "an invalid /mode argument comes back as a mode.invalid error, not silently accepted")

        session.write("/model\r")
        session.wait_for("model: stub-model", timeout=5.0)
        ok(True, "/model with no argument shows the current model")

        session.write("/model attach-test-model\r")
        session.wait_for("model set to attach-test-model", timeout=5.0)
        ok(True, "/model <name> is accepted and echoed back as model set to <name>")

        session.write("/tasks\r")
        session.wait_for("no background tasks", timeout=5.0)
        ok(True, "/tasks answers with the (empty) task listing from the daemon")

        session.write("/share\r")
        session.wait_for("asking the daemon to share this session over the relay", timeout=5.0)
        ok(True, "/share now asks the daemon to start sharing, instead of refusing outright")
        session.wait_for("could not attach to the relay", timeout=5.0)
        ok(True, "with no relay reachable in this harness, the daemon reports share.failed rather than hanging or crashing")

        session.write("/help\r")
        session.wait_for("stop-daemon", timeout=5.0)
        ok(True, "/help lists /stop-daemon now that it exists")

        session.write("\x04")
        ok(session.wait_exit(5.0), "joule attach exits cleanly on ctrl-d after exercising the new commands")
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
    print("\nattach command-parity verification passed")


if __name__ == "__main__":
    main()
