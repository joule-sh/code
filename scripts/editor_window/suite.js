const vscode = require("vscode");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { assertPlacement, expected } = require("./placement.js");
const { panelChecks } = require("./panel_checks.js");

const SCENARIO = process.env.JOULE_EDITOR_TEST_SCENARIO || "conversation";
const ROOT = process.env.JOULE_EDITOR_TEST_ROOT || "";
const WORKSPACE = process.env.JOULE_EDITOR_TEST_WORKSPACE || "";
const STUB = process.env.JOULE_EDITOR_TEST_STUB || "";
const STUB_PORT = Number(process.env.JOULE_EDITOR_TEST_STUB_PORT || "0");
const HOME = process.env.HOME || "";
const LOG = path.join(ROOT, "suite.log");

const PROMPT = "fix the health route";
const FIX_COMMAND = "echo 'Added a health check note.' >> README.md";
const NOTE = "Added a health check note.";

let failures = 0;
let probeSeq = 0;
let stub = null;

const checks = panelChecks({
  ok, probe, shown, waitForShown, waitFor, real, workspace: WORKSPACE, home: HOME,
});

function say(line) {
  console.log(line);
  if (ROOT !== "") { fs.appendFileSync(LOG, line + "\n"); }
}

function ok(condition, label) {
  if (condition) {
    say("ok: " + label);
    return true;
  }
  failures += 1;
  say("FAIL: " + label);
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) { return; }
    await sleep(100);
  }
  throw new Error("timed out after " + timeoutMs + "ms waiting for " + label);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection(port, "127.0.0.1");
    sock.once("connect", () => { sock.end(); resolve(true); });
    sock.once("error", () => resolve(false));
  });
}

function daemonRecords() {
  try {
    return fs.readdirSync(path.join(HOME, ".config", "joule-code", "daemon")).filter((f) => f.endsWith(".json"));
  } catch (e) {
    void e;
    return [];
  }
}

function probe(panel, message, timeoutMs) {
  probeSeq += 1;
  const id = "probe-" + probeSeq;
  if (panel.view === null) { return Promise.reject(new Error("the panel has no webview to probe")); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      panel.off("probe", onProbe);
      reject(new Error("the webview never answered probe " + JSON.stringify(message)));
    }, timeoutMs || 10000);
    function onProbe(reply) {
      if (reply.id !== id) { return; }
      clearTimeout(timer);
      panel.off("probe", onProbe);
      resolve(reply);
    }
    panel.on("probe", onProbe);
    panel.view.webview.postMessage(Object.assign({ kind: "probe", id }, message));
  });
}

function watchForHello(panel) {
  const seen = { hello: false };
  panel.on("probe", (reply) => {
    if (reply.id === "probe-hello") { seen.hello = true; }
  });
  return seen;
}

async function webviewReady(panel, hello, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !hello.hello) { await sleep(100); }
  if (!hello.hello) {
    say("  the webview never ran a line of script, so nothing was painted to read");
    return false;
  }
  while (Date.now() < deadline) {
    try {
      await probe(panel, { op: "read", selector: "body" }, 5000);
      return true;
    } catch (e) {
      void e;
    }
  }
  say("  the webview ran the probe but never answered a message posted to it");
  return false;
}

async function shown(panel, selector) {
  const reply = await probe(panel, { op: "read", selector });
  return reply.texts.join("\n");
}

async function waitForShown(panel, selector, needle, timeoutMs, label) {
  let last = "";
  try {
    await waitFor(async () => {
      try {
        last = await shown(panel, selector);
      } catch (e) {
        void e;
        return false;
      }
      return last.includes(needle);
    }, timeoutMs, label);
  } catch (e) {
    say("  the webview's " + selector + " held: " + JSON.stringify(last.slice(0, 400)));
    throw e;
  }
  ok(true, label);
}

function recordStub(pid) {
  fs.appendFileSync(path.join(ROOT, "stub.pids"), String(pid) + "\n");
}

async function startStub() {
  stub = spawn(STUB, [], {
    cwd: WORKSPACE,
    env: Object.assign({}, process.env, { E2E_STUB_PORT: String(STUB_PORT) }),
    stdio: "ignore",
  });
  recordStub(stub.pid);
  await waitFor(() => portOpen(STUB_PORT), 15000, "the stub model to start serving");
}

function stopStub() {
  if (stub === null) { return; }
  try { stub.kill("SIGKILL"); } catch (e) { void e; }
  stub = null;
}

function real(p) {
  try { return fs.realpathSync(p); } catch (e) { void e; return p; }
}

