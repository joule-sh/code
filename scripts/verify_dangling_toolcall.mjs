import { connect } from "./miniws.mjs";
import { signedInHome } from "./lib/signed_in_home.mjs";
import { startConsoleStub } from "./lib/console_stub.mjs";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.mjs";

// A dangling tool_call is a session-killer: once history carries an assistant
// message whose tool_calls were never answered, the provider refuses that
// history, and it keeps being sent, so every later turn in the workspace dies
// with it (#305). Every scenario below ends on the same sentence - after the
// interruption, the NEXT turn in the SAME session still succeeds - reached
// four different ways into the same broken shape.
//
// The stub model refuses an invalid history the way DeepSeek refuses it, so a
// green run says the product built a history a real provider accepts rather
// than that a permissive fake shrugged at it (#280).

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAEMON = path.join(REPO_ROOT, "bin", "joule-daemon");
const RELAY = path.join(REPO_ROOT, "bin", "relay");
const STUB = path.join(REPO_ROOT, "bin", "stub_model");
const PROMPT = "add a health note to the README";
const FOLLOW_UP = "and now say one line about what you did";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function probePort(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection(port, "127.0.0.1");
    sock.once("connect", () => { sock.end(); resolve(true); });
    sock.once("error", () => resolve(false));
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probePort(port)) return true;
    await sleep(50);
  }
  return false;
}

async function waitForPortClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probePort(port))) return true;
    await sleep(50);
  }
  return false;
}

function spawnBg(command, args, options) {
  const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, "SIGKILL"); }
  catch { try { child.kill("SIGKILL"); } catch { } }
}

function killListenersOn(port) {
  if (!port) return 0;
  const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  const pids = (r.stdout || "").split("\n").map((s) => s.trim()).filter(Boolean);
  for (const pid of pids) { try { process.kill(Number(pid), "SIGKILL"); } catch { } }
  return pids.length;
}

