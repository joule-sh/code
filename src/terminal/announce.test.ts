import { Session } from "../session/session.ts";
import { Gate, MODE_AUTO_EDIT, MODE_FULL_AUTO } from "../approval/gate.ts";
import { Message, ProviderReply, Provider, ToolResult, ToolRegistry, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { decodeSessionHello, decodeModeChanged, decodeModelChanged, MODE_CHANGED, MODEL_CHANGED } from "../protocol/frames.ts";
import { shareHello, announceMode, announceModel } from "./announce.ts";

class Sink {
  frames: string[];
  constructor() { this.frames = []; }
  add(frameJson: string): void { this.frames.push(frameJson); }
}

function newSession(): Session {
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => {
    let r: ProviderReply = { text: "", calls: [], failed: false, errorCode: "", errorMessage: "", tokens: 0 };
    return r;
  } };
  let tools: ToolRegistry = { run: (t: string, a: string) => {
    let r: ToolResult = { ok: true, output: "", truncated: false };
    return r;
  } };
  let approval: ApprovalGate = { check: (c: string, t: string, s: string, a: string) => {
    let d: ApprovalDecision = { allow: true };
    return d;
  } };
  return new Session("/repo", "agent", provider, tools, approval);
}

test("the shared hello carries the gate's approval mode, never the session kind", () => {
  let session = newSession();
  let gate = new Gate(MODE_AUTO_EDIT, 1000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  let hello = decodeSessionHello(shareHello(session, "sess-1", "/repo", "", "deepseek/deepseek-chat", gate.mode));
  expect(hello != null);
  if (hello != null) {
    expect(hello.mode == MODE_AUTO_EDIT);
    expect(hello.mode != session.mode);
    expect(hello.model == "deepseek/deepseek-chat");
    expect(hello.sessionId == "sess-1");
  }
});

test("the shared hello carries the workspace multi-session name, distinct from the relay's own sessionId", () => {
  let session = newSession();
  let gate = new Gate(MODE_AUTO_EDIT, 1000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  let hello = decodeSessionHello(shareHello(session, "sess-1", "/repo", "review", "deepseek/deepseek-chat", gate.mode));
  expect(hello != null);
  if (hello != null) {
    expect(hello.session == "review");
    expect(hello.sessionId == "sess-1");
  }
});

test("announceMode emits a mode.changed a watcher can read", () => {
  let session = newSession();
  let sink = new Sink();
  session.subscribe((f: string) => sink.add(f));
  announceMode(session, MODE_FULL_AUTO);
  expect(sink.frames.length == 1);
  let changed = decodeModeChanged(sink.frames[0]);
  expect(changed != null);
  if (changed != null) {
    expect(changed.type == MODE_CHANGED);
    expect(changed.mode == MODE_FULL_AUTO);
    expect(changed.seq > 0);
  }
});

test("announceModel emits a model.changed a watcher can read", () => {
  let session = newSession();
  let sink = new Sink();
  session.subscribe((f: string) => sink.add(f));
  announceModel(session, "deepseek/deepseek-reasoner");
  expect(sink.frames.length == 1);
  let changed = decodeModelChanged(sink.frames[0]);
  expect(changed != null);
  if (changed != null) {
    expect(changed.type == MODEL_CHANGED);
    expect(changed.model == "deepseek/deepseek-reasoner");
  }
});
