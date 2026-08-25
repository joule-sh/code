import { connect } from "./miniws.mjs";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
  const workspace = scratchDir("joule-share-bridge-");
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nNo health route yet.\n");

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
    },
    stdio: ["ignore", fs.openSync(relayLog, "w"), fs.openSync(relayLog, "a")],
  });

  const daemonLog = path.join(workspace, "daemon.log");
  const daemon = spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
    cwd: workspace,
    env: {
      ...process.env,
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
    ok(await waitForPort(relayWsPort, 5000), "relay terminal ws came up");
    ok(await waitForPort(relayWsBrowserPort, 5000), "relay browser ws came up");
    ok(await waitForPort(daemonPort, 5000), "daemon came up");

    // The attach client: a real attach connection to the daemon, exactly
    // the shape joule attach itself uses.
    const attachId = crypto.randomBytes(8).toString("hex");
    const attach = await connect("127.0.0.1", daemonPort, `/attach/${attachId}/ws`, {});
    const attachFrames = [];
    attach.onMessage((text) => { try { attachFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await sleep(200);
    ok(attachFrames.some((f) => f.type === "session.hello"), "the attach client saw session.hello");

    // Ask the daemon to start sharing, over the same attach connection any
    // real joule attach client would use for /share.
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
    const started = await collectUntil(attachFrames, (f) => f.type === "share.started" || f.type === "share.failed", 5000, "share.started or share.failed after share.request");
    ok(started.type === "share.started", "share.request produced share.started, not share.failed" + (started.error ? " (" + started.error + ")" : ""));
    if (started.type !== "share.started") { throw new Error("cannot continue without a pairing code: " + started.error); }
    ok(typeof started.code === "string" && started.code.length === 6, "share.started carries a 6-character pairing code, got " + JSON.stringify(started.code));

    // Pair a browser identity against that code, exactly the HTTP flow
    // spec 002 describes.
    const userId = crypto.randomUUID();
    const paired = await fetchJson(`http://127.0.0.1:${relayHttpPort}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId },
      body: JSON.stringify({ code: started.code }),
    });
    ok(paired.status === 200 && paired.json && paired.json.sessionId, "POST /pair against the printed code succeeds");
    const sessionId = paired.json.sessionId;

    const browser = await connect("127.0.0.1", relayWsBrowserPort, `/w/${sessionId}/ws?x-user=${encodeURIComponent(userId)}`, {});
    const browserFrames = [];
    browser.onMessage((text) => { try { browserFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await sleep(200);

    // A browser and an attach client on the same session at once: submit
    // from the attach side, both should see the identical turn unfold.
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "add a health note to the README" }));

    const attachApproval = await collectUntil(attachFrames, (f) => f.type === "approval.request", 10000, "attach client to see approval.request");
    const browserApproval = await collectUntil(browserFrames, (f) => f.type === "approval.request", 10000, "browser to see the same approval.request");
    ok(attachApproval.callId === browserApproval.callId, "both clients see the same approval callId, got " + attachApproval.callId + " vs " + browserApproval.callId);
    ok(attachApproval.tool === "run" && browserApproval.tool === "run", "both clients agree the pending approval is for the run tool");

    const readByAttach = attachFrames.find((f) => f.type === "tool.call" && f.tool === "read");
    const readByBrowser = browserFrames.find((f) => f.type === "tool.call" && f.tool === "read");
    ok(!!readByAttach && !!readByBrowser && readByAttach.callId === readByBrowser.callId, "both clients saw the same earlier read tool.call before the approval, consistent state (not two independent turns)");

    // #136's approval race: both sides answer close together, exactly one
    // decision wins, and the loser is told plainly it lost.
    const callId = attachApproval.callId;
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId, decision: "deny" }));
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId, decision: "allow" }));

    const turnEndAttach = await collectUntil(attachFrames, (f) => f.type === "turn.end", 15000, "attach client to see turn.end after the approval race resolves");
    const turnEndBrowser = await collectUntil(browserFrames, (f) => f.type === "turn.end", 15000, "browser to see the same turn.end");
    ok(turnEndAttach.reason === turnEndBrowser.reason, "both clients agree on the turn's outcome, got " + turnEndAttach.reason + " vs " + turnEndBrowser.reason);

    const runRan = attachFrames.some((f) => f.type === "tool.call" && f.tool === "run");
    const results = [...attachFrames, ...browserFrames].filter((f) => f.type === "approval.reply.result" && f.callId === callId);
    const refused = results.filter((r) => r.applied === false);
    const applied = results.filter((r) => r.applied === true);
    ok(refused.length >= 1, "the losing side of the approval race was told its reply was not applied (approval.reply.result), got " + refused.length + " such frame(s)");
    ok(applied.length >= 1, "the winning answer was broadcast as applied too, so every attached client can clear the prompt, got " + applied.length + " such frame(s)");
    if (results.length > 0) {
      const winningDecision = runRan ? "allow" : "deny";
      ok(results.every((r) => r.decision === winningDecision), "every approval.reply.result names the decision that actually won (" + winningDecision + ")");
    }

    const readmeAfter = fs.readFileSync(path.join(workspace, "README.md"), "utf8");
    if (runRan) {
      ok(readmeAfter.includes("Added a health check note."), "the run tool's effect actually landed on the real workspace filesystem (allow won the race)");
    } else {
      ok(!readmeAfter.includes("Added a health check note."), "the file is untouched (deny won the race)");
    }

    console.log("PASS: a browser paired through /share and a joule attach client stay consistent on one daemon session, and the #136 approval race resolves once with the loser told plainly");
  } finally {
    daemon.kill();
    relay.kill();
    stub.kill();
    if (!process.env.DEBUG_KEEP) fs.rmSync(workspace, { recursive: true, force: true }); else console.error("workspace kept at " + workspace);
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
