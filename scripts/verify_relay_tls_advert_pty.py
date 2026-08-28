import json
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


def signed_in_home(prefix, relay_url, relay_ws_url):
    home = scratch.scratch_dir(prefix + "-")
    cfg_dir = os.path.join(home, ".config", "joule-code")
    os.makedirs(cfg_dir, exist_ok=True)
    server = "http://joule-relay-tls.invalid"
    line = json.dumps({
        "server": server,
        "secret": "e2e-relay-tls-secret",
        "accountId": "", "accountEmail": "",
        "keyId": "key_harness", "keyPrefix": "jl_ha",
        "scopes": "", "savedAt": str(int(time.time() * 1000)),
        "relayUrl": relay_url, "relayWsUrl": relay_ws_url,
        "webUrl": server + "/terminal/sessions",
    })
    with open(os.path.join(cfg_dir, "credentials.jsonl"), "w") as f:
        f.write(line + "\n")
    with open(os.path.join(cfg_dir, "config.json"), "w") as f:
        f.write(json.dumps({"baseUrl": "", "model": "", "apiKey": "", "server": server, "updateCheck": "", "mouse": ""}))
    return home


def main():
    workspace = scratch.scratch_dir("joule-relay-tls-pty-")
    with open(os.path.join(workspace, "README.md"), "w") as f:
        f.write("# demo\n")

    stub_port = free_port()
    stub_env = dict(os.environ)
    stub_env["E2E_STUB_PORT"] = str(stub_port)
    stub = subprocess.Popen([os.path.join(REPO_ROOT, "bin", "stub_model")], cwd=workspace, env=stub_env)

    home = signed_in_home(
        "joule-relay-tls-home",
        "https://127.0.0.1:9/relay",
        "wss://127.0.0.1:8444/relay-terminal",
    )

    env = dict(os.environ)
    for k in ("JOULE_CODE_SERVER", "JOULE_RELAY_URL", "JOULE_RELAY_WS_URL", "JOULE_WEB_BASE_URL"):
        env.pop(k, None)
    env["TERM"] = "xterm-256color"
    env["HOME"] = home
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:%d" % stub_port
    env["JOULE_CODE_MODEL"] = "stub-model"
    env["JOULE_CODE_API_KEY"] = "test-key"

    session = None
    try:
        ok(harness.wait_for_port(stub_port, 5.0), "stub model came up")

        # The relay's HTTP address here answers nothing (port 9 is discard),
        # so the share cannot get far - which is the point. What it reports
        # tells us how far it got: naming the relay it tried means the wss://
        # advert was taken as an address to dial, not as a reason to stop.
        started = time.time()
        session = PtySession([os.path.join(REPO_ROOT, "bin", "joule"), "--share"], env, workspace, rows=24, cols=100)
        idx = session.wait_for("cannot reach the relay", timeout=30.0)
        elapsed = time.time() - started
        ok(True, "the share reported the relay it tried within %.2fs, not a silent hang" % elapsed)

        seen = harness.text(bytes(session.raw))
        ok("https://127.0.0.1:9/relay" in seen, "it names the relay address it actually tried")
        ok("needs TLS" not in seen, "a wss:// terminal socket is no longer refused up front (#321)")
        ok("can only open a plain TCP socket" not in seen, "the old plain-TCP refusal is gone")
        ok("advertise a plain ws://" not in seen, "it no longer asks the operator to turn TLS off")
    finally:
        if session is not None:
            session.close()
        stub.terminate()
        try:
            stub.wait(timeout=3)
        except Exception:
            stub.kill()
        shutil.rmtree(workspace, ignore_errors=True)
        shutil.rmtree(home, ignore_errors=True)

    if failures:
        print("\n%d check(s) failed" % len(failures), file=sys.stderr)
        sys.exit(1)
    print("\nPASS: a relay advertised over wss:// is dialled rather than refused - the share gets as far as the relay's own address and reports what happened there, with no trace of the plain-TCP refusal #321 put in front of it")


if __name__ == "__main__":
    main()
