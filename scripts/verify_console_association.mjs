import { connect } from "./miniws.mjs";
import { signedInHome, withoutInheritedConfig } from "./lib/signed_in_home.mjs";
import { startConsoleStub } from "./lib/console_stub.mjs";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.mjs";

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

async function main() {
  const workspace = scratchDir("joule-console-assoc-");
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nNo health route yet.\n");

  const credentialSecret = "e2e-terminal-secret-abc123";
  const account = { id: "acct-e2e-1", email: "e2e@example.com", relayUser: "assoc-owner-browser-name" };
  const server = "http://joule-console-assoc.invalid";

  const consoleStub = await startConsoleStub(credentialSecret, account);
  const consolePort = consoleStub.address().port;

  const stubPort = await freePort();
  const daemonPort = await freePort();
  const relayHttpPort = await freePort();
  const relayWsPort = await freePort();
  const relayWsBrowserPort = await freePort();

  // Everything the daemon is going to know about its server, written where a
  // real /login writes it. The daemon is spawned with only JOULE_DAEMON_PORT
  // (src/daemon/lifecycle.ts), so anything that lives only in an environment
  // is not there when it dials the relay - joule-sh/code#279.
  const watchPage = `${server}/terminal/sessions`;
  const homeDir = signedInHome({
    prefix: "joule-console-assoc-home",
    server,
    secret: credentialSecret,
    relayUrl: `http://127.0.0.1:${relayHttpPort}`,
    relayWsUrl: `ws://127.0.0.1:${relayWsPort}`,
    webUrl: watchPage,
  });

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
      TMPDIR: workspace,
    },
    stdio: ["ignore", fs.openSync(relayLog, "w"), fs.openSync(relayLog, "a")],
  });

  // Only what posixDaemonSpawnCommand actually hands a daemon, plus the
  // provider settings and HOME any spawning shell would have had. No
  // JOULE_CODE_SERVER and no JOULE_RELAY_*: naming those here is what let an
  // anonymous share pass this harness while failing against a real console.
  const daemonLog = path.join(workspace, "daemon.log");
  const daemon = spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
    cwd: workspace,
    env: withoutInheritedConfig({
      ...process.env,
      HOME: homeDir,
      JOULE_DAEMON_PORT: String(daemonPort),
      JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
      JOULE_CODE_MODEL: "stub-model",
      JOULE_CODE_API_KEY: "test-key",
      TMPDIR: workspace,
    }),
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

    // The url is composed inside the frame, so a client that printed something
    // else would not save anybody: this is the address a browser is sent to.
    ok(started.url === `${watchPage}?code=${started.code}`,
      "share.started names the console page that watches a terminal, carrying the code, got " + started.url);
    ok(started.url.indexOf("joule.sh") < 0,
      "no built-in joule.sh address survives into a self-hosted share, got " + started.url);

    // The create command the relay actually recorded, which is the one thing
    // that decides whether this session belongs to anybody. Asserting on
    // /sessions/mine alone let an empty accountId pass as a listing that was
    // simply empty for other reasons - joule-sh/code#279 follow-up.
    const commandsLog = path.join(workspace, `joule-relay-runtime-${relayHttpPort}`, "commands.log");
    const creates = fs.readFileSync(commandsLog, "utf8")
      .split("\n")
      .filter((line) => line.indexOf('"kind":"create"') >= 0);
    ok(creates.length === 1, "the relay recorded exactly one create, got " + creates.length);
    const created = JSON.parse(creates[0].slice(creates[0].indexOf("{")));
    ok(created.accountId === account.id,
      "the create the relay recorded carries the account, got " + JSON.stringify(created.accountId));
    ok(created.accountEmail === account.email,
      "and the account's email, got " + JSON.stringify(created.accountEmail));

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

    // The owner exemption of #296 is live on this relay - the console stub
    // names a relayUser - and it changes nothing here: every browser below
    // dials under the account id or a guest uuid, neither of which is that
    // name, so all of them still meet spec 002's code exactly as they did.
    const notTheOwner = await fetchJson(`http://127.0.0.1:${relayHttpPort}/sessions/mine`, {
      headers: { "x-user": "assoc-owner-browser-name" },
    });
    ok(notTheOwner.status === 200 && notTheOwner.json.sessions.length === 0,
      "the owner browser name lists nothing: it admits a session, it is not an account");

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

    // The defect this whole ticket came back for: a relay pointed at a
    // DIFFERENT console than the terminal signed in to. The credential is
    // real, the client sends it, and the relay's console says "not mine" -
    // so the session is created owned by nobody and the console list stays
    // empty. That must be a refusal that names the console, not a success.
    const strangerStub = await startConsoleStub("a-secret-this-console-issued", { id: "acct-elsewhere", email: "e@example.com" });
    const strangerPort = strangerStub.address().port;
    const strangerRelayHttp = await freePort();
    const strangerRelayWs = await freePort();
    const strangerRelayBrowser = await freePort();
    const strangerRelayLog = path.join(workspace, "stranger-relay.log");
    const strangerRelay = spawn(path.join(REPO_ROOT, "bin", "relay"), [], {
      env: {
        ...process.env,
        JOULE_RELAY_HTTP_PORT: String(strangerRelayHttp),
        JOULE_RELAY_WS_PORT: String(strangerRelayWs),
        JOULE_RELAY_WS_BROWSER_PORT: String(strangerRelayBrowser),
        JOULE_RELAY_CONSOLE_URL: `http://127.0.0.1:${strangerPort}`,
        TMPDIR: workspace,
      },
      stdio: ["ignore", fs.openSync(strangerRelayLog, "w"), fs.openSync(strangerRelayLog, "a")],
    });
    const strangerHome = signedInHome({
      prefix: "joule-console-assoc-stranger",
      server,
      secret: credentialSecret,
      relayUrl: `http://127.0.0.1:${strangerRelayHttp}`,
      relayWsUrl: `ws://127.0.0.1:${strangerRelayWs}`,
      webUrl: watchPage,
    });
    const strangerDaemonPort = await freePort();
    const strangerDaemon = spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
      cwd: workspace,
      env: withoutInheritedConfig({
        ...process.env,
        HOME: strangerHome,
        JOULE_DAEMON_PORT: String(strangerDaemonPort),
        JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
        JOULE_CODE_MODEL: "stub-model",
        JOULE_CODE_API_KEY: "test-key",
        TMPDIR: workspace,
      }),
      stdio: ["ignore", fs.openSync(path.join(workspace, "stranger-daemon.log"), "w"), fs.openSync(path.join(workspace, "stranger-daemon.log"), "a")],
    });
    try {
      ok(await waitForPort(strangerRelayHttp, 5000), "a relay serving a different console came up");
      ok(await waitForPort(strangerDaemonPort, 5000), "a daemon pointed at that relay came up");
      const sConn = await connect("127.0.0.1", strangerDaemonPort, "/attach/e2e-stranger/ws", {});
      const sFrames = [];
      sConn.onMessage((text) => { try { sFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
      sConn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
      await sleep(200);
      sConn.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
      const answered = await collectUntil(sFrames, (f) => f.type === "share.started" || f.type === "share.failed", 8000, "an answer to share.request against a relay serving another console");
      ok(answered.type === "share.failed",
        "a relay whose console does not know the credential is a refusal, not an anonymous share");
      const why = answered.error ?? "";
      ok(why.indexOf(`http://127.0.0.1:${strangerPort}`) >= 0,
        "the refusal names the console the relay actually asked, got " + JSON.stringify(why));
      ok(why.split("\n").every((line) => line.length <= 80),
        "every line of it fits 80 columns");
      const strangerMine = await fetchJson(`http://127.0.0.1:${strangerRelayHttp}/sessions/mine`, {
        headers: { "x-user": account.id },
      });
      ok(strangerMine.json.sessions.length === 0, "and nothing of this account's is listed on that relay");
    } finally {
      strangerDaemon.kill();
      strangerRelay.kill();
      strangerStub.close();
      if (!process.env.DEBUG_KEEP) { fs.rmSync(strangerHome, { recursive: true, force: true }); }
    }

    // A daemon that never found a credential must say so, not share into the
    // relay anonymously: an anonymous session is one no console can ever list,
    // and the old silent success is what cost a day of hand debugging.
    const blindHome = scratchDir("joule-console-assoc-blind-");
    fs.mkdirSync(path.join(blindHome, ".config", "joule-code"), { recursive: true });
    fs.writeFileSync(
      path.join(blindHome, ".config", "joule-code", "config.json"),
      JSON.stringify({ baseUrl: "", model: "", apiKey: "", server, updateCheck: "", mouse: "" }),
    );
    const blindPort = await freePort();
    const blindLog = path.join(workspace, "blind-daemon.log");
    const blind = spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
      cwd: workspace,
      env: withoutInheritedConfig({
        ...process.env,
        HOME: blindHome,
        JOULE_DAEMON_PORT: String(blindPort),
        JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
        JOULE_CODE_MODEL: "stub-model",
        JOULE_CODE_API_KEY: "test-key",
        TMPDIR: workspace,
      }),
      stdio: ["ignore", fs.openSync(blindLog, "w"), fs.openSync(blindLog, "a")],
    });
    try {
      ok(await waitForPort(blindPort, 5000), "a daemon with no credential still comes up");
      const blindAttach = await connect("127.0.0.1", blindPort, "/attach/e2e-blind/ws", {});
      const blindFrames = [];
      blindAttach.onMessage((text) => { try { blindFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
      blindAttach.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
      await sleep(200);
      blindAttach.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
      const refused = await collectUntil(blindFrames, (f) => f.type === "share.started" || f.type === "share.failed", 5000, "an answer to share.request without a credential");
      ok(refused.type === "share.failed", "sharing without a credential fails rather than going up anonymously");
      const said = refused.error ?? "";
      ok(said.indexOf(server) >= 0, "the refusal names the server it has no credential for, got " + JSON.stringify(said));
      ok(said.indexOf("/login") >= 0, "the refusal says what to do about it, got " + JSON.stringify(said));
      ok(said.split("\n").every((line) => line.length <= 80), "every line fits 80 columns, which scrollback clips rather than wraps");
      const mineAfterBlind = await fetchJson(`http://127.0.0.1:${relayHttpPort}/sessions/mine`, {
        headers: { "x-user": account.id },
      });
      ok(mineAfterBlind.json.sessions.length === 1, "the refused share put nothing in the relay");
    } finally {
      blind.kill();
      if (!process.env.DEBUG_KEEP) { fs.rmSync(blindHome, { recursive: true, force: true }); }
    }

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
