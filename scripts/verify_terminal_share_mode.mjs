// The terminal front end - the fallback src/code.ts runs when it cannot attach
// to a daemon - shares its session with the relay too, and what it put on the
// wire as `mode` was the kind the Session is constructed with rather than the
// approval mode the gate is running (#312). A console reading that share was
// told the model twice and the mode never.
//
// So this reads the value off a real browser socket instead of off the screen:
// the binary runs on a pty with no daemon binary beside it, /share goes through
// a real relay, and a paired browser is asked what the hello actually carried.
// Then /mode and /model are typed at the terminal and the browser is asked
// again - that path set the gate and redrew and published nothing at all, so a
// watcher never learned the mode had moved.
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
const APPROVAL_MODES = ["read-only", "auto-edit", "safe-auto", "full-auto", "plan"];
const ESC = String.fromCharCode(27);
const CTRL_D = String.fromCharCode(4);
const CSI_SEQUENCE = new RegExp(ESC + "\\[[0-9;?]*[ -/]*[@-~]", "g");
const OSC_SEQUENCE = new RegExp(ESC + "\\][^" + ESC + "\\u0007]*(?:\\u0007|" + ESC + "\\\\)?", "g");
const SHORT_SEQUENCE = new RegExp(ESC + "[()][A-Za-z0-9]|" + ESC + "[=>78Mc]", "g");

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

function stripAnsi(text) {
  return text.replace(OSC_SEQUENCE, "").replace(CSI_SEQUENCE, "").replace(SHORT_SEQUENCE, "");
}

async function waitForText(pty, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stripAnsi(pty.text()).includes(needle)) return true;
    await sleep(100);
  }
  return false;
}

async function waitForPairingCode(pty, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = stripAnsi(pty.text()).match(/attached - code ([A-Z0-9]{6}) /);
    if (found !== null) return found[1];
    await sleep(100);
  }
  return "";
}

