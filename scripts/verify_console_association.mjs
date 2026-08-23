import { connect } from "./miniws.mjs";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const attempt = () =>
    new Promise((resolve) => {
      const sock = net.createConnection(port, "127.0.0.1");
      sock.once("connect", () => { sock.end(); resolve(true); });
      sock.once("error", () => resolve(false));
    });
  return (async () => {
    while (Date.now() < deadline) {
      if (await attempt()) return true;
      await sleep(50);
    }
    return false;
  })();
}

let failures = 0;
function ok(cond, label) {
  if (!cond) {
    console.error("FAIL: " + label);
    failures += 1;
  } else {
    console.log("ok: " + label);
  }
}

async function collectUntil(frames, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = frames.find(predicate);
    if (found) return found;
    await sleep(25);
  }
  throw new Error("timed out waiting for " + label);
}

async function fetchJson(url, opts) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: resp.status, ok: resp.ok, json: parsed };
}

// A stand-in for the console's /terminal/verify: knows exactly one real
// credential secret, everything else is refused. This is the seam
// account_verify.ts's relay side calls out to - a real console is not
// needed to prove the relay does this correctly.
function startConsoleStub(knownSecret, account) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/terminal/verify") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { parsed = null; }
        if (parsed && parsed.secret === knownSecret) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ account }));
          return;
        }
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "revoked" }));
      });
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "joule-console-assoc-"));
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nNo health route yet.\n");

  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "joule-console-assoc-home-"));
  const credentialSecret = "e2e-terminal-secret-abc123";
  const account = { id: "acct-e2e-1", email: "e2e@example.com" };
  const server = "http://joule-console-assoc.invalid";
  fs.mkdirSync(path.join(homeDir, ".config", "joule-code"), { recursive: true });
  const credLine = JSON.stringify({
    server, secret: credentialSecret, accountId: "", accountEmail: "",
    keyId: "key_e2e", keyPrefix: "jl_e2", scopes: "", savedAt: `${Date.now()}`,
  });
  fs.writeFileSync(path.join(homeDir, ".config", "joule-code", "credentials.jsonl"), credLine + "\n");

  const consoleStub = await startConsoleStub(credentialSecret, account);
  const consolePort = consoleStub.address().port;

  const stubPort = await freePort();
  const daemonPort = await freePort();
  const relayHttpPort = await freePort();
  const relayWsPort = await freePort();
  const relayWsBrowserPort = await freePort();

  const stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], {
    cwd: workspace,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "inherit",
  });

  const relayLog = path.join(workspace, "relay.log");
  const relay = spawn(path.join(REPO_ROOT, "bin", "relay"), [], {
    env: {
      ...process.env,
      JOULE_RELAY_HTTP_PORT: String(relayHttpPort),
      JOULE_RELAY_WS_PORT: String(relayWsPort),
      JOULE_RELAY_WS_BROWSER_PORT: String(relayWsBrowserPort),
      JOULE_RELAY_CONSOLE_URL: `http://127.0.0.1:${consolePort}`,
    },
    stdio: ["ignore", fs.openSync(relayLog, "w"), fs.openSync(relayLog, "a")],
  });

  const daemonLog = path.join(workspace, "daemon.log");
  const daemon = spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: homeDir,
      JOULE_CODE_SERVER: server,
      JOULE_DAEMON_PORT: String(daemonPort),
      JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
      JOULE_CODE_MODEL: "stub-model",
      JOULE_CODE_API_KEY: "test-key",
      JOULE_RELAY_HOST: "127.0.0.1",
      JOULE_RELAY_HTTP_PORT: String(relayHttpPort),
      JOULE_RELAY_WS_PORT: String(relayWsPort),
      TMPDIR: workspace,
    },
    stdio: ["ignore", fs.openSync(daemonLog, "w"), fs.openSync(daemonLog, "a")],
  });

  try {
    ok(await waitForPort(stubPort, 5000), "stub model came up");
    ok(await waitForPort(relayHttpPort, 5000), "relay http came up");
    ok(await waitForPort(daemonPort, 5000), "daemon came up");

    // Before any /share, the account has nothing running - association
    // never predates a real session existing.
    const beforeShare = await fetchJson(`http://127.0.0.1:${relayHttpPort}/sessions/mine`, {
      headers: { "x-user": account.id },
    });
    ok(beforeShare.status === 200 && beforeShare.json.sessions.length === 0, "GET /sessions/mine is empty before /share has ever run");

    const attach = await connect("127.0.0.1", daemonPort, "/attach/e2e-console-assoc/ws", {});
    const attachFrames = [];
    attach.onMessage((text) => { try { attachFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await sleep(200);

    // The daemon holds a real #97 credential (see the HOME override above)
    // and offers it on /share - this is the association this ticket adds.
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
    const started = await collectUntil(attachFrames, (f) => f.type === "share.started" || f.type === "share.failed", 5000, "share.started or share.failed after share.request");
    ok(started.type === "share.started", "share.request produced share.started" + (started.error ? " (" + started.error + ")" : ""));
    if (started.type !== "share.started") { throw new Error("cannot continue: " + started.error); }

    // Association: the relay verified the credential against the console
    // stub and now lists the session for that account, and only that one.
    const mine = await fetchJson(`http://127.0.0.1:${relayHttpPort}/sessions/mine`, {
      headers: { "x-user": account.id },
    });
    ok(mine.status === 200, "GET /sessions/mine succeeds for the owning account");
    ok(mine.json.sessions.length === 1, "exactly one session is listed, got " + JSON.stringify(mine.json));
    ok(mine.json.sessions[0].workspace === workspace, "the listed session names the real workspace");
    ok(mine.json.sessions[0].paired === false, "the listed session is not yet paired to any browser");

    const bodyText = JSON.stringify(mine.json);
    ok(bodyText.indexOf(started.code) < 0, "the listing never carries the pairing code itself");

    const someoneElse = await fetchJson(`http://127.0.0.1:${relayHttpPort}/sessions/mine`, {
      headers: { "x-user": "a-different-account" },
    });
    ok(someoneElse.status === 200 && someoneElse.json.sessions.length === 0, "a different account's listing does not see this session - association is not authorization to see everyone's sessions");

    // Association alone changes nothing about who may drive the session.
    // Knowing the accountId still buys a browser nothing without the code.
    const noCode = await fetchJson(`http://127.0.0.1:${relayHttpPort}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": account.id },
      body: JSON.stringify({ code: "ZZZZZZ" }),
    });
    ok(noCode.status === 400, "pairing as the owning account with the wrong code is still refused - listing never substitutes for the code");

    // Two-sided consent, unchanged: the same account, now with the real
    // code a human would have read off the terminal, pairs exactly as
    // spec 002 always allowed, and driving still works end to end.
    const paired = await fetchJson(`http://127.0.0.1:${relayHttpPort}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": account.id },
      body: JSON.stringify({ code: started.code }),
    });
    ok(paired.status === 200 && paired.json && paired.json.sessionId, "POST /pair with the real code succeeds for the owning account");
    const sessionId = paired.json.sessionId;

    const afterPairing = await fetchJson(`http://127.0.0.1:${relayHttpPort}/sessions/mine`, {
      headers: { "x-user": account.id },
    });
    ok(afterPairing.json.sessions[0].paired === true, "the listing reflects paired status once a browser has paired");

    const browser = await connect("127.0.0.1", relayWsBrowserPort, `/w/${sessionId}/ws?x-user=${encodeURIComponent(account.id)}`, {});
    const browserFrames = [];
    browser.onMessage((text) => { try { browserFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));

    attach.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "add a health note to the README" }));
    const approval = await collectUntil(browserFrames, (f) => f.type === "approval.request", 10000, "the paired browser to see the approval.request");
    ok(approval.tool === "run", "the pending approval is for the run tool");

    // Post-pairing authority is still capped: the paired browser answers
    // the approval and can send input/cancel, nothing wider, unchanged by
    // this session being associated with an account.
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId: approval.callId, decision: "allow" }));
    const turnEnd = await collectUntil(browserFrames, (f) => f.type === "turn.end", 15000, "turn.end after the paired browser approved");
    ok(turnEnd.reason === "done", "the turn completed after the paired browser's approval, got " + turnEnd.reason);

    const readmeAfter = fs.readFileSync(path.join(workspace, "README.md"), "utf8");
    ok(readmeAfter.includes("Added a health check note."), "the approved tool's effect landed on the real workspace filesystem, driven by the associated-and-paired browser");

    console.log("PASS: a daemon holding a #97 credential associates its session with the account on /share, the console-facing listing shows only the owning account's sessions with no code or secret, and driving the session still requires the human-shared pairing code exactly as before");
  } finally {
    daemon.kill();
    relay.kill();
    stub.kill();
    consoleStub.close();
    if (!process.env.DEBUG_KEEP) {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    } else {
      console.error("workspace kept at " + workspace + ", HOME kept at " + homeDir);
    }
  }

  if (failures > 0) {
    console.error(failures + " check(s) failed");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exitCode = 1;
});
