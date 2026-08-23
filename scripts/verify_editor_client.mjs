import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect } from "./miniws.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JOULE = path.join(REPO_ROOT, "bin", "joule");
const STUB = path.join(REPO_ROOT, "bin", "stub_model");

const editorSrc = (name) => pathToFileURL(path.join(REPO_ROOT, "editor", "src", name)).href;
const { EditorSession } = (await import(editorSrc("session.js"))).default;
const frames = (await import(editorSrc("frames.js"))).default;

let failures = 0;
const cleanups = [];

function ok(cond, label) {
  if (cond) {
    console.log("ok: " + label);
    return;
  }
  console.error("FAIL: " + label);
  failures += 1;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) { return true; }
    await sleep(25);
  }
  throw new Error("timed out waiting for " + label);
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

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection(port, "127.0.0.1");
    sock.once("connect", () => { sock.end(); resolve(true); });
    sock.once("error", () => resolve(false));
  });
}

async function makeWorkspace(name) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "joule-editor-" + name + "-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "joule-editor-home-" + name + "-"));
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n");
  const stubPort = await freePort();
  const stub = spawn(STUB, [], {
    cwd: workspace,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "ignore",
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    up = await portOpen(stubPort);
    if (!up) { await sleep(50); }
  }
  ok(up, name + ": stub model came up");
  const env = {
    ...process.env,
    HOME: home,
    JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
    JOULE_CODE_MODEL: "stub-model",
    JOULE_CODE_API_KEY: "test-key",
  };
  let disposed = false;
  const dispose = () => {
    if (disposed) { return; }
    disposed = true;
    try { execFileSync(JOULE, ["--stop"], { cwd: workspace, env, timeout: 20000, stdio: "ignore" }); } catch (e) { void e; }
    stub.kill();
    if (!process.env.DEBUG_KEEP) {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  };
  cleanups.push(dispose);
  return { workspace, home, env, stub, dispose };
}

async function attachEditor(ws, name) {
  const session = new EditorSession({
    workspaceRoot: ws.workspace,
    jouleBin: JOULE,
    env: ws.env,
    connId: crypto.randomBytes(8).toString("hex"),
  });
  await session.attach({});
  ok(session.state === "attached", name + ": the editor client attached to a daemon");
  if (session.state !== "attached") { throw new Error(name + ": attach failed: " + session.detail); }
  await waitFor(() => session.conversation.session !== null, 8000, name + ": session.hello");
  return session;
}

async function attachPeer(port, name) {
  const id = crypto.randomBytes(8).toString("hex");
  const conn = await connect("127.0.0.1", port, `/attach/${id}/ws`, {});
  const seen = [];
  conn.onMessage((text) => seen.push(JSON.parse(text)));
  conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  await sleep(200);
  return { conn, seen, id };
}

function pendingApproval(session) {
  return session.conversation.pendingApproval();
}

async function scenarioApproveInEditor() {
  const name = "approve-in-editor";
  const ws = await makeWorkspace("a");
  try {
    await approveInEditorBody(name, ws);
  } finally {
    ws.dispose();
  }
}

async function approveInEditorBody(name, ws) {
  const session = await attachEditor(ws, name);
  const peer = await attachPeer(session.port, name);

  ok(session.conversation.session.workspace === ws.workspace, name + ": session.hello names the workspace the daemon owns");

  session.submit("fix the health route");

  await waitFor(() => pendingApproval(session) !== null, 15000, name + ": an approval reaching the editor");
  await waitFor(() => peer.seen.some((f) => f.type === "approval.request"), 15000, name + ": the same approval reaching a second client");

  const item = pendingApproval(session);
  ok(item.tool === "run", name + ": the editor holds a native pending approval for the run tool");
  ok(item.label.includes("Added a health check note."), name + ": the approval carries the exact command, not a rendered line");

  const peerReq = peer.seen.find((f) => f.type === "approval.request");
  ok(peerReq.callId === item.callId, name + ": both clients are looking at the same call id");

  session.answer(item.callId, "allow");

  await waitFor(() => session.conversation.items.some((i) => i.kind === "tool" && i.callId === item.callId && i.status === "ok"), 15000, name + ": the approved run reporting ok in the editor");
  await waitFor(() => !session.conversation.turnActive, 15000, name + ": the turn ending in the editor");

  const resolved = session.conversation.approvalItem(item.callId);
  ok(resolved.state === "resolved" && resolved.resolvedBy === "here" && resolved.decision === "allow", name + ": the editor records that it answered the approval itself");
  ok(session.conversation.pendingApprovalId === "", name + ": the editor's approval prompt cleared");

  const readme = fs.readFileSync(path.join(ws.workspace, "README.md"), "utf8");
  ok(readme.includes("Added a health check note."), name + ": the tool ran on the machine holding the workspace, not in the editor process");

  const editorText = session.conversation.items.filter((i) => i.kind === "text").map((i) => i.text).join("");
  ok(editorText.includes("No health route yet"), name + ": streamed model text landed in the editor transcript");

  peer.conn.send(JSON.stringify({ v: 1, seq: 0, type: "mode.set", mode: "full-auto" }));
  await waitFor(() => session.conversation.session.mode === "full-auto", 15000, name + ": a mode change made elsewhere reaching the editor");
  ok(session.conversation.session.mode === "full-auto", name + ": the editor tracks a mode change another client made");

  const warnings = session.conversation.items.filter((i) => i.kind === "notice" && String(i.text).includes("unrecognised"));
  ok(warnings.length === 0, name + ": the editor recognised every frame the daemon broadcast, with no unknown-frame warnings");

  peer.conn.close();
  session.detach();
}

async function scenarioApprovalRace() {
  const name = "approval-race";
  const ws = await makeWorkspace("b");
  try {
    await approvalRaceBody(name, ws);
  } finally {
    ws.dispose();
  }
}

async function approvalRaceBody(name, ws) {
  const session = await attachEditor(ws, name);
  const peer = await attachPeer(session.port, name);

  session.submit("fix the health route");
  await waitFor(() => pendingApproval(session) !== null, 15000, name + ": an approval reaching the editor");
  const item = pendingApproval(session);

  peer.conn.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId: item.callId, decision: "allow" }));

  await waitFor(() => session.conversation.pendingApprovalId === "", 15000, name + ": the editor's prompt clearing when the other client answered first");

  const resolved = session.conversation.approvalItem(item.callId);
  ok(resolved.state === "resolved", name + ": the approval is resolved in the editor without the editor answering");
  ok(resolved.resolvedBy === "elsewhere", name + ": the editor says the approval was answered elsewhere");
  ok(resolved.decision === "allow", name + ": the editor shows the decision that actually won");

  ok(session.conversation.answer(item.callId, "deny") === null, name + ": the editor refuses to send a second answer for a resolved approval");
  const afterLocal = session.conversation.approvalItem(item.callId);
  ok(afterLocal.decision === "allow", name + ": a late click in the editor does not overwrite the winning decision");

  const before = peer.seen.length;
  session.link.send(frames.encodeApprovalReplyFrame(item.callId, "deny"));
  await waitFor(() => peer.seen.slice(before).some((f) => f.type === "approval.reply.result" && f.applied === false && f.callId === item.callId), 15000, name + ": a losing reply on the wire being refused and reported");
  const refusal = peer.seen.slice(before).find((f) => f.type === "approval.reply.result" && f.applied === false);
  ok(refusal.decision === "allow", name + ": the refusal names the decision that won, so the loser is told what happened");

  await waitFor(() => !session.conversation.turnActive, 15000, name + ": the turn ending after the cross-client approval");
  ok(fs.readFileSync(path.join(ws.workspace, "README.md"), "utf8").includes("Added a health check note."), name + ": the winning decision is the one that executed");

  peer.conn.close();
  session.detach();
}