function runSync(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${r.stderr}`);
}

function seedRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# demo\n\nNo health route yet.\n");
  runSync("git", ["init", "-q"], dir);
  runSync("git", ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", "add", "."], dir);
  runSync("git", ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", "commit", "-q", "-m", "seed"], dir);
}

// The one attached client, holding every frame the daemon has sent it.
async function attach(port) {
  const conn = await connect("127.0.0.1", port, `/attach/${crypto.randomUUID()}/ws`, {});
  const frames = [];
  conn.onMessage((raw) => {
    try { frames.push(JSON.parse(raw)); } catch { }
  });
  conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  const client = {
    conn,
    frames,
    send: (f) => conn.send(JSON.stringify(f)),
    close: () => { try { conn.close(); } catch { } },
    find: (pred) => frames.find(pred),
    mark: () => frames.length,
    awaitAfter: async (from, pred, timeoutMs, label) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hit = frames.slice(from).find(pred);
        if (hit) return hit;
        await sleep(25);
      }
      throw new Error("timed out waiting for " + label);
    },
  };
  client.await = (pred, timeoutMs, label) => client.awaitAfter(0, pred, timeoutMs, label);
  await client.await((f) => f.type === "session.hello", 10000, "session.hello");
  return client;
}

function refusalCount(stubLog) {
  try { return (fs.readFileSync(stubLog, "utf8").match(/CONTRACT REFUSED/g) || []).length; }
  catch { return 0; }
}

// What every scenario ends on. A turn that reaches turn.end without the
// provider refusing the history is a session that survived the interruption.
async function nextTurnSucceeds(client, stubLog, ok) {
  const from = client.mark();
  const refusedBefore = refusalCount(stubLog);
  client.send({ v: 1, seq: 0, type: "input", text: FOLLOW_UP });

  const answered = new Set();
  const deadline = Date.now() + 40000;
  let end = null;
  while (Date.now() < deadline && !end) {
    for (const f of client.frames.slice(from)) {
      if (f.type === "approval.request" && !answered.has(f.callId)) {
        answered.add(f.callId);
        client.send({ v: 1, seq: 0, type: "approval.reply", callId: f.callId, decision: "deny" });
      }
      if (f.type === "turn.end" && !end) end = f;
    }
    if (!end) await sleep(25);
  }
  ok(!!end, "the next turn in the same session reached turn.end");
  if (end) {
    ok(end.reason !== "error", "the next turn ended '" + end.reason + "' rather than in a provider error");
  }

  const refused = client.frames.slice(from)
    .filter((f) => f.type === "error" && String(f.message || "").indexOf("insufficient tool messages") >= 0);
  ok(refused.length === 0, "no turn was refused for an unanswered tool_call"
    + (refused.length ? " (" + refused[0].message + ")" : ""));
  ok(refusalCount(stubLog) === refusedBefore, "the provider was never handed a history that breaks its contract");
}

async function withStack(name, opts, body) {
  const failures = [];
  const ok = (cond, label) => {
    if (cond) console.log("ok: " + name + ": " + label);
    else { failures.push(name + ": " + label); console.error("FAIL: " + name + ": " + label); }
  };

  const wantsRelay = opts.relay === true;
  const ports = {
    stub: await freePort(),
    daemon: await freePort(),
    http: wantsRelay ? await freePort() : 0,
    ws: wantsRelay ? await freePort() : 0,
    wsBrowser: wantsRelay ? await freePort() : 0,
  };

  const workDir = scratchDir("joule-305-");
  const repoDir = path.join(workDir, "repo");
  seedRepo(repoDir);
  const stubLog = path.join(workDir, "stub_requests.log");

  let home;
  let consoleStub = null;
  if (wantsRelay) {
    const secret = "dangling-toolcall-secret";
    consoleStub = await startConsoleStub(secret, { id: "acct-305", email: "e@example.com" });
    home = signedInHome({
      prefix: "joule-305-home",
      server: "http://joule-305.invalid",
      secret,
      relayUrl: `http://127.0.0.1:${ports.http}`,
      relayWsUrl: `ws://127.0.0.1:${ports.ws}`,
    });
  } else {
    home = path.join(workDir, "home");
    fs.mkdirSync(path.join(home, ".config", "joule-code"), { recursive: true });
    fs.writeFileSync(path.join(home, ".config", "joule-code", "config.json"), JSON.stringify({
      baseUrl: "", model: "", apiKey: "", server: "", updateCheck: "", mouse: "",
    }));
  }

  const startRelay = () => spawnBg(RELAY, [], {
    env: {
      ...process.env,
      JOULE_RELAY_HTTP_PORT: String(ports.http),
      JOULE_RELAY_WS_PORT: String(ports.ws),
      JOULE_RELAY_WS_BROWSER_PORT: String(ports.wsBrowser),
      JOULE_RELAY_CONSOLE_URL: `http://127.0.0.1:${consoleStub ? consoleStub.address().port : 0}`,
    },
  });

  const daemonEnv = {
    ...process.env,
    HOME: home,
    TMPDIR: workDir,
    JOULE_DAEMON_PORT: String(ports.daemon),
    JOULE_CODE_BASE_URL: `http://127.0.0.1:${ports.stub}`,
    JOULE_CODE_MODEL: "stub",
    JOULE_CODE_API_KEY: "stub-key",
  };
  if (opts.resume === true) daemonEnv.JOULE_DAEMON_RESUME = "1";

  let stub, relay, daemon;
  const startDaemon = () => {
    daemon = spawnBg(DAEMON, [], { cwd: repoDir, env: daemonEnv });
    return daemon;
  };
  let completed = false;
  try {
    stub = spawnBg(STUB, [], { env: { ...process.env, E2E_STUB_PORT: String(ports.stub), E2E_STUB_LOG: stubLog } });
    if (!(await waitForPort(ports.stub, 10000))) throw new Error(name + ": the stub model did not start");

    if (wantsRelay) {
      relay = startRelay();
      if (!(await waitForPort(ports.http, 10000))) throw new Error(name + ": the relay did not start");
      await waitForPort(ports.ws, 10000);
      await waitForPort(ports.wsBrowser, 10000);
    }

    if (opts.resume !== true) {
      startDaemon();
      if (!(await waitForPort(ports.daemon, 20000))) throw new Error(name + ": the daemon did not start");
    }

    await body({ ok, ports, stubLog, repoDir, home, startDaemon, startRelay, setRelay: (r) => { relay = r; } });
    completed = true;
  } finally {
    killTree(daemon);
    killTree(relay);
    killTree(stub);
    if (consoleStub) consoleStub.close();
    for (const p of [ports.daemon, ports.http, ports.ws, ports.wsBrowser, ports.stub]) killListenersOn(p);
    if (completed && failures.length === 0) {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { }
      try { if (wantsRelay) fs.rmSync(home, { recursive: true, force: true }); } catch { }
    } else {
      console.error(name + ": left " + workDir + " in place");
    }
  }
  return failures;
}

