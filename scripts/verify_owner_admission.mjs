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

const OWNER_USER = "hM1qCbrelayBrowserTokenForAcctE2E1";
const GUEST_USER = "9c0e4d22-guest-browser-uuid";

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

function watching(host, port, route) {
  return (async () => {
    const sock = await connect(host, port, route, {});
    const frames = [];
    sock.onMessage((text) => { try { frames.push(JSON.parse(text)); } catch { /* not a frame */ } });
    return { sock, frames };
  })();
}

function relayCommands(workspace, relayHttpPort) {
  const log = path.join(workspace, `joule-relay-runtime-${relayHttpPort}`, "commands.log");
  if (!fs.existsSync(log)) { return []; }
  return fs.readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line.indexOf("{") >= 0)
    .map((line) => {
      try { return JSON.parse(line.slice(line.indexOf("{"))); } catch { return null; }
    })
    .filter((one) => one !== null);
}

function startRelay(workspace, name, ports, consolePort) {
  return spawn(path.join(REPO_ROOT, "bin", "relay"), [], {
    env: {
      ...process.env,
      JOULE_RELAY_HTTP_PORT: String(ports.http),
      JOULE_RELAY_WS_PORT: String(ports.ws),
      JOULE_RELAY_WS_BROWSER_PORT: String(ports.browser),
      JOULE_RELAY_CONSOLE_URL: `http://127.0.0.1:${consolePort}`,
      TMPDIR: workspace,
    },
    stdio: [
      "ignore",
      fs.openSync(path.join(workspace, name + ".log"), "w"),
      fs.openSync(path.join(workspace, name + ".log"), "a"),
    ],
  });
}

function startDaemon(workspace, homeDir, name, daemonPort, stubPort) {
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
    stdio: [
      "ignore",
      fs.openSync(path.join(workspace, name + ".log"), "w"),
      fs.openSync(path.join(workspace, name + ".log"), "a"),
    ],
  });
}

async function shareFrom(daemonPort, tag) {
  const attached = await watching("127.0.0.1", daemonPort, `/attach/${tag}/ws`);
  attached.sock.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  await sleep(200);
  attached.sock.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
  const answer = await collectUntil(
    attached.frames,
    (f) => f.type === "share.started" || f.type === "share.failed",
    8000,
    "an answer to share.request",
  );
  return { attached, answer };
}