async function scenarioCloseMidTurn() {
  const name = "close-mid-turn";
  const ws = await makeWorkspace("c");
  try {
    await closeMidTurnBody(name, ws);
  } finally {
    ws.dispose();
  }
}

async function closeMidTurnBody(name, ws) {
  const session = await attachEditor(ws, name);
  const peer = await attachPeer(session.port, name);
  const port = session.port;

  session.submit("fix the health route");
  await waitFor(() => pendingApproval(session) !== null, 15000, name + ": an approval reaching the editor");
  const item = pendingApproval(session);

  session.detach();
  ok(session.link === null, name + ": closing the editor tears down its own connection");

  ok(await portOpen(port), name + ": the daemon is still listening after the editor closed mid-turn");

  peer.conn.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId: item.callId, decision: "allow" }));
  await waitFor(() => peer.seen.some((f) => f.type === "turn.end"), 20000, name + ": the turn finishing after the editor left");
  ok(fs.readFileSync(path.join(ws.workspace, "README.md"), "utf8").includes("Added a health check note."), name + ": the in-flight turn completed on the daemon, not in the editor");

  const infoDir = path.join(ws.home, ".config", "joule-code", "daemon");
  const infoFiles = fs.readdirSync(infoDir).filter((f) => f.endsWith(".json"));
  ok(infoFiles.length === 1, name + ": exactly one daemon record exists for this workspace, so no second daemon was started");

  peer.conn.close();
  execFileSync(JOULE, ["--stop"], { cwd: ws.workspace, env: ws.env, timeout: 20000 });
  let gone = false;
  for (let i = 0; i < 100 && !gone; i++) {
    gone = fs.readdirSync(infoDir).filter((f) => f.endsWith(".json")).length === 0;
    if (!gone) { await sleep(100); }
  }
  ok(gone, name + ": stopping the daemon removes its record, leaving no orphaned state");
}

async function scenarioOneDaemonPerFolder() {
  const name = "one-daemon-per-folder";
  const ws = await makeWorkspace("d");
  try {
    await oneDaemonPerFolderBody(name, ws);
  } finally {
    ws.dispose();
  }
}

async function oneDaemonPerFolderBody(name, ws) {
  const first = await attachEditor(ws, name);
  ok(first.spawned === true, name + ": the first editor window started the folder's daemon");
  const second = await attachEditor(ws, name + " (second window)");
  ok(first.port === second.port, name + ": a second editor window for the same folder attaches to the same daemon");
  ok(second.spawned === false, name + ": the second window attached rather than starting a daemon of its own");

  const infoDir = path.join(ws.home, ".config", "joule-code", "daemon");
  const infoFiles = fs.readdirSync(infoDir).filter((f) => f.endsWith(".json"));
  ok(infoFiles.length === 1, name + ": only one daemon record exists for the folder");

  first.detach();
  second.detach();
}

async function main() {
  try {
    await scenarioApproveInEditor();
    await scenarioApprovalRace();
    await scenarioCloseMidTurn();
    await scenarioOneDaemonPerFolder();
  } finally {
    for (const fn of cleanups) { fn(); }
  }
  if (failures > 0) {
    console.error(`FAIL: ${failures} check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log("PASS: the editor client drove a daemon session, approved natively, shared it with a second client, and left nothing behind");
}

main().catch((e) => {
  console.error("FAIL:", e);
  for (const fn of cleanups) { fn(); }
  process.exitCode = 1;
});
