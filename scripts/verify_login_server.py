# Real-pty verification for choosing a Joule server from /login (ticket #150).
# Reuses terminal_structural_harness.py's PtySession, and stands up a fake
# Joule console that answers the sign-in exchange, so the whole path can be
# driven end to end: the default sign-in naming its server and going straight
# to the code prompt, a public plain-http address still refused, a loopback
# one accepted, the chosen server persisting to the config file and turning up
# in the next run's welcome box, and a server pinned by JOULE_CODE_SERVER
# offering no choice it would then override.

import os
import sys
import json
import stat
import shutil
import tempfile
import threading
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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


BODY = json.dumps({
    "credential": {"secret": "jl_secret_not_real", "id": "key_1", "keyPrefix": "jl_ab", "scopes": "search,retrieve"},
    "account": {"id": "acct_1", "email": "dev@example.com"},
}).encode()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(length)
        if self.path != "/terminal/exchange":
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(BODY)))
        self.end_headers()
        self.wfile.write(BODY)

    def log_message(self, *args):
        pass


def start_fake_joule():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, "http://127.0.0.1:%d" % httpd.server_address[1]


def env_for(home_dir, extra=None):
    env = dict(os.environ)
    env["HOME"] = home_dir
    env["TERM"] = "xterm-256color"
    env["BROWSER"] = "/bin/true"
    env["JOULE_CODE_BASE_URL"] = "http://127.0.0.1:9"
    env["JOULE_CODE_MODEL"] = "stub"
    env["JOULE_CODE_API_KEY"] = "stub-key"
    env.pop("JOULE_CODE_SERVER", None)
    env.pop("JOULE_CODE_ALLOW_INSECURE_HTTP", None)
    if extra:
        env.update(extra)
    return env


def session_for(home_dir, repo_dir, extra=None, argv=None):
    cmd = [harness.JOULE_BIN] + (argv or [])
    return harness.PtySession(cmd, env_for(home_dir, extra), repo_dir, rows=40, cols=200)


def config_of(home_dir):
    path = os.path.join(home_dir, ".config", "joule-code", "config.json")
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