async function main() {
  const workspace = scratchDir("joule-owner-admission-");
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nNo health route yet.\n");

  const credentialSecret = "e2e-owner-secret-abc123";
  const account = { id: "acct-e2e-1", email: "e2e@example.com", relayUser: OWNER_USER };
  const server = "http://joule-owner-admission.invalid";
  const watchPage = `${server}/terminal/sessions`;

  const consoleStub = await startConsoleStub(credentialSecret, account);
  const consolePort = consoleStub.address().port;

  const stubPort = await freePort();
  const daemonPort = await freePort();
  const ports = { http: await freePort(), ws: await freePort(), browser: await freePort() };

  const homeDir = signedInHome({
    prefix: "joule-owner-admission-home",
    server,
    secret: credentialSecret,
    relayUrl: `http://127.0.0.1:${ports.http}`,
    relayWsUrl: `ws://127.0.0.1:${ports.ws}`,
    webUrl: watchPage,
  });

  const stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], {
    cwd: workspace,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "inherit",
  });
  const relay = startRelay(workspace, "relay", ports, consolePort);
  const daemon = startDaemon(workspace, homeDir, "daemon", daemonPort, stubPort);

  try {
    ok(await waitForPort(stubPort, 5000), "stub model came up");
    ok(await waitForPort(ports.http, 5000), "relay http came up");
    ok(await waitForPort(daemonPort, 5000), "daemon came up");

    const shared = await shareFrom(daemonPort, "e2e-owner");
    ok(shared.answer.type === "share.started",
      "share.request produced share.started" + (shared.answer.error ? " (" + shared.answer.error + ")" : ""));
    if (shared.answer.type !== "share.started") { throw new Error("cannot continue: " + shared.answer.error); }

    const creates = relayCommands(workspace, ports.http).filter((one) => one.kind === "create");
    ok(creates.length === 1, "the relay recorded exactly one create, got " + creates.length);
    ok(creates[0].accountId === account.id,
      "the create carries the account the console vouched for, got " + JSON.stringify(creates[0].accountId));
    ok(creates[0].ownerUser === OWNER_USER,
      "and the owner browser name that same verify handed back, got " + JSON.stringify(creates[0].ownerUser));

    const mine = await fetchJson(`http://127.0.0.1:${ports.http}/sessions/mine`, {
      headers: { "x-user": account.id },
    });
    ok(mine.status === 200 && mine.json.sessions.length === 1, "the session is listed for its account");
    const sessionId = mine.json.sessions[0].sessionId;

    const owner = await watching("127.0.0.1", ports.browser,
      `/w/${sessionId}/ws?x-user=${encodeURIComponent(OWNER_USER)}`);
    owner.sock.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));

    const hello = await collectUntil(owner.frames, (f) => f.type === "session.hello", 8000,
      "the owner's recorder to be admitted and replayed from the start of the session");
    ok(hello.workspace === workspace,
      "nobody typed a code and the transcript still begins at session.hello, naming the workspace, got " + hello.workspace);
    ok(!owner.frames.some((f) => f.type === "error"),
      "the relay refused it nothing: " + JSON.stringify(owner.frames.filter((f) => f.type === "error")));

    const beforeDriving = relayCommands(workspace, ports.http);
    ok(!beforeDriving.some((one) => one.kind === "pair"),
      "the relay was never asked to pair anything - this admission spent no code");
    const ownerConnects = beforeDriving.filter((one) => one.kind === "connect" && one.role === "browser");
    ok(ownerConnects.length >= 1 && ownerConnects.every((one) => one.credential === OWNER_USER),
      "and the only browser connect it recorded presented the owner name, got " + JSON.stringify(ownerConnects.map((one) => one.credential)));

    const listedNow = await fetchJson(`http://127.0.0.1:${ports.http}/sessions/mine`, {
      headers: { "x-user": account.id },
    });
    ok(listedNow.json.sessions[0].paired === false,
      "the session still reports unpaired: an owner does not consume the pairing a third party would need");

    shared.attached.sock.send(JSON.stringify({
      v: 1, seq: 0, type: "input", text: "add a health note to the README",
    }));
    const approval = await collectUntil(owner.frames, (f) => f.type === "approval.request", 15000,
      "the owner's browser to see the turn happening with nobody having touched the console");
    ok(approval.tool === "run", "the turn it is recording is the real one, pending on the run tool");

    owner.sock.send(JSON.stringify({
      v: 1, seq: 0, type: "approval.reply", callId: approval.callId, decision: "allow",
    }));
    const turnEnd = await collectUntil(owner.frames, (f) => f.type === "turn.end", 20000,
      "turn.end after the owner's own browser approved");
    ok(turnEnd.reason === "done", "an admitted owner drives as well as watches, got " + turnEnd.reason);
    ok(fs.readFileSync(path.join(workspace, "README.md"), "utf8").includes("Added a health check note."),
      "and the approved tool's effect landed on the real workspace");

    const turnFrames = owner.frames.filter((f) => f.type === "turn.start" || f.type === "turn.end");
    ok(turnFrames.length >= 2, "the conversation recorded the turn as a turn, got " + JSON.stringify(turnFrames.map((f) => f.type)));

    const guest = await watching("127.0.0.1", ports.browser,
      `/w/${sessionId}/ws?x-user=${encodeURIComponent(GUEST_USER)}`);
    guest.sock.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    const refused = await collectUntil(guest.frames, (f) => f.type === "error", 8000,
      "a browser signed in as somebody else to be refused");
    ok(refused.code === "not_paired",
      "a browser that is not this account is still told to go and get a code, got " + refused.code);
    ok(!guest.frames.some((f) => f.type === "session.hello"),
      "and it was shown nothing of the session before being refused");

    const wrongCode = await fetchJson(`http://127.0.0.1:${ports.http}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": GUEST_USER },
      body: JSON.stringify({ code: "ZZZZZZ" }),
    });
    ok(wrongCode.status === 400, "and guessing at the code buys it nothing either");

    const paired = await fetchJson(`http://127.0.0.1:${ports.http}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": GUEST_USER },
      body: JSON.stringify({ code: shared.answer.code }),
    });
    ok(paired.status === 200 && paired.json.sessionId === sessionId,
      "the code the terminal printed still pairs a third party, unchanged by any of this");

    const guestAgain = await watching("127.0.0.1", ports.browser,
      `/w/${sessionId}/ws?x-user=${encodeURIComponent(GUEST_USER)}`);
    guestAgain.sock.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    const guestHello = await collectUntil(guestAgain.frames, (f) => f.type === "session.hello", 8000,
      "the paired third party to be admitted by the code path");
    ok(guestHello.workspace === workspace, "and it sees the session it was invited to");

    const ownerStillOk = await watching("127.0.0.1", ports.browser,
      `/w/${sessionId}/ws?x-user=${encodeURIComponent(OWNER_USER)}`);
    ownerStillOk.sock.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await collectUntil(ownerStillOk.frames, (f) => f.type === "session.hello", 8000,
      "the owner to still be admitted after somebody else spent the code");
    ok(true, "spending the code on a guest does not evict the owner");

    await sideRelayAdmitsNobody(workspace, credentialSecret, server, watchPage, stubPort);

    console.log("PASS: a terminal shared from a signed-in machine has its own account's browser admitted with no code, records the turns as they happen and drives them, while a browser for any other account is still refused until the terminal's own code is spent");
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