async function openPanel() {
  const ext = vscode.extensions.getExtension("joule-sh.joule-editor");
  if (!ok(ext !== undefined, "the joule extension is present in this editor window")) {
    throw new Error("the extension is not installed in the window under test");
  }
  const api = await ext.activate();
  ok(ext.isActive === true, "the extension activated in a real editor window");
  const panel = api && api.panel ? api.panel : null;
  if (!ok(panel !== null, "activation handed back the chat panel")) {
    throw new Error("the extension exported no panel");
  }
  ok(panel.probing === true, "the panel is running in test mode, so its webview carries the probe script");
  const hello = watchForHello(panel);

  const folders = vscode.workspace.workspaceFolders || [];
  ok(folders.length === 1 && real(folders[0].uri.fsPath) === real(WORKSPACE),
    "the window has exactly the isolated test workspace open");

  for (const command of [expected().view + ".focus", expected().container]) {
    if (panel.view !== null) { break; }
    try {
      await vscode.commands.executeCommand(command);
    } catch (e) {
      say("  " + command + " did not run: " + (e && e.message ? e.message : e));
    }
    for (let i = 0; i < 100 && panel.view === null; i++) { await sleep(100); }
  }
  ok(panel.view !== null, "opening the joule view built the panel's webview");
  if (panel.view === null) { throw new Error("the joule view never resolved a webview"); }
  await assertPlacement(panel, ok, say);
  panel.view.show(true);
  ok(await webviewReady(panel, hello, 120000), "the panel's webview loaded its scripts and answers from the editor window");
  ok(panel.view.visible === true, "the joule view is the visible one in the " + expected().bar);
  return panel;
}

async function attachFromWebview(panel) {
  await waitForShown(panel, ".gate-text", "no joule daemon is running",
    30000, "the idle gate painting in the webview before anything is attached");
  const button = await shown(panel, ".gate button.primary");
  ok(button === "start a session", "the gate offers a start button, since no daemon owns this folder yet");

  const clicked = await probe(panel, { op: "click", selector: ".gate button.primary" });
  ok(clicked.ok === true, "the start button in the webview took a real click");

  try {
    await waitFor(() => panel.session !== null && panel.session.state === "attached",
      90000, "the panel to attach to a daemon");
  } catch (e) {
    say("  the panel's last state was: " + (panel.session ? panel.session.state + " / " + panel.session.detail : "no session"));
    throw e;
  }
  ok(panel.session.state === "attached", "clicking start in the webview started a daemon and attached to it");

  const records = daemonRecords();
  ok(records.length === 1, "exactly one daemon record exists for this workspace");
  ok(await portOpen(panel.session.port), "the daemon is listening on the port the panel reports");

  await waitForShown(panel, ".badge", "attached", 30000, "the webview badge showing the attached state");
  await waitForShown(panel, ".header-workspace", vscode.workspace.workspaceFolders[0].uri.fsPath, 15000,
    "the webview naming the workspace folder this window has open");
  await waitForShown(panel, ".header-meta", "stub-model", 30000,
    "session.hello reaching the webview, which paints the model it is driving");
}

async function runTurn(panel) {
  const composer = await probe(panel, { op: "read", selector: ".composer-input" });
  ok(composer.found === 1, "the attached webview renders a composer to type into");

  await probe(panel, { op: "fill", selector: ".composer-input", text: PROMPT, key: "Enter" });
  await waitForShown(panel, ".prompt-text", PROMPT, 20000,
    "the prompt typed into the webview appearing in its own transcript");

  await waitForShown(panel, ".text-body", "Let me check the README first.", 60000,
    "the first streamed model text painting in the webview, not just arriving as a frame");
  await waitForShown(panel, ".tool-name", "read", 60000,
    "the auto-approved read tool rendering in the webview");
  await waitForShown(panel, ".text-body", "No health route yet", 60000,
    "the second streamed text painting in the webview after a tool result");
}

async function approveFromWebview(panel) {
  await waitForShown(panel, ".approval-tool", "run", 60000,
    "a native approval card for the run tool rendering in the webview");

  const card = await shown(panel, ".approval");
  ok(card.includes(FIX_COMMAND), "the approval card shows the exact command, not a rendered summary line");

  await checks.approvalDesign(panel);

  const buttons = await probe(panel, { op: "read", selector: ".approval-button" });
  ok(buttons.found === 3, "the approval card offers three choices");
  ok(buttons.texts.includes("allow") && buttons.texts.includes("deny")
    && buttons.texts.some((t) => t.startsWith("always allow")),
    "the choices are allow, always-allow and deny, rendered as real buttons");

  const readme = path.join(WORKSPACE, "README.md");
  ok(!fs.readFileSync(readme, "utf8").includes(NOTE),
    "the workspace file does not carry the note before the approval is answered");

  const clicked = await probe(panel, { op: "click", selector: ".approval-button.approval-allow" });
  ok(clicked.ok === true, "the Allow button in the webview took a real click");

  await waitFor(() => fs.readFileSync(readme, "utf8").includes(NOTE), 60000,
    "the approved command to change the workspace file on disk");
  ok(fs.readFileSync(readme, "utf8").includes(NOTE),
    "approving in the webview ran the command against the real workspace on disk");

  const folder = vscode.workspace.workspaceFolders[0];
  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, "README.md"));
  ok(Buffer.from(bytes).toString("utf8").includes(NOTE),
    "the editor's own file system sees the change, so the effect landed in the folder this window has open");

  await waitForShown(panel, ".approval-state", "answered here: allow", 30000,
    "the webview recording that this window is the one that answered");
  await waitForShown(panel, ".tool-name", "run", 15000, "the approved run rendering as a tool call in the webview");

  await waitFor(() => panel.session.conversation.turnActive === false, 60000, "the turn to end");
  const ended = await probe(panel, { op: "read", selector: ".turn-end" });
  ok(ended.found >= 1, "the webview paints the end of the turn");

  const notices = await probe(panel, { op: "read", selector: ".notice-warn, .notice-error" });
  ok(notices.found === 0, "the webview showed no error or unknown-frame notice across the whole turn");
}

