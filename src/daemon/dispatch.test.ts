import { Session } from "../session/session.ts";
import { Gate, MODE_AUTO_EDIT } from "../approval/gate.ts";
import { Message, ProviderReply, Provider, ToolResult, ToolRegistry, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { LiveProvider, CancelWatch, TurnTracker } from "../providers/live.ts";
import { ProviderConfig } from "../providers/openai.ts";
import { TaskManager } from "../tasks/manager.ts";
import { RelayInputBridge } from "../terminal/relay_bridge.ts";
import { dispatchDaemonFrame } from "./dispatch.ts";
import { PROTOCOL_VERSION, frameType, DaemonStopFrame, encodeDaemonStop, DAEMON_STOPPING, decodeDaemonStopping } from "../protocol/frames.ts";

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

function newSession(): Session {
  let ep = new EchoProvider();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => ep.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  return new Session("/repo", "agent", provider, tools, allowAll());
}

function newGate(): Gate {
  return new Gate(MODE_AUTO_EDIT, 1000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
}

function newLive(): LiveProvider {
  let cfg: ProviderConfig = { baseUrl: "http://x", model: "start-model", apiKey: "k" };
  return new LiveProvider(cfg, [], new CancelWatch(), -1, new TurnTracker());
}

function newTasks(): TaskManager {
  return new TaskManager("/repo", { baseUrl: "http://x", model: "start-model", apiKey: "k" }, () => "auto-edit");
}

class FrameCapture {
  frames: string[];
  constructor() { this.frames = []; }
  add(frameJson: string): void { this.frames.push(frameJson); }
}

function lastFrame(cap: FrameCapture): string {
  return cap.frames[cap.frames.length - 1];
}

test("a daemon.stop frame broadcasts daemon.stopping and asks the caller to stop", () => {
  let session = newSession();
  let gate = newGate();
  let live = newLive();
  let tasks = newTasks();
  let bridge = new RelayInputBridge();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: DaemonStopFrame = { v: PROTOCOL_VERSION, seq: 0, type: "daemon.stop" };
  let stop = dispatchDaemonFrame(session, gate, live, tasks, bridge, encodeDaemonStop(f));

  expect(stop);
  expect(frameType(lastFrame(cap)) == DAEMON_STOPPING);
  let stopping = decodeDaemonStopping(lastFrame(cap));
  expect(stopping != null);
  if (stopping != null) { expect(stopping.reason != ""); }
});

test("input and cancel frames still fall through to the shared relay dispatch, without asking for a stop", () => {
  let session = newSession();
  let gate = newGate();
  let live = newLive();
  let tasks = newTasks();
  let bridge = new RelayInputBridge();

  let f = "{\"v\":1,\"seq\":0,\"type\":\"cancel\",\"turnId\":\"t7\"}";
  let stop = dispatchDaemonFrame(session, gate, live, tasks, bridge, f);

  expect(!stop);
  expect(session.cancelledTurnId == "t7");
});
