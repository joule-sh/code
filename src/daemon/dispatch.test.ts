import { Session } from "../session/session.ts";
import { Gate, MODE_AUTO_EDIT } from "../approval/gate.ts";
import { Message, ProviderReply, Provider, ToolResult, ToolRegistry, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { LiveProvider, CancelWatch, TurnTracker } from "../providers/live.ts";
import { ProviderConfig } from "../providers/openai.ts";
import { TaskManager } from "../tasks/manager.ts";
import { RelayInputBridge } from "../terminal/relay_bridge.ts";
import { ShareController, ShareResult } from "./share_controller.ts";
import { dispatchDaemonFrame } from "./dispatch.ts";
import { PROTOCOL_VERSION, frameType, DaemonStopFrame, encodeDaemonStop, DAEMON_STOPPING, decodeDaemonStopping, ShareRequestFrame, encodeShareRequest, SHARE_STARTED, SHARE_FAILED, APPROVAL_REPLY, APPROVAL_REPLY_RESULT, ApprovalReplyFrame, encodeApprovalReply, decodeApprovalReplyResult } from "../protocol/frames.ts";

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

function fakeUplink(): ShareController {
  return {
    ensureStarted: (workspaceRoot: string, model: string) => {
      let r: ShareResult = { ok: true, code: "ABCDEF", url: "https://joule.sh/w/ABCDEF", error: "" };
      return r;
    },
    tick: (session: Session, gate: Gate, bridge: RelayInputBridge) => {},
  };
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
  let uplink = fakeUplink();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: DaemonStopFrame = { v: PROTOCOL_VERSION, seq: 0, type: "daemon.stop" };
  let stop = dispatchDaemonFrame(session, gate, live, tasks, bridge, uplink, encodeDaemonStop(f));

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
  let uplink = fakeUplink();

  let f = "{\"v\":1,\"seq\":0,\"type\":\"cancel\",\"turnId\":\"t7\"}";
  let stop = dispatchDaemonFrame(session, gate, live, tasks, bridge, uplink, f);

  expect(!stop);
  expect(session.cancelledTurnId == "t7");
});

function replyFrame(callId: string, decision: string): string {
  let f: ApprovalReplyFrame = { v: PROTOCOL_VERSION, seq: 0, type: APPROVAL_REPLY, callId: callId, decision: decision };
  return encodeApprovalReply(f);
}

function replyResults(cap: FrameCapture): string[] {
  let out: string[] = [];
  let i = 0;
  while (i < cap.frames.length) {
    if (frameType(cap.frames[i]) == APPROVAL_REPLY_RESULT) { out.push(cap.frames[i]); }
    i = i + 1;
  }
  return out;
}

test("the first answer to an approval is broadcast as applied, so every attached client can clear the prompt", () => {
  let session = newSession();
  let gate = newGate();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  dispatchDaemonFrame(session, gate, newLive(), newTasks(), new RelayInputBridge(), fakeUplink(), replyFrame("c1", "deny"));

  let results = replyResults(cap);
  expect(results.length == 1);
  let decoded = decodeApprovalReplyResult(results[0]);
  expect(decoded != null);
  if (decoded != null) {
    expect(decoded.applied);
    expect(decoded.callId == "c1");
    expect(decoded.decision == "deny");
  }
});

test("a second answer to the same approval is broadcast as not applied, naming the decision that won", () => {
  let session = newSession();
  let gate = newGate();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  dispatchDaemonFrame(session, gate, newLive(), newTasks(), new RelayInputBridge(), fakeUplink(), replyFrame("c1", "allow"));
  dispatchDaemonFrame(session, gate, newLive(), newTasks(), new RelayInputBridge(), fakeUplink(), replyFrame("c1", "deny"));

  let results = replyResults(cap);
  expect(results.length == 2);
  let second = decodeApprovalReplyResult(results[1]);
  expect(second != null);
  if (second != null) {
    expect(!second.applied);
    expect(second.decision == "allow");
  }
  expect(gate.findReply("c1") == "allow");
});

test("a share.request frame with a working uplink answers share.started", () => {
  let session = newSession();
  let gate = newGate();
  let live = newLive();
  let tasks = newTasks();
  let bridge = new RelayInputBridge();
  let uplink = fakeUplink();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: ShareRequestFrame = { v: PROTOCOL_VERSION, seq: 0, type: "share.request" };
  let stop = dispatchDaemonFrame(session, gate, live, tasks, bridge, uplink, encodeShareRequest(f));

  expect(!stop);
  expect(frameType(lastFrame(cap)) == SHARE_STARTED);
});

test("a share.request frame with no uplink answers share.failed rather than a stop", () => {
  let session = newSession();
  let gate = newGate();
  let live = newLive();
  let tasks = newTasks();
  let bridge = new RelayInputBridge();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: ShareRequestFrame = { v: PROTOCOL_VERSION, seq: 0, type: "share.request" };
  let stop = dispatchDaemonFrame(session, gate, live, tasks, bridge, null, encodeShareRequest(f));

  expect(!stop);
  expect(frameType(lastFrame(cap)) == SHARE_FAILED);
});