async function reapFromWindow(panel) {
  const port = panel.session.port;
  say("  joule --stop said: " + JSON.stringify(await panel.session.stopDaemon()));
  await waitFor(() => daemonRecords().length === 0, 60000, "the daemon record to disappear after a stop");
  ok(daemonRecords().length === 0, "stopping the daemon from the window removed its record");
  await waitFor(async () => !(await portOpen(port)), 60000, "the daemon port to close");
  ok(!(await portOpen(port)), "nothing is listening on the daemon port once the window has reaped it");
}

async function closeMidTurn(panel) {
  await probe(panel, { op: "fill", selector: ".composer-input", text: PROMPT, key: "Enter" });
  await waitFor(() => panel.session.conversation.pendingApproval() !== null, 90000,
    "the turn to reach an approval nobody has answered");
  const pending = await probe(panel, { op: "read", selector: ".approval-button" });
  ok(pending.found === 3, "the turn is parked on an approval the webview is showing");
  const pendingCallId = panel.session.conversation.pendingApproval().callId;

  const port = panel.session.port;
  const session = panel.session;
  panel.dispose();
  ok(session.link === null, "closing the panel tears down this window's connection to the daemon");
  ok(await portOpen(port), "the daemon outlives the window that started it, as it is meant to");
  ok(daemonRecords().length === 1,
    "closing the panel mid-turn left exactly one daemon, with no orphan started alongside it");

  await waitForShown(panel, ".gate-text", "a joule daemon is already running", 30000,
    "the closed panel offering to rejoin the session it walked out of");
  await probe(panel, { op: "click", selector: ".gate button.primary" });
  await waitFor(() => panel.session.state === "attached", 90000, "the panel to rejoin the daemon it left");
  ok(panel.session.port === port, "reopening the panel rejoined the same daemon rather than starting a second one");
  ok(panel.session.spawned === false, "the rejoining window attached to the running daemon instead of spawning one");
  ok(daemonRecords().length === 1, "still exactly one daemon once the panel is back");

  await waitFor(() => panel.session.conversation.pendingApproval() !== null, 60000,
    "the unanswered approval to come back with the panel");
  ok(panel.session.conversation.pendingApproval().callId === pendingCallId,
    "the approval the window walked out on is the one it is offered again");

  const readme = path.join(WORKSPACE, "README.md");
  const denied = await probe(panel, { op: "click", selector: ".approval-button.approval-deny" });
  ok(denied.ok === true, "the Deny button in the reopened webview took a real click");
  await waitFor(() => panel.session.conversation.turnActive === false, 60000, "the denied turn to end");
  ok(!fs.readFileSync(readme, "utf8").includes(NOTE),
    "denying from the webview left the workspace file untouched, so the approval is what decides");

  await reapFromWindow(panel);
}

async function dump(panel) {
  if (panel === null) { return; }
  if (panel.session !== null) {
    say("  panel state: " + panel.session.state + " / " + panel.session.detail);
    for (const item of panel.session.conversation.items) {
      const body = item.text || item.label || item.summary || item.output || "";
      say("  item " + item.kind + " " + (item.status || item.state || item.reason || "") + " " + JSON.stringify(String(body).slice(0, 160)));
    }
  }
  try {
    say("  webview body: " + JSON.stringify((await shown(panel, "#root")).slice(0, 1200)));
  } catch (e) {
    say("  webview body unreadable: " + (e && e.message ? e.message : e));
  }
}

async function drive() {
  let panel = null;
  try {
    panel = await openPanel();
    if (SCENARIO === "placement") { return; }
    if (SCENARIO === "first-run") {
      await checks.firstRunScreen(panel);
      return;
    }
    await startStub();
    await attachFromWebview(panel);
    if (SCENARIO === "close-mid-turn") {
      await closeMidTurn(panel);
      return;
    }
    await checks.composerControls(panel);
    await runTurn(panel);
    await approveFromWebview(panel);
    await checks.driveModeFromComposer(panel);
    await reapFromWindow(panel);
  } catch (e) {
    await dump(panel);
    throw e;
  }
}

async function run() {
  if (ROOT === "" || WORKSPACE === "" || STUB === "") {
    throw new Error("the editor window suite must be launched through scripts/editor_window/runner.mjs");
  }
  say("scenario: " + SCENARIO);
  try {
    await drive();
  } catch (e) {
    failures += 1;
    say("FAIL: " + (e && e.stack ? e.stack : e));
  } finally {
    stopStub();
  }
  if (failures > 0) {
    throw new Error(failures + " check(s) failed while driving the panel in a real editor window");
  }
  say("scenario " + SCENARIO + " drove the panel in a real editor window and reaped its daemon");
}

module.exports = { run };
