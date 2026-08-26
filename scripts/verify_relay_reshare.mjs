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

const ACCOUNT_ID = "acct-reshare";
const ACCOUNT_EMAIL = "reshare@example.com";
const SHARE_SECRET = "e2e-reshare-secret";

// src/relay/client_logic.ts: SHARE_GIVE_UP_MS. The give-up is driven at its
// real value rather than a harness-only one, because a budget a test can
// shorten is a budget the shipped binary never has to honour.
const GIVE_UP_MS = 120000;
const GIVE_UP_WAIT_MS = GIVE_UP_MS + 30000;

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

function waitForPortGone(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const attempt = () =>
    new Promise((resolve) => {
      const sock = net.createConnection(port, "127.0.0.1");
      sock.once("connect", () => { sock.end(); resolve(true); });
      sock.once("error", () => resolve(false));
    });
  return (async () => {
    while (Date.now() < deadline) {
      if (!(await attempt())) return true;
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

async function until(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await predicate();
    if (found) return found;
    await sleep(100);
  }
  throw new Error("timed out waiting for " + label);
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
  const body = await resp.text();
  let json = null;
  try { json = JSON.parse(body); } catch { json = null; }
  return { status: resp.status, ok: resp.ok, json, body };
}

// What the relay itself recorded, not what the client believes. Every claim
// about a session being re-made is answered from this rather than from the
// absence of an error, which is the shape issue #280 documents.
function relayCommands(runtimeDir) {
  const at = path.join(runtimeDir, "commands.log");
  let raw = "";
  try { raw = fs.readFileSync(at, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    if (line === "") continue;
    const first = line.indexOf("|");
    if (first < 0) continue;
    const rest = line.slice(first + 1);
    const second = rest.indexOf("|");
    if (second < 0) continue;
    try { out.push(JSON.parse(rest.slice(second + 1))); } catch { /* partial line */ }
  }
  return out;
}

function commandsOfKind(runtimeDir, kind) {
  return relayCommands(runtimeDir).filter((c) => c && c.kind === kind);
}

function startRelay(bin, ports, runtimeDir, consolePort, logPath) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  return spawn(bin, [], {
    env: {
      ...process.env,
      JOULE_RELAY_HTTP_PORT: String(ports.http),
      JOULE_RELAY_WS_PORT: String(ports.ws),
      JOULE_RELAY_WS_BROWSER_PORT: String(ports.browser),
      JOULE_RELAY_CONSOLE_URL: `http://127.0.0.1:${consolePort}`,
      JOULE_RELAY_RUNTIME_DIR: runtimeDir,
    },
    stdio: ["ignore", fs.openSync(logPath, "w"), fs.openSync(logPath, "a")],
  });
}

async function stopRelay(proc, ports) {
  if (proc === null) return;
  proc.kill("SIGKILL");
  await waitForPortGone(ports.http, 8000);
  await waitForPortGone(ports.ws, 8000);
  await waitForPortGone(ports.browser, 8000);
}

function startDaemon(workspace, homeDir, daemonPort, stubPort, logPath) {
  return spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
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
    stdio: ["ignore", fs.openSync(logPath, "w"), fs.openSync(logPath, "a")],
  });
}

async function attachTo(daemonPort) {
  const id = crypto.randomBytes(8).toString("hex");
  const sock = await connect("127.0.0.1", daemonPort, `/attach/${id}/ws`, {});
  const frames = [];
  sock.onMessage((text) => { try { frames.push(JSON.parse(text)); } catch { /* not a frame */ } });
  sock.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  return { sock, frames };
}

async function pairBrowser(httpPort, browserWsPort, code) {
  const userId = crypto.randomUUID();
  const paired = await fetchJson(`http://127.0.0.1:${httpPort}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": userId },
    body: JSON.stringify({ code }),
  });
  if (paired.status !== 200 || !paired.json?.sessionId) {
    return { userId, sessionId: "", status: paired.status, body: paired.body, sock: null, frames: [] };
  }
  const sessionId = paired.json.sessionId;
  const sock = await connect(
    "127.0.0.1", browserWsPort, `/w/${sessionId}/ws?x-user=${encodeURIComponent(userId)}`, {},
  );
  const frames = [];
  sock.onMessage((text) => { try { frames.push(JSON.parse(text)); } catch { /* not a frame */ } });
  sock.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  return { userId, sessionId, status: paired.status, body: paired.body, sock, frames };
}

async function listMine(httpPort) {
  const listed = await fetchJson(`http://127.0.0.1:${httpPort}/sessions/mine`, {
    headers: { accept: "application/json", "x-user": ACCOUNT_ID },
  });
  if (!listed.ok || !Array.isArray(listed.json?.sessions)) return [];
  return listed.json.sessions;
}

