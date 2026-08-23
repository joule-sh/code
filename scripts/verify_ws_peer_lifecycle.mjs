import { connect } from "./miniws.mjs";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Each round opens two relay peers (a terminal and a browser) and one daemon
// peer, and every one of them is driven far enough to have started its pusher
// before it is closed. A pusher that outlives its peer costs one thread for
// the life of the process, so the count is the whole measurement: rounds are
// cheap, and a leak of one per peer shows up as a straight line.
const ROUNDS = Number(process.env.WS_LIFECYCLE_ROUNDS || "12");

// Threads are reclaimed by the runtime a moment after the loop they run
// returns, so the count is only meaningful once it has stopped moving.
const SETTLE_TIMEOUT_MS = 8000;

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

function threadsOf(pid) {
  try {
    return fs.readdirSync(`/proc/${pid}/task`).length;
  } catch {
    return -1;
  }
}

async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = predicate();
    if (found) return found;
    await sleep(10);
  }
  return null;
}

// Waits for the thread count to stop changing, then returns it. Without this
// a count read straight after a close can catch a thread on its way out and
// credit the fix with a leak that was merely slow to be reclaimed - or, worse,
// blame it for one.
async function settledThreads(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = threadsOf(pid);
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(100);
    const now = threadsOf(pid);
    if (now !== last) {
      last = now;
      stableSince = Date.now();
      continue;
    }
    if (Date.now() - stableSince >= 600) return now;
  }
  return last;
}

async function fetchJson(url, opts) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: resp.status, json: parsed };
}

function openConn(port, path_, headers) {
  const frames = [];
  const state = { frames, closed: false, conn: null };
  return connect("127.0.0.1", port, path_, headers).then((conn) => {
    state.conn = conn;
    conn.onMessage((text) => {
      try { frames.push(JSON.parse(text)); } catch { frames.push({ raw: text }); }
    });
    conn.onClose(() => { state.closed = true; });
    return state;
  });
}

// One relay round: a terminal and a browser, both proven to have a running
// pusher by receiving a frame the other side emitted, then both closed. The
// proof matters more than the round count - counting threads after peers that
// never started a pusher would measure nothing at all.
async function relayRound(ports, workspace, round) {
  const created = await fetchJson(`http://127.0.0.1:${ports.httpPort}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace, model: "stub-model" }),
  });
  if (created.status !== 200 || !created.json) {
    throw new Error("POST /sessions failed: " + JSON.stringify(created));
  }
  const { sessionId, secret, code } = created.json;
  const user = `user-${round}`;

  const terminal = await openConn(ports.wsPort, `/sessions/${sessionId}/ws`, { "x-relay-secret": secret });
  terminal.conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));

  const marker = `backlog-${round}`;
  terminal.conn.send(JSON.stringify({ v: 1, seq: 1, type: "turn.end", reason: marker }));

  const paired = await fetchJson(`http://127.0.0.1:${ports.httpPort}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify({ code }),
  });
  if (paired.status !== 200) throw new Error("POST /pair failed: " + JSON.stringify(paired));

  const browser = await openConn(ports.browserPort, `/w/${sessionId}/ws?x-user=${encodeURIComponent(user)}`, {});
  browser.conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));

  const replayed = await until(() => browser.frames.find((f) => f.reason === marker), 5000);
  ok(replayed !== null, `round ${round}: the browser's pusher started and replayed the transcript`);

  const inputText = `input-${round}`;
  browser.conn.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: inputText }));
  const carried = await until(() => terminal.frames.find((f) => f.text === inputText), 5000);
  ok(carried !== null, `round ${round}: the terminal's pusher started and carried the browser's input`);

  // Close with frames still in flight. The pusher writes to the same socket
  // the connection thread is about to close, so a teardown that overtakes a
  // write in flight is the failure this fix has to avoid - an intermittent
  // crash here would be worse than the leak it replaces.
  for (let i = 0; i < 40; i++) {
    terminal.conn.send(JSON.stringify({ v: 1, seq: 100 + i, type: "turn.end", reason: `burst-${round}-${i}` }));
  }
  browser.conn.close();
  terminal.conn.close();
  await until(() => browser.closed && terminal.closed, 5000);
}

async function daemonRound(daemonPort, round) {
  const connId = crypto.randomBytes(8).toString("hex");
  const client = await openConn(daemonPort, `/attach/${connId}/ws`, {});
  client.conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  // The daemon starts its pusher on the resume frame itself, so there is no
  // frame to wait on here the way there is on the relay. Give the worker a
  // few poll intervals to have gone round its loop at least once.
  await sleep(200);
  client.conn.close();
  await until(() => client.closed, 5000);
}

