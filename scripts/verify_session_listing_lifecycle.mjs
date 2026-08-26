// A shared session must be listable for the account that owns it at every
// moment it is alive, not at one convenient moment after it is made.
//
// joule-sh/code#292: a released relay listed a session for a few seconds and
// then stopped, while the terminal stayed connected, the browser kept driving
// turns, and the pairing code kept answering "used". Every existing check
// asked once, just after /share, and passed - the same shape as #280. So this
// one keeps a poller running for the whole run and asserts on every answer it
// ever got, and it asserts again by hand at each stage of the lifecycle:
// created, paired, browser attached, a turn driven, browser gone.
//
// It is also the reason CI runs this against the release binaries and not only
// against `make build`. The fault was in which collector a targeted build
// links, so it did not exist in a host build at all - see the note in
// src/vendor/platform/platform_shim.c.

import { connect } from "./miniws.mjs";
import { signedInHome, withoutInheritedConfig } from "./lib/signed_in_home.mjs";
import { startConsoleStub } from "./lib/console_stub.mjs";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXE = process.platform === "win32" ? ".exe" : "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  return { status: resp.status, ok: resp.ok, json: parsed, text };
}

async function main() {
  const workspace = scratchDir("joule-session-listing-");
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nNo health route yet.\n");

  const credentialSecret = "session-listing-secret-abc123";
  const account = { id: "1499cf9f-83d4-4537-9fbf-19b08d8c8023", email: "" };
  const server = "http://joule-session-listing.invalid";

  const consoleStub = await startConsoleStub(credentialSecret, account);
  const consolePort = consoleStub.address().port;

  const stubPort = await freePort();
  const daemonPort = await freePort();
  const relayHttpPort = await freePort();
  const relayWsPort = await freePort();
  const relayWsBrowserPort = await freePort();

  const watchPage = `${server}/terminal/sessions`;
  const homeDir = signedInHome({
    prefix: "joule-session-listing-home",
    server,
    secret: credentialSecret,
    relayUrl: `http://127.0.0.1:${relayHttpPort}`,
    relayWsUrl: `ws://127.0.0.1:${relayWsPort}`,
    webUrl: watchPage,
  });

  const stub = spawn(path.join(REPO_ROOT, "bin", "stub_model" + EXE), [], {
    cwd: workspace,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "inherit",
  });

  const relayLog = path.join(workspace, "relay.log");
  const relay = spawn(path.join(REPO_ROOT, "bin", "relay" + EXE), [], {
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

  const daemonLog = path.join(workspace, "daemon.log");
  const daemon = spawn(path.join(REPO_ROOT, "bin", "joule-daemon" + EXE), [], {
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

  const listMine = (who) =>
    fetchJson(`http://127.0.0.1:${relayHttpPort}/sessions/mine`, {
      headers: { "x-user": who ?? account.id },
    });

  // Every answer the relay ever gave about this account, from the moment the
  // share exists. A stage check that only looks now would have passed while
  // #292 was live: the listing was right for a few seconds and then was not.
  const seen = [];
  let polling = false;
  const poller = (async () => {
    while (polling) {
      try {
        const r = await listMine();
        seen.push({ at: Date.now(), status: r.status, count: r.json?.sessions?.length ?? -1, text: r.text });
      } catch (e) {
        seen.push({ at: Date.now(), status: -1, count: -1, text: String(e) });
      }
      await sleep(120);
    }
  });

  async function stage(label, expectPaired) {
    // Several answers per stage rather than one, spread over time, because the
    // fault this guards took a few polls of allocation to show up.
    for (let i = 0; i < 8; i += 1) {
      const r = await listMine();
      const sessions = r.json?.sessions ?? [];
      if (r.status !== 200 || sessions.length !== 1) {
        ok(false, `${label}: the owning account's session is listed (poll ${i}), got ${r.status} ${r.text}`);
        return null;
      }
      if (sessions[0].workspace !== workspace) {
        ok(false, `${label}: the listed session names the real workspace (poll ${i}), got ${sessions[0].workspace}`);
        return null;
      }
      if (expectPaired !== undefined && sessions[0].paired !== expectPaired) {
        ok(false, `${label}: paired is ${expectPaired} (poll ${i}), got ${sessions[0].paired}`);
        return null;
      }
      await sleep(150);
    }
    ok(true, `${label}: listed for its own account on every poll`);
    return true;
  }

  try {
    ok(await waitForPort(stubPort, 10000), "stub model came up");
    ok(await waitForPort(relayHttpPort, 10000), "relay http came up");
    ok(await waitForPort(daemonPort, 10000), "daemon came up");

    const before = await listMine();
    ok(before.status === 200 && before.json.sessions.length === 0,
      "nothing is listed before /share has ever run");

    const attach = await connect("127.0.0.1", daemonPort, "/attach/e2e-session-listing/ws", {});
    let attachOpen = true;
    attach.onClose(() => { attachOpen = false; });
    const attachFrames = [];
    attach.onMessage((text) => { try { attachFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await sleep(200);

    attach.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
    const started = await collectUntil(attachFrames, (f) => f.type === "share.started" || f.type === "share.failed", 8000, "share.started or share.failed");
    ok(started.type === "share.started", "share.request produced share.started" + (started.error ? " (" + started.error + ")" : ""));
    if (started.type !== "share.started") { throw new Error("cannot continue: " + started.error); }

    polling = true;
    const running = poller();

    // Stage 1: created. The relay verified the credential and owns the
    // session; nothing has paired yet.
    await stage("after create", false);

    const paired = await fetchJson(`http://127.0.0.1:${relayHttpPort}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": account.id },
      body: JSON.stringify({ code: started.code }),
    });
    ok(paired.status === 200 && paired.json && paired.json.sessionId, "POST /pair with the real code succeeds");
    const sessionId = paired.json.sessionId;

    // Stage 2: paired. Pairing must not move, rewrite or lose the record.
    await stage("after pair", true);

    const browser = await connect("127.0.0.1", relayWsBrowserPort, `/w/${sessionId}/ws?x-user=${encodeURIComponent(account.id)}`, {});
    const browserFrames = [];
    browser.onMessage((text) => { try { browserFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await sleep(300);

    // Stage 3: a browser is attached and driving.
    await stage("with a browser attached", true);

    attach.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "add a health note to the README" }));
    const approval = await collectUntil(browserFrames, (f) => f.type === "approval.request", 15000, "approval.request in the paired browser");
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId: approval.callId, decision: "allow" }));
    const turnEnd = await collectUntil(browserFrames, (f) => f.type === "turn.end", 20000, "turn.end after the browser approved");
    ok(turnEnd.reason === "done", "the turn completed, got " + turnEnd.reason);
    ok(fs.readFileSync(path.join(workspace, "README.md"), "utf8").includes("Added a health check note."),
      "the approved tool's effect landed on the real workspace");

    // Stage 4: a turn has been driven end to end.
    await stage("after a turn was driven", true);

    // Stage 5: the browser goes away - a person navigating off the paired
    // page - while the terminal stays connected. That is not a detach.
    browser.close();
    await sleep(1500);
    ok(attachOpen, "the terminal is still attached after the browser went away");
    await stage("after the browser detached", true);

    // And it stays listed rather than being listed once more on the way out.
    await sleep(3000);
    await stage("still listed seconds later, terminal connected throughout", true);

    const someoneElse = await listMine("a-different-account");
    ok(someoneElse.status === 200 && someoneElse.json.sessions.length === 0,
      "a different account still sees nothing - listing is not authorization");

    polling = false;
    await running;

    const empties = seen.filter((s) => s.count !== 1);
    ok(seen.length > 20, "the background poller ran throughout, got " + seen.length + " answers");
    ok(empties.length === 0,
      "every one of the " + seen.length + " answers listed exactly one session; "
      + (empties.length === 0 ? "" : empties.length + " did not, first at +"
        + (empties[0].at - seen[0].at) + "ms: " + empties[0].text));

    if (failures === 0) {
      console.log("PASS: a live shared session is listed for the account that owns it at every stage of its life - created, paired, driven, and after the browser went away with the terminal still connected");
    }
  } finally {
    polling = false;
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