function noticeOf(frames, code) {
  return frames.find((f) => f.type === "notice" && f.code === code);
}

async function main() {
  const workspace = scratchDir("joule-reshare-");
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nNo health route yet.\n");

  const stubPort = await freePort();
  const daemonPort = await freePort();
  const ports = { http: await freePort(), ws: await freePort(), browser: await freePort() };

  const stubArgs = {
    cwd: workspace,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "inherit",
  };
  let stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], stubArgs);

  const consoleStub = await startConsoleStub(SHARE_SECRET, { id: ACCOUNT_ID, email: ACCOUNT_EMAIL });
  const consolePort = consoleStub.address().port;

  const homeDir = signedInHome({
    prefix: "joule-reshare-home",
    server: "http://joule-reshare.invalid",
    secret: SHARE_SECRET,
    relayUrl: `http://127.0.0.1:${ports.http}`,
    relayWsUrl: `ws://127.0.0.1:${ports.ws}`,
  });

  const relayBin = path.join(REPO_ROOT, "bin", "relay");
  const runtimeA = path.join(workspace, "relay-runtime-a");
  const runtimeB = path.join(workspace, "relay-runtime-b");
  const runtimeC = path.join(workspace, "relay-runtime-c");
  const runtimeD = path.join(workspace, "relay-runtime-d");

  let relay = startRelay(relayBin, ports, runtimeA, consolePort, path.join(workspace, "relay-a.log"));
  let daemon = startDaemon(workspace, homeDir, daemonPort, stubPort, path.join(workspace, "daemon-1.log"));
  let sink = null;

  try {
    ok(await waitForPort(stubPort, 5000), "stub model came up");
    ok(await waitForPort(ports.http, 5000), "relay http came up");
    ok(await waitForPort(ports.ws, 5000), "relay terminal ws came up");
    ok(await waitForPort(ports.browser, 5000), "relay browser ws came up");
    ok(await waitForPort(daemonPort, 5000), "daemon came up");

    // ---- the share that is going to be lost -------------------------------
    const term = await attachTo(daemonPort);
    await collectUntil(term.frames, (f) => f.type === "session.hello", 5000, "session.hello");

    term.sock.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
    const first = await collectUntil(
      term.frames, (f) => f.type === "share.started" || f.type === "share.failed", 8000, "the first share",
    );
    ok(first.type === "share.started", "/share started a share" + (first.error ? " (" + first.error + ")" : ""));
    if (first.type !== "share.started") { throw new Error("nothing to lose: " + first.error); }
    const codeBefore = first.code;

    const browser1 = await pairBrowser(ports.http, ports.browser, codeBefore);
    ok(browser1.sessionId !== "", "the printed code paired a browser, status " + browser1.status);
    const sessionBefore = browser1.sessionId;
    await collectUntil(browser1.frames, (f) => f.type === "session.hello", 5000, "the browser's session.hello");

    const createdBefore = commandsOfKind(runtimeA, "create");
    ok(createdBefore.length === 1, "the relay recorded exactly one create, got " + createdBefore.length);
    ok(createdBefore[0]?.accountId === ACCOUNT_ID,
      "that create carried the verified account, got " + JSON.stringify(createdBefore[0]?.accountId));

    // A turn before the loss, so there is history to continue rather than a
    // conversation that never held anything.
    term.sock.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "add a health note to the README" }));
    const askedBefore = await collectUntil(term.frames, (f) => f.type === "approval.request", 15000, "the first approval");
    term.sock.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId: askedBefore.callId, decision: "allow" }));
    const endedBefore = await collectUntil(term.frames, (f) => f.type === "turn.end", 20000, "the first turn to end");
    ok(endedBefore.reason === "done", "the turn before the restart finished, reason " + endedBefore.reason);
    const watchedBefore = await collectUntil(
      browser1.frames, (f) => f.type === "turn.end" && f.turnId === endedBefore.turnId,
      15000, "the browser to watch that same turn end",
    );
    ok(watchedBefore.reason === endedBefore.reason,
      "the browser watched that same turn end, and agrees how it ended: " + watchedBefore.reason);
    ok(fs.readFileSync(path.join(workspace, "README.md"), "utf8").includes("Added a health check note."),
      "the turn before the restart really ran its tool on the workspace");

    const listedBefore = await listMine(ports.http);
    ok(listedBefore.length === 1 && listedBefore[0].sessionId === sessionBefore,
      "the relay listed that session for its account before the restart");
    const workspacePath = listedBefore[0]?.workspace ?? "";
    ok(workspacePath !== "", "the listing named the workspace, which is half of what a conversation is keyed on");

    // ---- the relay restarts under it -------------------------------------
    // Killed rather than asked to stop: a deploy, an upgrade or a crash is
    // what this is for, and none of those give the relay a chance to tell
    // anybody. The runtime directory is a fresh one so that every command
    // read out of it is provably after the restart - the relay wipes its
    // own directory at startup anyway (src/relay/relay.ts).
    await stopRelay(relay, ports);
    relay = null;
    ok(commandsOfKind(runtimeB, "create").length === 0, "the replacement relay starts with no create recorded");

    const restartedAt = Date.now();
    relay = startRelay(relayBin, ports, runtimeB, consolePort, path.join(workspace, "relay-b.log"));
    ok(await waitForPort(ports.http, 8000), "the replacement relay came up on the same ports");
    await waitForPort(ports.ws, 8000);
    await waitForPort(ports.browser, 8000);

    // ---- and nobody touches anything -------------------------------------
    const remade = await until(
      () => commandsOfKind(runtimeB, "create")[0] ?? null, 60000,
      "a create on the relay after the restart, with no human action",
    );
    ok(remade.accountId === ACCOUNT_ID,
      "the re-made session carries the same verified account, got " + JSON.stringify(remade.accountId));
    ok(remade.workspace === workspacePath,
      "and the same workspace, so it is keyed to the same conversation: "
      + JSON.stringify(remade.workspace) + " vs " + JSON.stringify(workspacePath));
    ok(remade.now >= restartedAt, "that create was issued after the restart, not replayed from before");

    const listedAfter = await until(
      async () => { const l = await listMine(ports.http); return l.length === 1 ? l : null; },
      30000, "the account's listing to hold exactly the re-made session",
    );
    const sessionAfter = listedAfter[0].sessionId;
    ok(sessionAfter !== sessionBefore, "it is a new session id, not the dead one (spec 002: the relay stores nothing durable)");
    ok(listedAfter[0].workspace === workspacePath, "listed under the same workspace as before");

    // The terminal really attached to what it made: a create nobody connects
    // to is exactly the "reported success while nothing happened" shape.
    const connected = await until(
      () => commandsOfKind(runtimeB, "connect").find((c) => c.role === "terminal" && c.sessionId === sessionAfter) ?? null,
      30000, "the terminal to connect to the re-made session",
    );
    ok(connected.sessionId === sessionAfter, "the terminal's websocket authorised against the re-made session");

    // ---- what the terminal says ------------------------------------------
    const said = await collectUntil(term.frames, (f) => f.type === "notice" && f.code === "relay.reshared", 15000, "the re-share notice");
    ok(said.level === "info", "the re-share is told as news, not as a warning, got " + said.level);
    ok(!/\b[0-9A-Z]{6}\b/.test(said.message), "it does not print a fresh pairing code unprompted: " + JSON.stringify(said.message));
    ok(said.message.includes("/share"), "it names /share as where the new code comes from");
    for (const line of said.message.split("\n")) {
      ok(line.length <= 80, "each line of it fits a terminal that clips rather than wraps: " + JSON.stringify(line));
    }

    // ---- #295: /share never replays a code the relay does not hold --------
    term.sock.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
    const second = await collectUntil(
      term.frames, (f) => (f.type === "share.started" && f.code !== codeBefore) || f.type === "share.failed",
      8000, "the second /share",
    );
    ok(second.type === "share.started", "/share after the restart answers with a share, not a failure");
    ok(second.code !== codeBefore, "and not with the dead code, got " + second.code + " vs " + codeBefore);

    const browser2 = await pairBrowser(ports.http, ports.browser, second.code);
    ok(browser2.sessionId === sessionAfter,
      "the code /share printed is one the relay actually holds, and it is the re-made session");
    await collectUntil(browser2.frames, (f) => f.type === "session.hello", 8000, "the re-made session to describe itself");
    ok(browser2.frames.some((f) => f.type === "session.hello" && f.workspace === workspacePath),
      "the re-made session replays session.hello, so a browser meeting it is not looking at an unnamed session");

    // ---- turns run again, driven from the browser ------------------------
    stub.kill();
    await waitForPortGone(stubPort, 8000);
    stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], stubArgs);
    ok(await waitForPort(stubPort, 8000), "the model is answering again for the turn after the restart");

    browser2.sock.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "add another health note" }));
    const askedAfter = await collectUntil(browser2.frames, (f) => f.type === "approval.request", 20000, "an approval on the re-made session");
    browser2.sock.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId: askedAfter.callId, decision: "allow" }));
    const endedAfter = await collectUntil(browser2.frames, (f) => f.type === "turn.end" && f.turnId !== endedBefore.turnId, 25000, "the turn after the restart to end");
    ok(endedAfter.reason === "done", "a turn driven from the browser after the restart ran to completion, reason " + endedAfter.reason);
    const watchedAfter = await collectUntil(
      term.frames, (f) => f.type === "turn.end" && f.turnId === endedAfter.turnId,
      15000, "the terminal to see that same turn end",
    );
    ok(watchedAfter.reason === endedAfter.reason,
      "the terminal saw that same turn, so both ends are on one session again");
    const noteCount = fs.readFileSync(path.join(workspace, "README.md"), "utf8").split("Added a health check note.").length - 1;
    ok(noteCount === 2, "the turn after the restart ran its tool on the real workspace too, notes on disk: " + noteCount);

    // ---- a deliberate ending stays ended ---------------------------------
    // The daemon is stopped, which closes the terminal's socket gracefully -
    // the one signal the relay treats as "this share is over" - and then the
    // relay is restarted under a daemon that never asks to share again.
    term.sock.send(JSON.stringify({ v: 1, seq: 0, type: "daemon.stop" }));
    await collectUntil(term.frames, (f) => f.type === "daemon.stopping", 8000, "the daemon to say it is stopping");
    ok(await waitForPortGone(daemonPort, 15000), "the daemon stopped");
    const detached = await until(
      () => commandsOfKind(runtimeB, "detach").find((c) => c.sessionId === sessionAfter) ?? null,
      15000, "the relay to be told the terminal detached",
    );
    ok(detached.sessionId === sessionAfter, "stopping the daemon ended the share on the relay deliberately");
    ok((await listMine(ports.http)).length === 0, "and the account's listing is empty afterwards");

    await stopRelay(relay, ports);
    relay = startRelay(relayBin, ports, runtimeC, consolePort, path.join(workspace, "relay-c.log"));
    ok(await waitForPort(ports.http, 8000), "a third relay came up for the ended-share check");

    daemon = startDaemon(workspace, homeDir, daemonPort, stubPort, path.join(workspace, "daemon-2.log"));
    ok(await waitForPort(daemonPort, 10000), "a fresh daemon came up on the same workspace");
    const quiet = await attachTo(daemonPort);
    await collectUntil(quiet.frames, (f) => f.type === "session.hello", 8000, "the fresh daemon's session.hello");
    await sleep(10000);
    ok(commandsOfKind(runtimeC, "create").length === 0,
      "a share that was ended deliberately is not re-made by itself, creates seen: "
      + commandsOfKind(runtimeC, "create").length);
    ok((await listMine(ports.http)).length === 0, "and nothing is listed for the account");

    // ---- a relay left down backs off, then reports ------------------------
    quiet.sock.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
    const third = await collectUntil(quiet.frames, (f) => f.type === "share.started" || f.type === "share.failed", 8000, "a share to abandon");
    ok(third.type === "share.started", "the fresh daemon shared, so there is something to lose");
    await until(async () => (await listMine(ports.http)).length === 1, 15000, "that share to be listed");

    await stopRelay(relay, ports);
    relay = null;

    // Accepts the connection and drops it, so every retry is a measurable
    // event. A port nothing listens on would refuse instantly and the client
    // would still back off, but nothing would record when it tried.
    const knocks = [];
    sink = net.createServer((socket) => { knocks.push(Date.now()); socket.destroy(); });
    await new Promise((resolve) => sink.listen(ports.ws, "127.0.0.1", resolve));
    const downSince = Date.now();

    const warned = await collectUntil(quiet.frames, (f) => f.type === "notice" && f.code === "relay.unreachable", 30000, "the terminal to say the relay is unreachable");
    ok(warned.level === "warn", "the outage is warned about rather than passed over in silence");

    await sleep(45000);
    const spaced = knocks.filter((t) => t >= downSince);
    ok(spaced.length > 1, "it kept retrying rather than giving up at the first failure, tries: " + spaced.length);
    ok(spaced.length <= 20, "it backed off rather than spinning: " + spaced.length + " tries in 45s");
    const gaps = spaced.slice(1).map((t, i) => t - spaced[i]);
    const tail = gaps.slice(-3);
    ok(tail.every((g) => g >= 4000), "by the end the retries are seconds apart, last gaps: " + JSON.stringify(tail));
    ok(gaps.every((g) => g <= 20000), "and the backoff is capped rather than unbounded, gaps: " + JSON.stringify(gaps));
    ok(noticeOf(quiet.frames, "relay.share_ended") === undefined, "it has not given up while it is still inside the budget");

    const gaveUp = await collectUntil(
      quiet.frames, (f) => f.type === "notice" && f.code === "relay.share_ended",
      GIVE_UP_WAIT_MS - (Date.now() - downSince), "the terminal to give up and say so",
    );
    ok(gaveUp.level === "warn", "giving up is a warning, not a whisper");
    ok(gaveUp.message.includes(`127.0.0.1:${ports.http}`), "it names the relay it could not reach: " + JSON.stringify(gaveUp.message));
    ok(gaveUp.message.includes("/share"), "and how to share again");
    for (const line of gaveUp.message.split("\n")) {
      ok(line.length <= 80, "each line of it fits 80 columns: " + JSON.stringify(line));
    }

    const afterGivingUp = knocks.length;
    await sleep(6000);
    ok(knocks.length === afterGivingUp, "it stopped knocking once it had given up, extra tries: " + (knocks.length - afterGivingUp));

    // ---- and a share it gave up on does not come back on its own ---------
    await new Promise((resolve) => sink.close(resolve));
    sink = null;
    relay = startRelay(relayBin, ports, runtimeD, consolePort, path.join(workspace, "relay-d.log"));
    ok(await waitForPort(ports.http, 8000), "a fourth relay came up");
    await sleep(12000);
    ok(commandsOfKind(runtimeD, "create").length === 0,
      "a share that was given up on and reported does not resurrect itself, creates: "
      + commandsOfKind(runtimeD, "create").length);

    quiet.sock.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
    const fourth = await collectUntil(quiet.frames, (f) => (f.type === "share.started" && f.code !== third.code) || f.type === "share.failed", 15000, "a share asked for by hand");
    ok(fourth.type === "share.started", "asking for it by hand starts a new share" + (fourth.error ? " (" + fourth.error + ")" : ""));
    const madeByHand = await until(() => commandsOfKind(runtimeD, "create")[0] ?? null, 15000, "that share on the relay");
    ok(madeByHand.accountId === ACCOUNT_ID, "which the relay records against the same account");

    console.log(
      "PASS: a relay restart is repaired by the terminal alone - a create carrying the same account and workspace, "
      + "the terminal attached to it, turns running again from the browser - while a share that was ended or given up on stays ended",
    );
  } finally {
    try { daemon.kill(); } catch { /* already gone */ }
    if (relay !== null) { try { relay.kill(); } catch { /* already gone */ } }
    if (sink !== null) { try { sink.close(); } catch { /* already closed */ } }
    try { stub.kill(); } catch { /* already gone */ }
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
