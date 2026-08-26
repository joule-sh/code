# Real-pty verification for choosing a Joule server from /login (#150), for the
# code prompt being the framed input rather than a second prompt under it
# (#193), and for the prompt going back to ordinary after a cancelled sign-in
# (#194). Reuses terminal_structural_harness.py's PtySession, and stands up a
# fake Joule console that answers the sign-in exchange, so the whole path can
# be driven end to end: the default sign-in naming its server and going
# straight to the code prompt, an address typed at that prompt switching the
# sign-in in place, a public plain-http address still refused, a loopback one
# accepted, the chosen server persisting to the config file and turning up in
# the next run's welcome box, and a server pinned by JOULE_CODE_SERVER
# offering no choice it would then override.

import os
import sys
import json
import stat
import shutil
import threading
import scratch
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


def rows_of(session):
    """The stripped rows of the latest redraw, keyed by row number."""
    full = harness.text(bytes(session.raw))
    out = {}
    for (row, cell) in harness.parse_redraw_rows(harness.last_redraw_block(full)):
        out[row] = harness.strip_sgr(cell).rstrip()
    return out


def has_row(session, wanted):
    return any(row == wanted for row in rows_of(session).values())


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
    work_dir = scratch.scratch_dir("login-server-")
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
            s.settle(0.3, 2.0)
            after = harness.strip_sgr(harness.text(s.raw[mark:]))
            ok("another server? type its address instead." in after, "the prompt taking the code also offers the other server, so choosing one costs no restart")
            # #193: the code prompt is the framed input itself. A row starting
            # with the marker is a second, unframed prompt drawn under the box
            # - the exact defect reported - so there must be none.
            ok(harness.input_row(harness.text(bytes(s.raw)), 40) == "code>", "the code prompt is the marker inside the input box")
            loose = [r for r in rows_of(s).values() if r.startswith("code>")]
            ok(loose == [], "no second code prompt is drawn outside the box, got %r" % (loose,))

            # #193: an address typed at the code prompt moves the sign-in
            # there, without cancelling the command and typing it again.
            mark = len(s.raw)
            s.write(fake + "\r")
            s.wait_for("sign in to " + fake, timeout=10.0, from_index=mark)
            ok(True, "an address typed at the code prompt switches the sign-in to that server in place")
            s.wait_for("code> ", timeout=10.0, from_index=mark)
            ok(config_of(home_dir).get("server", "") == "", "switching at the prompt does not write the config file until the sign-in works")
            mark = len(s.raw)
            s.write("ABC234\r")
            s.wait_for("signed in to " + fake + " as dev@example.com", timeout=15.0, from_index=mark)
            ok(True, "the sign-in completes against the server chosen at the prompt")
            ok(config_of(home_dir).get("server", "") == fake, "a server chosen at the prompt persists, exactly as one named on the command line does")
            s.settle(0.3, 2.0)
            ok(harness.input_row(harness.text(bytes(s.raw)), 40) == ">", "the prompt goes back to the ordinary marker once the sign-in is done")

            mark = len(s.raw)
            s.write("/logout " + fake + "\r")
            s.wait_for("signed out of " + fake, timeout=10.0, from_index=mark)
            with open(config_path, "w") as f:
                json.dump({"baseUrl": "http://127.0.0.1:9", "model": "stub", "apiKey": "stub-key", "server": "", "updateCheck": ""}, f)

            mark = len(s.raw)
            s.write("/login\r")
            s.wait_for("code> ", timeout=10.0, from_index=mark)
            s.write("\x03")
            s.wait_for("sign-in stopped", timeout=10.0)
            s.settle(0.3, 2.0)
            ok(config_of(home_dir).get("server", "") == "", "an abandoned sign-in writes nothing to the config file")

            # #194: after a cancelled sign-in the prompt has to be the one a
            # fresh start gives. Ordinary text is a request, and a command runs
            # only when it is typed. Both states worked in isolation before;
            # only this transition was broken.
            ok(harness.input_row(harness.text(bytes(s.raw)), 40) == ">", "a cancelled sign-in leaves the ordinary prompt marker behind")
            mark = len(s.raw)
            s.write("ls\r")
            s.settle(0.6, 4.0)
            ok(has_row(s, "> ls"), "text typed after a cancelled sign-in is echoed as a request")
            ran = harness.strip_sgr(harness.text(s.raw[mark:]))
            for output in ("show this help", "asking the daemon", "attached - code", "unknown command", "clear the scrollback"):
                ok(output not in ran, "a cancelled sign-in does not turn typed text into a command (%r never ran)" % output)
            # everything above is still on screen, and every redraw repaints
            # it, so clear the transcript before the checks below go looking
            # for text that has to be new.
            s.write("/clear\r")
            s.settle(0.3, 2.0)

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
            ok("another server?" not in pinned, "a pinned server offers no choice it would then override")
            s.write("\x03")
            s.wait_for("sign-in stopped", timeout=10.0)

            with open(config_path, "w") as f:
                json.dump({"baseUrl": "http://127.0.0.1:9", "model": "stub", "apiKey": "stub-key", "server": "", "updateCheck": ""}, f)

            mark = len(s.raw)
            s.write("/login " + fake + "\r")
            s.wait_for("code> ", timeout=10.0, from_index=mark)
            s.write("ABC234\r")
            s.wait_for("signed in to " + fake, timeout=15.0, from_index=mark)
            note = harness.strip_sgr(harness.text(s.raw[mark:]))
            ok(fake + " is now the server on disk" in note, "signing in under a pinned server still stores the credential")
            ok("daemon" in note, "and says why it is written even though the env var outranks it here")
            ok("joule now uses" not in note, "it does not claim a switch the env var would override")
            ok(config_of(home_dir).get("server", "") == fake, "the server signed in to is on disk, which is where the daemon reads it")

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
