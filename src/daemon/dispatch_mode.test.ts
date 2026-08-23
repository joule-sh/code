import { Session } from "../session/session.ts";
import { Gate, MODE_AUTO_EDIT, MODE_PLAN } from "../approval/gate.ts";
import { Message, ProviderReply, Provider, ToolResult, ToolRegistry, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { handleModeSet } from "./dispatch_mode.ts";
import { PROTOCOL_VERSION, ModeSetFrame, encodeModeSet, MODE_CHANGED, decodeModeChanged, ERROR, decodeError, frameType } from "../protocol/frames.ts";
import { PLAN_MODE_BRIEFING } from "../approval/plan_briefing.ts";

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

class FrameCapture {
  frames: string[];
  constructor() { this.frames = []; }
  add(frameJson: string): void { this.frames.push(frameJson); }
}

function lastFrame(cap: FrameCapture): string {
  return cap.frames[cap.frames.length - 1];
}

test("a valid mode.set frame updates the gate's mode and broadcasts mode.changed", () => {
  let session = newSession();
  let gate = newGate();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: ModeSetFrame = { v: PROTOCOL_VERSION, seq: 0, type: "mode.set", mode: "full-auto" };
  handleModeSet(session, gate, encodeModeSet(f));

  expect(gate.mode == "full-auto");
  expect(frameType(lastFrame(cap)) == MODE_CHANGED);
  let changed = decodeModeChanged(lastFrame(cap));
  expect(changed != null);
  if (changed != null) { expect(changed.mode == "full-auto"); }
});

test("an invalid mode.set frame is rejected with an error frame, and the mode is unchanged", () => {
  let session = newSession();
  let gate = newGate();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: ModeSetFrame = { v: PROTOCOL_VERSION, seq: 0, type: "mode.set", mode: "not-a-real-mode" };
  handleModeSet(session, gate, encodeModeSet(f));

  expect(gate.mode == MODE_AUTO_EDIT);
  expect(frameType(lastFrame(cap)) == ERROR);
  let err = decodeError(lastFrame(cap));
  expect(err != null);
  if (err != null) { expect(err.code == "mode.invalid"); }
});

test("transitioning into plan mode injects the plan briefing as system context", () => {
  let session = newSession();
  let gate = newGate();
  let before = session.history.length;

  let f: ModeSetFrame = { v: PROTOCOL_VERSION, seq: 0, type: "mode.set", mode: MODE_PLAN };
  handleModeSet(session, gate, encodeModeSet(f));

  expect(gate.mode == MODE_PLAN);
  expect(session.history.length == before + 1);
  let injected = session.history[session.history.length - 1];
  expect(injected.text == PLAN_MODE_BRIEFING);
});

test("setting plan mode while already in plan mode does not inject the briefing again", () => {
  let session = newSession();
  let gate = newGate();
  gate.mode = MODE_PLAN;
  let before = session.history.length;

  let f: ModeSetFrame = { v: PROTOCOL_VERSION, seq: 0, type: "mode.set", mode: MODE_PLAN };
  handleModeSet(session, gate, encodeModeSet(f));

  expect(session.history.length == before);
});