/* A console that verifies the credential and names no relayUser. The session is
   owned, listed and shareable, and there is no owner to admit: the exemption
   exists only where that one verify put it, never as a rule about accounts. */
async function sideRelayAdmitsNobody(workspace, credentialSecret, server, watchPage, stubPort) {
  const quiet = await startConsoleStub(credentialSecret, { id: "acct-e2e-1", email: "e2e@example.com" });
  const quietPort = quiet.address().port;
  const ports = { http: await freePort(), ws: await freePort(), browser: await freePort() };
  const relay = startRelay(workspace, "quiet-relay", ports, quietPort);
  const homeDir = signedInHome({
    prefix: "joule-owner-admission-quiet",
    server,
    secret: credentialSecret,
    relayUrl: `http://127.0.0.1:${ports.http}`,
    relayWsUrl: `ws://127.0.0.1:${ports.ws}`,
    webUrl: watchPage,
  });
  const daemonPort = await freePort();
  const daemon = startDaemon(workspace, homeDir, "quiet-daemon", daemonPort, stubPort);
  try {
    ok(await waitForPort(ports.http, 5000), "a relay whose console names no owner browser came up");
    ok(await waitForPort(daemonPort, 5000), "and a daemon sharing into it");
    const shared = await shareFrom(daemonPort, "e2e-quiet");
    ok(shared.answer.type === "share.started", "the share still succeeds and the session is still owned");
    const mine = await fetchJson(`http://127.0.0.1:${ports.http}/sessions/mine`, {
      headers: { "x-user": "acct-e2e-1" },
    });
    ok(mine.json.sessions.length === 1, "and still listed for its account");
    const sessionId = mine.json.sessions[0].sessionId;
    const tried = await watching("127.0.0.1", ports.browser,
      `/w/${sessionId}/ws?x-user=${encodeURIComponent(OWNER_USER)}`);
    tried.sock.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    const refused = await collectUntil(tried.frames, (f) => f.type === "error", 8000,
      "a browser presenting an owner name this relay was never handed");
    ok(refused.code === "not_paired",
      "an owner name is only ever the one that verify handed back, never a guess, got " + refused.code);
    const byAccount = await watching("127.0.0.1", ports.browser,
      `/w/${sessionId}/ws?x-user=${encodeURIComponent("acct-e2e-1")}`);
    byAccount.sock.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    const alsoRefused = await collectUntil(byAccount.frames, (f) => f.type === "error", 8000,
      "a browser presenting the bare account id");
    ok(alsoRefused.code === "not_paired",
      "and knowing the account id is not knowing the owner name, got " + alsoRefused.code);
  } finally {
    daemon.kill();
    relay.kill();
    quiet.close();
    if (!process.env.DEBUG_KEEP) { fs.rmSync(homeDir, { recursive: true, force: true }); }
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exitCode = 1;
});
