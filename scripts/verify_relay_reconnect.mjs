import { connect } from "./miniws.mjs";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// How many times each refusal shape is replayed. A teardown that reaches
// past its own connection is a race, so one clean pass proves very little -
// the point of the count is to give a timing regression somewhere to show.
const ROUNDS = Number(process.env.RELAY_RECONNECT_ROUNDS || "15");

// Comfortably past the relay's SWEEP_INTERVAL_MS, so a sweep is guaranteed
// to have run while the session was busy.
const SWEEP_WINDOW_MS = 7000;

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

async function fetchJson(url, opts) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: resp.status, json: parsed };
}

// Polls for a condition rather than sleeping a fixed amount. Every wait in
// this harness is on a real protocol event - a frame arriving, a socket
// closing - never on a settle delay, which is the whole point of #149: the
// reconnect must survive on its own, not because the test paused first.
async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = predicate();
    if (found) return found;
    await sleep(10);
  }
  return null;
}

function openBrowser(port, sessionId, userId) {
  const frames = [];
  const state = { frames, closed: false, conn: null };
  return connect("127.0.0.1", port, `/w/${sessionId}/ws?x-user=${encodeURIComponent(userId)}`, {}).then((conn) => {
    state.conn = conn;
    conn.onMessage((text) => {
      try { frames.push(JSON.parse(text)); } catch { frames.push({ raw: text }); }
    });
    conn.onClose(() => { state.closed = true; });
    return state;
  });
}

async function newSession(httpPort, wsPort, workspace) {
  const created = await fetchJson(`http://127.0.0.1:${httpPort}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace, model: "stub-model" }),
  });
  if (created.status !== 200 || !created.json) {
    throw new Error("POST /sessions failed: " + JSON.stringify(created));
  }
  const { sessionId, secret, code } = created.json;
  const terminal = await connect("127.0.0.1", wsPort, `/sessions/${sessionId}/ws`, { "x-relay-secret": secret });
  const inbound = [];
  terminal.onMessage((text) => {
    try { inbound.push(JSON.parse(text)); } catch { inbound.push({ raw: text }); }
  });
  terminal.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  return { sessionId, secret, code, terminal, inbound };
}

// The transcript a reconnecting browser has to be given: frames the terminal
// emitted before that browser ever existed. A browser that is connected but
// quietly unhooked from its session looks identical to a healthy one until
// you ask for exactly this.
function emitBacklog(session, round, count) {
  const markers = [];
  for (let i = 1; i <= count; i++) {
    const marker = `backlog-${round}-${i}`;
    markers.push(marker);
    session.terminal.send(JSON.stringify({ v: 1, seq: i, type: "turn.end", reason: marker }));
  }
  return markers;
}

async function assertLiveBrowser(browser, session, round, backlog, label) {
  const missing = [];
  for (const marker of backlog) {
    const got = await until(() => browser.frames.find((f) => f.reason === marker), 5000);
    if (!got) missing.push(marker);
  }
  ok(missing.length === 0, `${label}: the reconnected browser received its full transcript backlog${missing.length ? ", missing " + JSON.stringify(missing) : ""}`);
  ok(!browser.closed, `${label}: the reconnected browser is still open, not closed by the refused connection's teardown`);

  const liveMarker = `live-${round}`;
  session.terminal.send(JSON.stringify({ v: 1, seq: 90, type: "turn.end", reason: liveMarker }));
  const live = await until(() => browser.frames.find((f) => f.reason === liveMarker), 5000);
  ok(live !== null, `${label}: the reconnected browser still receives frames emitted after it connected`);

  // Downstream too: a browser swept out of its session can still look
  // readable while its input goes nowhere, so prove both directions.
  const inputText = `input-${round}`;
  browser.conn.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: inputText }));
  const echoed = await until(() => session.inbound.find((f) => f.text === inputText), 5000);
  ok(echoed !== null, `${label}: the reconnected browser's input still reaches the terminal`);
}