async function pairWithCode(relayHttpPort, code, userId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = { status: 0, json: null };
  while (Date.now() < deadline) {
    last = await fetchJson(`http://127.0.0.1:${relayHttpPort}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId },
      body: JSON.stringify({ code }),
    });
    if (last.status === 200 && last.json && last.json.sessionId) return last;
    await sleep(250);
  }
  return last;
}

async function waitForFrame(seen, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = seen.find(predicate);
    if (found) return found;
    await sleep(50);
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

function startPty(command, args, options) {
  const bridge = path.join(REPO_ROOT, "scripts", "lib", "pty_bridge.py");
  const child = spawn("python3", [bridge, "200", "50", command, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "inherit"],
  });
  let buffer = "";
  child.stdout.on("data", (chunk) => { buffer += chunk.toString("utf8"); });
  return {
    child,
    text: () => buffer,
    type: (text) => child.stdin.write(text),
  };
}

async function main() {
  const workspace = scratchDir("joule-terminal-share-mode-");
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n");

  // A copy of the binary with no joule-daemon beside it: src/code.ts asks the
  // daemon path first and only falls back to the terminal when it cannot get
  // one, and the daemon it would spawn is looked for next to the running exe.
  const lonely = path.join(workspace, "lonely");
  fs.mkdirSync(lonely, { recursive: true });
  const jouleBin = path.join(lonely, "joule");
  fs.copyFileSync(path.join(REPO_ROOT, "bin", "joule"), jouleBin);
  fs.chmodSync(jouleBin, 0o755);

  const stubPort = await freePort();
  const relayHttpPort = await freePort();
  const relayWsPort = await freePort();
  const relayWsBrowserPort = await freePort();

  const stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], {
    cwd: workspace,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "inherit",
  });

  const secret = "e2e-terminal-share-mode-secret";
  const consoleStub = await startConsoleStub(secret, { id: "acct-terminal-share-mode", email: "t@example.com" });
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
    prefix: "joule-terminal-share-mode-home",
    server: "http://joule-terminal-share-mode.invalid",
    secret,
    relayUrl: `http://127.0.0.1:${relayHttpPort}`,
    relayWsUrl: `ws://127.0.0.1:${relayWsPort}`,
  });

  let pty = null;
  try {
    ok(await waitForPort(stubPort, 5000), "stub model came up");
    ok(await waitForPort(relayHttpPort, 5000), "relay http came up");
    ok(await waitForPort(relayWsBrowserPort, 5000), "relay browser ws came up");

    pty = startPty(jouleBin, ["--share"], {
      cwd: workspace,
      env: withoutInheritedConfig({
        ...process.env,
        HOME: homeDir,
        TERM: "xterm-256color",
        JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
        JOULE_CODE_MODEL: "stub-model",
        JOULE_CODE_API_KEY: "test-key",
        TMPDIR: workspace,
      }),
    });

    ok(await waitForText(pty, "joule - type a request", 20000),
      "the terminal front end started on a pty, which is the path this share comes from");
    const code = await waitForPairingCode(pty, 20000);
    ok(code !== "", "--share attached the terminal to the relay and printed a pairing code");
    if (code === "") { throw new Error("no pairing code on screen"); }

    const userId = crypto.randomUUID();
    const paired = await pairWithCode(relayHttpPort, code, userId, 10000);
    ok(paired.status === 200 && paired.json && paired.json.sessionId,
      "a browser paired against that code, relay answered " + paired.status + " " + JSON.stringify(paired.json));
    if (!paired.json || !paired.json.sessionId) { throw new Error("pairing did not produce a session"); }
    const sessionId = paired.json.sessionId;

    const browser = await connect("127.0.0.1", relayWsBrowserPort, `/w/${sessionId}/ws?x-user=${encodeURIComponent(userId)}`, {});
    const seen = [];
    browser.onMessage((text) => { try { seen.push(JSON.parse(text)); } catch { /* ignore */ } });
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));

    const hello = await waitForFrame(seen, (f) => f.type === "session.hello", 15000, "session.hello at the browser");
    ok(!String(hello.sessionId).startsWith("daemon-"),
      "this share came from the terminal front end rather than a daemon, sessionId " + hello.sessionId);
    ok(APPROVAL_MODES.includes(hello.mode),
      "the hello's mode is a real approval mode, got " + JSON.stringify(hello.mode));
    ok(hello.mode === "auto-edit",
      "the hello carries the mode the gate is actually running, got " + JSON.stringify(hello.mode));
    ok(hello.mode !== "agent",
      "the hello does not carry the kind the Session is constructed with where the approval mode belongs");
    ok(hello.model && hello.mode !== hello.model,
      "a reader of this share is told the mode and the model, not the model twice: mode " + JSON.stringify(hello.mode) + ", model " + JSON.stringify(hello.model));

    pty.type("/mode full-auto\r");
    const toFull = await waitForFrame(seen, (f) => f.type === "mode.changed", 15000, "mode.changed after /mode full-auto at the terminal");
    ok(toFull.mode === "full-auto", "a /mode at the terminal moved the watcher's row, got " + JSON.stringify(toFull.mode));

    ok(await waitForText(pty, "mode set to full-auto", 5000),
      "the person at the terminal is still told the mode moved, by the same frame the watcher reads");

    pty.type("/mode read-only\r");
    const back = await waitForFrame(seen, (f) => f.type === "mode.changed" && f.mode === "read-only", 15000, "mode.changed after /mode read-only");
    ok(back.mode === "read-only", "and moving it again is reported too, so a watcher tracks the mode rather than seeing one lucky frame");

    pty.type("/model stub-other\r");
    const modelChanged = await waitForFrame(seen, (f) => f.type === "model.changed", 15000, "model.changed after /model at the terminal");
    ok(String(modelChanged.model).includes("stub-other"),
      "a /model at the terminal is reported too, got " + JSON.stringify(modelChanged.model));

    ok(await waitForText(pty, "model set to stub-other", 5000),
      "and told the model moved as well");

    const modeChanges = seen.filter((f) => f.type === "mode.changed").map((f) => f.mode);
    ok(modeChanges.join(",") === "full-auto,read-only",
      "the watcher saw exactly the two mode moves that were typed, in order, got " + modeChanges.join(","));

    pty.type(CTRL_D);
    console.log("PASS: the terminal front end tells the relay the approval mode its gate is running, and says so again whenever /mode or /model moves it");
  } finally {
    if (pty !== null) { pty.child.kill(); }
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
