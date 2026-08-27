// A shared session has to reach the relay while the turn is running, not in
// one batch after turn.end (#311). So this harness takes timestamps rather
// than counting arrivals: a check that only asserts frames arrive would have
// passed the whole time the uplink was silent for the length of every turn.
//
// The model streams on a delay, so one turn takes tens of seconds, and the
// daemon's own attach socket is read alongside the browser's relay socket as
// the control - the attach side was always live, which is what proved the
// frames existed at the right times and only the uplink was late.
//
// The half that matters most is the approval: it is answered from the browser
// and nowhere else, and the tool's effect is read back off the workspace. An
// approval that only arrives after the turn it blocked cannot be answered at
// all, so a run that landed is the proof that the request was still open.
import { connect } from "./miniws.mjs";
import { signedInHome, withoutInheritedConfig } from "./lib/signed_in_home.mjs";
import { startConsoleStub } from "./lib/console_stub.mjs";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CHUNK_DELAY_MS = 1200;
const MIN_LIVE_DELTAS = 3;
const FIRST_FRAME_BUDGET_MS = 5000;
const UPLINK_LAG_BUDGET_MS = 2000;
const MIN_TURN_LENGTH_MS = 8000;

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

function tap(socket) {
  const seen = [];
  socket.onMessage((text) => {
    let frame = null;
    try { frame = JSON.parse(text); } catch { return; }
    seen.push({ at: Date.now(), frame });
  });
  return seen;
}

async function waitFor(seen, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = seen.find((e) => predicate(e.frame));
    if (found) return found;
    await sleep(20);
  }
  throw new Error("timed out waiting for " + label);
}

function firstOf(seen, type) {
  return seen.find((e) => e.frame.type === type) || null;
}

function allOf(seen, type) {
  return seen.filter((e) => e.frame.type === type);
}

async function fetchJson(url, opts) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: resp.status, ok: resp.ok, json: parsed };
}

function since(base, entry) {
  return entry === null || entry === undefined ? "never" : ((entry.at - base) / 1000).toFixed(1) + "s";
}