async function runNotPairedRound(ports, workspace, round, immediate) {
  const session = await newSession(ports.httpPort, ports.wsPort, workspace);
  const backlog = emitBacklog(session, round, 3);
  const user = `user-${round}`;

  // Refused: this session has not been paired to a browser yet.
  const refused = await openBrowser(ports.browserPort, session.sessionId, user);
  refused.conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  const refusal = await until(() => refused.frames.find((f) => f.type === "error" && f.code === "not_paired"), 5000);
  ok(refusal !== null, `round ${round}: an unpaired browser is refused with not_paired`);

  const paired = await fetchJson(`http://127.0.0.1:${ports.httpPort}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify({ code: session.code }),
  });
  if (paired.status !== 200) throw new Error("POST /pair failed: " + JSON.stringify(paired));

  // The reconnect, with nothing between it and the refusal above. When
  // `immediate` the refused socket is not even waited on first, so its
  // teardown is still in flight while this connection is being accepted.
  if (!immediate) {
    await until(() => refused.closed, 5000);
  }
  const browser = await openBrowser(ports.browserPort, session.sessionId, user);
  browser.conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));

  const label = `round ${round} (not_paired, ${immediate ? "no wait at all" : "after the refused socket closed"})`;
  await assertLiveBrowser(browser, session, round, backlog, label);

  browser.conn.close();
  refused.conn.close();
  session.terminal.close();
  await until(() => browser.closed, 2000);
}

async function runWrongUserRound(ports, workspace, round) {
  const session = await newSession(ports.httpPort, ports.wsPort, workspace);
  const backlog = emitBacklog(session, round, 2);
  const user = `owner-${round}`;

  const paired = await fetchJson(`http://127.0.0.1:${ports.httpPort}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify({ code: session.code }),
  });
  if (paired.status !== 200) throw new Error("POST /pair failed: " + JSON.stringify(paired));

  // Refused: paired, but to somebody else.
  const refused = await openBrowser(ports.browserPort, session.sessionId, `intruder-${round}`);
  refused.conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  const refusal = await until(() => refused.frames.find((f) => f.type === "error" && f.code === "wrong_user"), 5000);
  ok(refusal !== null, `round ${round}: a browser holding the wrong uuid is refused with wrong_user`);

  const browser = await openBrowser(ports.browserPort, session.sessionId, user);
  browser.conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));

  await assertLiveBrowser(browser, session, round, backlog, `round ${round} (wrong_user)`);

  browser.conn.close();
  refused.conn.close();
  session.terminal.close();
  await until(() => browser.closed, 2000);
}

// The relay sweeps idle sessions on a timer. A session is only idle if
// nothing has been written to it - having produced a transcript is the
// opposite of idle - so a session that has been talking must still be
// there, and still be joinable, on the far side of a sweep.
async function runSurvivesSweepRound(ports, workspace, round) {
  const session = await newSession(ports.httpPort, ports.wsPort, workspace);
  const backlog = emitBacklog(session, round, 2);
  const user = `long-${round}`;
  const paired = await fetchJson(`http://127.0.0.1:${ports.httpPort}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": user },
    body: JSON.stringify({ code: session.code }),
  });
  if (paired.status !== 200) throw new Error("POST /pair failed: " + JSON.stringify(paired));

  await sleep(SWEEP_WINDOW_MS);
  const midMarker = `mid-${round}`;
  session.terminal.send(JSON.stringify({ v: 1, seq: 50, type: "turn.end", reason: midMarker }));
  backlog.push(midMarker);
  await sleep(SWEEP_WINDOW_MS);

  const browser = await openBrowser(ports.browserPort, session.sessionId, user);
  browser.conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  const gone = await until(() => browser.frames.find((f) => f.type === "error"), 1500);
  const seconds = (SWEEP_WINDOW_MS * 2) / 1000;
  ok(gone === null, `round ${round}: a session that has been emitting frames is still there ${seconds}s later, got ${gone ? gone.code : "no refusal"}`);

  await assertLiveBrowser(browser, session, round, backlog, `round ${round} (outlived a sweep)`);

  browser.conn.close();
  session.terminal.close();
  await until(() => browser.closed, 2000);
}

async function main() {
  const workspace = scratchDir("joule-relay-reconnect-");
  const httpPort = await freePort();
  const wsPort = await freePort();
  const browserPort = await freePort();
  const ports = { httpPort, wsPort, browserPort };

  const relayLog = path.join(workspace, "relay.log");
  const relay = spawn(path.join(REPO_ROOT, "bin", "relay"), [], {
    env: {
      ...process.env,
      JOULE_RELAY_HTTP_PORT: String(httpPort),
      JOULE_RELAY_WS_PORT: String(wsPort),
      JOULE_RELAY_WS_BROWSER_PORT: String(browserPort),
      TMPDIR: workspace,
    },
    stdio: ["ignore", fs.openSync(relayLog, "w"), fs.openSync(relayLog, "a")],
  });

  try {
    ok(await waitForPort(httpPort, 8000), "relay http came up");
    ok(await waitForPort(browserPort, 8000), "relay browser ws came up");

    for (let round = 1; round <= ROUNDS; round++) {
      await runNotPairedRound(ports, workspace, round, true);
    }
    for (let round = ROUNDS + 1; round <= ROUNDS * 2; round++) {
      await runNotPairedRound(ports, workspace, round, false);
    }
    for (let round = ROUNDS * 2 + 1; round <= ROUNDS * 3; round++) {
      await runWrongUserRound(ports, workspace, round);
    }

    await runSurvivesSweepRound(ports, workspace, ROUNDS * 3 + 1);

    if (failures === 0) {
      console.log(`PASS: across ${ROUNDS * 3} refusals, a browser that reconnects to the same session with no settle delay keeps its connection, is replayed its transcript, and still carries frames in both directions, and a session that has been emitting frames outlives the idle sweep instead of being torn down under its browsers`);
    }
  } finally {
    relay.kill();
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