async function measureRelay(workspace) {
  const httpPort = await freePort();
  const wsPort = await freePort();
  const browserPort = await freePort();
  const ports = { httpPort, wsPort, browserPort };

  const relayHome = fs.mkdtempSync(path.join(workspace, "relay-"));
  const relayLog = path.join(relayHome, "relay.log");
  const relay = spawn(path.join(REPO_ROOT, "bin", "relay"), [], {
    env: {
      ...process.env,
      JOULE_RELAY_HTTP_PORT: String(httpPort),
      JOULE_RELAY_WS_PORT: String(wsPort),
      JOULE_RELAY_WS_BROWSER_PORT: String(browserPort),
      TMPDIR: relayHome,
    },
    stdio: ["ignore", fs.openSync(relayLog, "w"), fs.openSync(relayLog, "a")],
  });

  try {
    ok(await waitForPort(httpPort, 8000), "relay http came up");
    ok(await waitForPort(browserPort, 8000), "relay browser ws came up");

    // A warm-up round first: the very first connection can bring up lazily
    // created machinery, and that one-off is not a leak.
    await relayRound(ports, relayHome, 0);
    const before = await settledThreads(relay.pid, SETTLE_TIMEOUT_MS);

    for (let round = 1; round <= ROUNDS; round++) {
      await relayRound(ports, relayHome, round);
    }
    const after = await settledThreads(relay.pid, SETTLE_TIMEOUT_MS);

    const peers = ROUNDS * 2;
    console.log(`relay: ${before} threads before, ${after} after ${peers} peers across ${ROUNDS} rounds (delta ${after - before})`);
    ok(after - before <= 2, `relay: ${peers} connect/disconnect cycles left at most 2 threads behind, got ${after - before}`);
    ok(relay.exitCode === null, "relay is still running after the churn, not crashed");
    return { before, after, peers };
  } finally {
    relay.kill();
  }
}

async function measureDaemon(workspace) {
  const stubPort = await freePort();
  const daemonPort = await freePort();
  const daemonHome = fs.mkdtempSync(path.join(workspace, "daemon-"));
  fs.writeFileSync(path.join(daemonHome, "README.md"), "# demo\n");

  const stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], {
    cwd: daemonHome,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "ignore",
  });
  const daemonLog = path.join(daemonHome, "daemon.log");
  const daemon = spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
    cwd: daemonHome,
    env: {
      ...process.env,
      JOULE_DAEMON_PORT: String(daemonPort),
      JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
      JOULE_CODE_MODEL: "stub-model",
      JOULE_CODE_API_KEY: "test-key",
    },
    stdio: ["ignore", fs.openSync(daemonLog, "w"), fs.openSync(daemonLog, "a")],
  });

  try {
    ok(await waitForPort(stubPort, 8000), "stub model came up");
    ok(await waitForPort(daemonPort, 8000), "daemon came up");

    await daemonRound(daemonPort, 0);
    const before = await settledThreads(daemon.pid, SETTLE_TIMEOUT_MS);

    for (let round = 1; round <= ROUNDS; round++) {
      await daemonRound(daemonPort, round);
    }
    const after = await settledThreads(daemon.pid, SETTLE_TIMEOUT_MS);

    console.log(`daemon: ${before} threads before, ${after} after ${ROUNDS} attaches (delta ${after - before})`);
    ok(after - before <= 2, `daemon: ${ROUNDS} attach/detach cycles left at most 2 threads behind, got ${after - before}`);
    ok(daemon.exitCode === null, "daemon is still running after the churn, not crashed");
    return { before, after, peers: ROUNDS };
  } finally {
    daemon.kill();
    stub.kill();
  }
}

async function main() {
  if (!fs.existsSync("/proc/self/task")) {
    console.log("SKIP: this check reads thread counts out of /proc, which this platform does not have");
    return;
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "joule-ws-lifecycle-"));
  try {
    const relay = await measureRelay(workspace);
    const daemon = await measureDaemon(workspace);
    if (failures === 0) {
      console.log(`PASS: ${relay.peers} relay peers and ${daemon.peers} daemon peers connected and went away without leaving a pusher behind (relay ${relay.before}->${relay.after}, daemon ${daemon.before}->${daemon.after})`);
    }
  } finally {
    if (!process.env.DEBUG_KEEP) {
      fs.rmSync(workspace, { recursive: true, force: true });
    } else {
      console.error("workspace kept at " + workspace);
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