async function main() {
  const workspace = scratchDir("joule-share-liveness-");
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nNo health route yet.\n");

  const stubPort = await freePort();
  const daemonPort = await freePort();
  const relayHttpPort = await freePort();
  const relayWsPort = await freePort();
  const relayWsBrowserPort = await freePort();

  const stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], {
    cwd: workspace,
    env: {
      ...process.env,
      E2E_STUB_PORT: String(stubPort),
      E2E_STUB_SCRIPT: "slow",
      E2E_STUB_CHUNK_DELAY_MS: String(CHUNK_DELAY_MS),
    },
    stdio: "inherit",
  });

  const secret = "e2e-share-liveness-secret";
  const consoleStub = await startConsoleStub(secret, { id: "acct-share-liveness", email: "l@example.com" });
  const consolePort = consoleStub.address().port;

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

  const homeDir = signedInHome({
    prefix: "joule-share-liveness-home",
    server: "http://joule-share-liveness.invalid",
    secret,
    relayUrl: `http://127.0.0.1:${relayHttpPort}`,
    relayWsUrl: `ws://127.0.0.1:${relayWsPort}`,
  });

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
    ok(await waitForPort(relayWsBrowserPort, 5000), "relay browser ws came up");
    ok(await waitForPort(daemonPort, 5000), "daemon came up");

    const attachId = crypto.randomBytes(8).toString("hex");
    const attach = await connect("127.0.0.1", daemonPort, `/attach/${attachId}/ws`, {});
    const attachSeen = tap(attach);
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await waitFor(attachSeen, (f) => f.type === "session.hello", 5000, "session.hello on the attach socket");

    attach.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
    const started = await waitFor(attachSeen, (f) => f.type === "share.started" || f.type === "share.failed", 10000, "share.started");
    ok(started.frame.type === "share.started", "share.request produced share.started" + (started.frame.error ? " (" + started.frame.error + ")" : ""));
    if (started.frame.type !== "share.started") { throw new Error("cannot continue: " + started.frame.error); }

    const userId = crypto.randomUUID();
    const paired = await fetchJson(`http://127.0.0.1:${relayHttpPort}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId },
      body: JSON.stringify({ code: started.frame.code }),
    });
    ok(paired.status === 200 && paired.json && paired.json.sessionId, "a browser paired against the printed code");
    const sessionId = paired.json.sessionId;

    const browser = await connect("127.0.0.1", relayWsBrowserPort, `/w/${sessionId}/ws?x-user=${encodeURIComponent(userId)}`, {});
    const browserSeen = tap(browser);
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await sleep(500);

    const inputAt = Date.now();
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "add a health note to the README" }));

    const browserStart = await waitFor(browserSeen, (f) => f.type === "turn.start", FIRST_FRAME_BUDGET_MS, "turn.start at the browser while the turn is only beginning");
    ok(browserStart.at - inputAt < FIRST_FRAME_BUDGET_MS, "turn.start reached the browser " + since(inputAt, browserStart) + " after the input, not at the end of the turn");

    await waitFor(browserSeen, (f) => f.type === "text.delta", FIRST_FRAME_BUDGET_MS + CHUNK_DELAY_MS * 2, "the browser's first text.delta");
    await waitFor(attachSeen, (f) => f.type === "text.delta", 2000, "the attach client's first text.delta");

    const browserApproval = await waitFor(browserSeen, (f) => f.type === "approval.request", 60000, "approval.request at the browser");
    const approvalAt = browserApproval.at;

    ok(firstOf(browserSeen, "turn.end") === null, "the turn was still running when the approval reached the browser, so it is a live approval rather than a record of one");

    const deltasBeforeApproval = allOf(browserSeen, "text.delta").filter((e) => e.at <= approvalAt);
    ok(deltasBeforeApproval.length >= MIN_LIVE_DELTAS,
      "the browser had already been sent " + deltasBeforeApproval.length + " text.delta frames before the approval, mid-turn (wanted at least " + MIN_LIVE_DELTAS + ")");

    const spread = deltasBeforeApproval.length > 1
      ? deltasBeforeApproval[deltasBeforeApproval.length - 1].at - deltasBeforeApproval[0].at
      : 0;
    ok(spread > CHUNK_DELAY_MS,
      "those deltas arrived spread over " + (spread / 1000).toFixed(1) + "s as the model produced them, not in one batch (a batch would land inside a single tick)");

    const browserFirstDelta = firstOf(browserSeen, "text.delta");
    const attachFirstDelta = firstOf(attachSeen, "text.delta");
    ok(browserFirstDelta.at - attachFirstDelta.at < UPLINK_LAG_BUDGET_MS,
      "the relay uplink kept pace with the daemon's own attach socket: first delta at " + since(inputAt, attachFirstDelta) + " on the attach side, " + since(inputAt, browserFirstDelta) + " at the browser");

    const callId = browserApproval.frame.callId;
    ok(browserApproval.frame.tool === "run", "the pending approval is for the run tool, got " + browserApproval.frame.tool);
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId, decision: "allow" }));

    const runCall = await waitFor(browserSeen, (f) => f.type === "tool.call" && f.tool === "run", 20000, "the run tool.call the browser's own answer released");
    ok(runCall.at > approvalAt, "the run only happened after the browser answered, so the browser's answer is what released it");

    const browserEnd = await waitFor(browserSeen, (f) => f.type === "turn.end", 60000, "turn.end at the browser");
    ok(browserEnd.frame.reason === "done", "the turn closed with done, got " + browserEnd.frame.reason);

    const readmeAfter = fs.readFileSync(path.join(workspace, "README.md"), "utf8");
    ok(readmeAfter.includes("Added a health check note."),
      "the approved run landed on the real workspace file, so an approval answered from a browser mid-turn actually does something");

    const deltasAfterApproval = allOf(browserSeen, "text.delta").filter((e) => e.at > approvalAt && e.at < browserEnd.at);
    ok(deltasAfterApproval.length >= MIN_LIVE_DELTAS,
      "the browser kept being sent deltas after the approval and before turn.end (" + deltasAfterApproval.length + "), so the uplink stays live for the rest of the turn");

    ok(browserEnd.at - browserFirstDelta.at > MIN_TURN_LENGTH_MS,
      "the turn really did run for " + ((browserEnd.at - browserFirstDelta.at) / 1000).toFixed(1) + "s after its first delta, so the timings above are about a live turn and not a short one");

    console.log("the browser's view of the turn: start " + since(inputAt, browserStart)
      + ", first delta " + since(inputAt, browserFirstDelta)
      + ", approval " + since(inputAt, browserApproval)
      + ", run " + since(inputAt, runCall)
      + ", end " + since(inputAt, browserEnd));

    console.log("PASS: a shared turn reaches the relay as it happens - turn.start, deltas and the approval all land while the turn is still open, and the approval is answered from the browser and its tool runs");
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