// Nothing is interrupted here. A message reaches the session while the turn is
// parked in an approval, which is the window a finishing background task, a
// subagent report, or a mode change lands in - and it is what makes this
// common rather than rare.
function noteMidApproval() {
  return withStack("note-mid-approval", {}, async ({ ok, ports, stubLog }) => {
    const client = await attach(ports.daemon);
    client.send({ v: 1, seq: 0, type: "input", text: PROMPT });

    const ask = await client.await((f) => f.type === "approval.request", 30000, "approval.request");
    ok(ask.tool === "run", "the turn is parked in an approval for the run tool");

    client.send({ v: 1, seq: 0, type: "mode.set", mode: "plan" });
    await client.await((f) => f.type === "mode.changed", 10000, "mode.changed");
    ok(true, "a message reached the session while the tool call was still unanswered");

    client.send({ v: 1, seq: 0, type: "approval.reply", callId: ask.callId, decision: "allow" });
    await client.await((f) => f.type === "turn.end", 30000, "the first turn ending");

    await nextTurnSucceeds(client, stubLog, ok);
    client.close();
  });
}

// The client that asked goes away with the call unanswered, and another one
// takes over - a closed terminal, a dropped connection, a reopened window.
function clientExit() {
  return withStack("client-exit", {}, async ({ ok, ports, stubLog }) => {
    const first = await attach(ports.daemon);
    first.send({ v: 1, seq: 0, type: "input", text: PROMPT });
    const ask = await first.await((f) => f.type === "approval.request", 30000, "approval.request");
    first.close();
    ok(true, "the client that asked for the approval left with the call unanswered");

    await sleep(1000);
    const second = await attach(ports.daemon);
    second.send({ v: 1, seq: 0, type: "approval.reply", callId: ask.callId, decision: "deny" });
    await second.await((f) => f.type === "turn.end", 30000, "the first turn ending");

    await nextTurnSucceeds(second, stubLog, ok);
    second.close();
  });
}

// A cancel arrives while the turn still owes results for calls it has made.
function cancelMidTurn() {
  return withStack("cancel-mid-turn", {}, async ({ ok, ports, stubLog }) => {
    const client = await attach(ports.daemon);
    client.send({ v: 1, seq: 0, type: "input", text: PROMPT });

    const start = await client.await((f) => f.type === "turn.start", 20000, "turn.start");
    client.send({ v: 1, seq: 0, type: "cancel", turnId: start.turnId });
    ok(true, "the turn was cancelled with calls still owing results");

    const parked = await client.await(
      (f) => f.type === "approval.request" || f.type === "turn.end", 30000, "an approval or the end");
    if (parked.type === "approval.request") {
      client.send({ v: 1, seq: 0, type: "approval.reply", callId: parked.callId, decision: "deny" });
    }
    await client.await((f) => f.type === "turn.end", 30000, "the cancelled turn ending");

    await nextTurnSucceeds(client, stubLog, ok);
    client.close();
  });
}