def main():
    httpd, fake = start_fake_joule()
    work_dir = tempfile.mkdtemp(prefix="login-server-")
    home_dir = os.path.join(work_dir, "home")
    repo_dir = os.path.join(work_dir, "repo")
    os.makedirs(home_dir, exist_ok=True)
    harness.seed_workspace(repo_dir)
    config_path = os.path.join(home_dir, ".config", "joule-code", "config.json")
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    with open(config_path, "w") as f:
        json.dump({"baseUrl": "http://127.0.0.1:9", "model": "stub", "apiKey": "stub-key", "server": "", "updateCheck": ""}, f)

    try:
        s = session_for(home_dir, repo_dir)
        try:
            s.wait_for(harness.BANNER, timeout=15.0)
            box = harness.strip_sgr(harness.text(s.raw))
            ok("https://joule.sh" not in box, "the welcome box stays quiet about the server while the default is in use")
            mark = len(s.raw)
            s.write("/login\r")
            s.wait_for("sign in to https://joule.sh", timeout=10.0, from_index=mark)
            ok(True, "/login names the server it is about to use")
            s.wait_for("code> ", timeout=10.0, from_index=mark)
            ok(True, "the default path goes straight to the code prompt, with nothing to answer first")
            after = harness.text(s.raw[mark:])
            ok("/login <url>" in harness.strip_sgr(after), "it says how to reach a different server")
            s.write("\x03")
            s.wait_for("sign-in stopped", timeout=10.0)
            ok(config_of(home_dir).get("server", "") == "", "an abandoned sign-in writes nothing to the config file")

            mark = len(s.raw)
            s.write("/login http://joule.example.invalid\r")
            s.wait_for("refusing to sign in", timeout=10.0, from_index=mark)
            refusal = harness.strip_sgr(harness.text(s.raw[mark:]))
            ok("over plain http" in refusal, "a public plain-http address is refused with the existing message")
            ok("JOULE_CODE_ALLOW_INSECURE_HTTP=1" in refusal, "the refusal still names the escape hatch")
            ok(config_of(home_dir).get("server", "") == "", "a refused address is not remembered")

            mark = len(s.raw)
            s.write("/login " + fake + "\r")
            s.wait_for("sign in to " + fake, timeout=10.0, from_index=mark)
            ok(True, "a loopback http address is accepted with no extra confirmation")
            s.wait_for("code> ", timeout=10.0, from_index=mark)
            s.write("ABC234\r")
            s.wait_for("signed in to " + fake + " as dev@example.com", timeout=15.0, from_index=mark)
            ok(True, "the sign-in completes against the chosen server")
            s.wait_for("joule now uses " + fake, timeout=10.0, from_index=mark)
            ok(True, "it says the chosen server is now the one joule uses")
            ok(config_of(home_dir).get("server", "") == fake, "the chosen server is written to the config file")
            cfg = config_of(home_dir)
            ok(cfg.get("apiKey") == "stub-key" and cfg.get("model") == "stub" and cfg.get("baseUrl") == "http://127.0.0.1:9",
               "the rest of the config file survives the write")
            creds = os.path.join(home_dir, ".config", "joule-code", "credentials.jsonl")
            ok(oct(stat.S_IMODE(os.stat(creds).st_mode)) == "0o600", "the credential file is still mode 600")
        finally:
            s.close()

        s = session_for(home_dir, repo_dir)
        try:
            s.wait_for(harness.BANNER, timeout=15.0)
            ok(fake in harness.strip_sgr(harness.text(s.raw)), "the welcome box of the next run names the chosen server")
            mark = len(s.raw)
            s.write("/login\r")
            s.wait_for("sign in to " + fake, timeout=10.0, from_index=mark)
            ok(True, "a later /login agrees with the welcome box")
            seen = harness.strip_sgr(harness.text(s.raw[mark:]))
            ok("already signed in to " + fake + " as dev@example.com" in seen, "it recognizes the credential it stored")
            s.write("\x03")
            s.wait_for("sign-in stopped", timeout=10.0)

            mark = len(s.raw)
            s.write("/logout\r")
            s.wait_for("signed out of " + fake, timeout=10.0, from_index=mark)
            ok(True, "/logout forgets the credential for the server in use")
            mark = len(s.raw)
            s.write("/logout\r")
            s.wait_for("not signed in to " + fake, timeout=10.0, from_index=mark)
            ok(True, "a second /logout says plainly there was nothing to forget")
        finally:
            s.close()

        s = session_for(home_dir, repo_dir, extra={"JOULE_CODE_SERVER": "https://pinned.example"})
        try:
            s.wait_for(harness.BANNER, timeout=15.0)
            mark = len(s.raw)
            s.write("/login\r")
            s.wait_for("sign in to https://pinned.example", timeout=10.0, from_index=mark)
            pinned = harness.strip_sgr(harness.text(s.raw[mark:]))
            ok("JOULE_CODE_SERVER" in pinned, "a pinned server says where its address comes from")
            ok("/login <url>" not in pinned, "a pinned server offers no choice it would then override")
            s.write("\x03")
            s.wait_for("sign-in stopped", timeout=10.0)

            mark = len(s.raw)
            s.write("/login " + fake + "\r")
            s.wait_for("code> ", timeout=10.0, from_index=mark)
            s.write("ABC234\r")
            s.wait_for("signed in to " + fake, timeout=15.0, from_index=mark)
            note = harness.strip_sgr(harness.text(s.raw[mark:]))
            ok("credential is kept for " + fake in note, "signing in under a pinned server still stores the credential")
            ok("joule now uses" not in note, "it does not claim a switch the env var would override")
            ok(config_of(home_dir).get("server", "") == fake, "the config file is left as it was, not rewritten by a pinned run")

            mark = len(s.raw)
            s.write("/logout " + fake + "\r")
            s.wait_for("signed out of " + fake, timeout=10.0, from_index=mark)
            ok(True, "/logout takes a server, so a credential is reachable even when another server is in use")
        finally:
            s.close()
    finally:
        httpd.shutdown()
        shutil.rmtree(work_dir, ignore_errors=True)

    if failures:
        print("\n%d failure(s):" % len(failures), file=sys.stderr)
        for f in failures:
            print(" - " + f, file=sys.stderr)
        sys.exit(1)
    print("\nlogin server choice verification passed")


if __name__ == "__main__":
    main()
