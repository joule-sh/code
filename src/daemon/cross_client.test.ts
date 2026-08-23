import { Session } from "../session/session.ts";
import { Gate, MODE_AUTO_EDIT } from "../approval/gate.ts";
import { Message, ProviderReply, Provider, ToolResult, ToolRegistry, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { LiveProvider, CancelWatch, TurnTracker } from "../providers/live.ts";
import { ProviderConfig } from "../providers/openai.ts";
import { TaskManager } from "../tasks/manager.ts";
import { RelayInputBridge } from "../terminal/relay_bridge.ts";
import { dispatchDaemonFrame } from "./dispatch.ts";
import { appendBroadcast, newBroadcastReader } from "./broadcast.ts";
import { PROTOCOL_VERSION, ModeSetFrame, encodeModeSet, MODEL_CHANGED, ModelSetFrame, encodeModelSet, MODE_CHANGED, frameType, decodeModeChanged, decodeModelChanged } from "../protocol/frames.ts";

class Echoer {
  run(tool: string, args: string): ToolResult {
    let r: ToolResult = { ok: true, output: "", truncated: false };
    return r;
  }
}

class EchoProvider {
  ask(history: Message[], onDelta: (text: string) => void): ProviderReply {
    let r: ProviderReply = { text: "ok", calls: [], failed: false, errorCode: "", errorMessage: "", tokens: 0 };
    return r;
  }
}

function allowAll(): ApprovalGate {
  return { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    let d: ApprovalDecision = { allow: true };
    return d;
  } };
}

function freshRuntimeDir(name: string): string {
  let dir = "/tmp/daemon-cross-client-test-" + name;
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(dir, true);
  return dir;
}

function newDaemonWiredSession(runtimeDir: string): Session {
  let ep = new EchoProvider();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => ep.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let session = new Session("/repo", "agent", provider, tools, allowAll());
  session.subscribe((frameJson: string) => { appendBroadcast(runtimeDir, frameJson); });
  return session;
}

function newGate(): Gate {
  return new Gate(MODE_AUTO_EDIT, 1000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
}

function newLive(): LiveProvider {
  let cfg: ProviderConfig = { baseUrl: "http://x", model: "start-model", apiKey: "k" };
  return new LiveProvider(cfg, [], new CancelWatch(), -1, new TurnTracker());
}

function newTasks(): TaskManager {
  let cfg: ProviderConfig = { baseUrl: "http://x", model: "start-model", apiKey: "k" };
  return new TaskManager("/repo", cfg, () => "auto-edit");
}

test("a mode.set dispatched on the daemon's session reaches two independent broadcast readers, the same mechanism two attached clients' pusher threads use", () => {
  let dir = freshRuntimeDir("mode");
  let session = newDaemonWiredSession(dir);
  let gate = newGate();
  let live = newLive();
  let tasks = newTasks();
  let bridge = new RelayInputBridge();

  let readerForClientA = newBroadcastReader(dir);
  let readerForClientB = newBroadcastReader(dir);

  let f: ModeSetFrame = { v: PROTOCOL_VERSION, seq: 0, type: "mode.set", mode: "full-auto" };
  dispatchDaemonFrame(session, gate, live, tasks, bridge, encodeModeSet(f));

  let seenByA = readerForClientA.drainNew();
  let seenByB = readerForClientB.drainNew();
  expect(seenByA.length == 1);
  expect(seenByB.length == 1);
  expect(frameType(seenByA[0].payload) == MODE_CHANGED);
  expect(frameType(seenByB[0].payload) == MODE_CHANGED);
  let decodedA = decodeModeChanged(seenByA[0].payload);
  let decodedB = decodeModeChanged(seenByB[0].payload);
  expect(decodedA != null);
  expect(decodedB != null);
  if (decodedA != null) { expect(decodedA.mode == "full-auto"); }
  if (decodedB != null) { expect(decodedB.mode == "full-auto"); }
});

test("a model.set dispatched on the daemon's session reaches a broadcast reader that only joined afterward, the same way a client resuming from an earlier seq does", () => {
  let dir = freshRuntimeDir("model");
  let session = newDaemonWiredSession(dir);
  let gate = newGate();
  let live = newLive();
  let tasks = newTasks();
  let bridge = new RelayInputBridge();

  let f: ModelSetFrame = { v: PROTOCOL_VERSION, seq: 0, type: "model.set", model: "shared-model" };
  dispatchDaemonFrame(session, gate, live, tasks, bridge, encodeModelSet(f));

  let lateJoiningReader = newBroadcastReader(dir);
  let seen = lateJoiningReader.drainNew();
  expect(seen.length == 1);
  expect(frameType(seen[0].payload) == MODEL_CHANGED);
  let decoded = decodeModelChanged(seen[0].payload);
  expect(decoded != null);
  if (decoded != null) { expect(decoded.model == "shared-model"); }
});