// The reproduction the ticket was filed from: the relay restarts under a live
// session that is mid-turn. The session lives in the daemon, so this is the
// interruption that exposed the shape rather than the one that creates it,
// which is exactly why it is worth asserting that it does not create it.
function relayRestart() {
  return withStack("relay-restart", { relay: true }, async ({ ok, ports, stubLog, startRelay, setRelay }) => {
    const client = await attach(ports.daemon);
    client.send({ v: 1, seq: 0, type: "share.request" });
    const shared = await client.await(
      (f) => f.type === "share.started" || f.type === "share.failed", 20000, "the share result");
    ok(shared.type === "share.started", "the session is shared through the relay"
      + (shared.type === "share.failed" ? " (" + shared.error + ")" : ""));

    client.send({ v: 1, seq: 0, type: "input", text: PROMPT });
    const ask = await client.await((f) => f.type === "approval.request", 30000, "approval.request");
    ok(!!ask, "the turn is parked in an approval with the call unanswered");

    const killed = killListenersOn(ports.http) + killListenersOn(ports.ws) + killListenersOn(ports.wsBrowser);
    ok(killed > 0, "the relay was killed under the live session, mid-turn");
    await waitForPortClosed(ports.http, 10000);

    setRelay(startRelay());
    ok(await waitForPort(ports.http, 20000), "a relay came back on the same address");

    client.send({ v: 1, seq: 0, type: "approval.reply", callId: ask.callId, decision: "allow" });
    await client.await((f) => f.type === "turn.end", 40000, "the interrupted turn ending");

    await nextTurnSucceeds(client, stubLog, ok);
    client.close();
  });
}

// Where a workspace's saved session lives, mirroring sessionKeyFor in
// src/session/persistence.ts. A harness that guessed at this would silently
// write a file nothing reads and then pass for the wrong reason.
function sessionFilePath(home, workspaceRoot) {
  const safe = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
  let slug = Array.from(workspaceRoot).map((c) => (safe.includes(c) ? c : "-")).join("");
  if (slug.length > 60) slug = slug.slice(slug.length - 60);
  const suffix = crypto.createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 16);
  return path.join(home, ".config", "joule-code", "sessions", `${slug}-${suffix}.json`);
}

// A session whose saved history already carries an unanswered tool call - what
// a crash mid-turn leaves behind. Replaying it forever is what makes a
// workspace unusable rather than a single turn lost, so the next turn has to
// repair it.
function resumedPoisoned() {
  return withStack("resumed-poisoned", { resume: true }, async ({ ok, ports, stubLog, repoDir, home, startDaemon }) => {
    const file = sessionFilePath(home, repoDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      workspace: repoDir,
      savedAt: String(Date.now()),
      history: [
        { role: "system", text: "You are joule.", toolCallId: "", toolCalls: [] },
        { role: "user", text: "start the server and check it", toolCallId: "", toolCalls: [] },
        { role: "assistant", text: "let me verify it is responding", toolCallId: "", toolCalls: [
          { callId: "call_never_answered", tool: "run", args: "{\"command\":\"curl -s localhost:8080\"}" },
        ] },
      ],
    }));
    ok(fs.existsSync(file), "a session was left on disk with a tool call that never reported");

    startDaemon();
    if (!(await waitForPort(ports.daemon, 20000))) throw new Error("resumed-poisoned: the daemon did not come back");
    const client = await attach(ports.daemon);
    await nextTurnSucceeds(client, stubLog, ok);
    client.close();
  });
}

const SCENARIOS = {
  "note-mid-approval": noteMidApproval,
  "client-exit": clientExit,
  "cancel-mid-turn": cancelMidTurn,
  "relay-restart": relayRestart,
  "resumed-poisoned": resumedPoisoned,
};

async function main() {
  const wanted = (process.env.JOULE_305_SCENARIOS || Object.keys(SCENARIOS).join(","))
    .split(",").map((s) => s.trim()).filter(Boolean);
  const start = Date.now();
  const failures = [];
  for (const name of wanted) {
    const scenario = SCENARIOS[name];
    if (!scenario) throw new Error("no scenario named " + name);
    failures.push(...(await scenario()));
  }
  console.log(`dangling tool_call checks finished in ${Date.now() - start}ms`);
  if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("an interrupted turn no longer kills the session it happened in");
}

main().catch((e) => {
  console.error("crashed: " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
