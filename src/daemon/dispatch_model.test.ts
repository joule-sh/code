import { Session } from "../session/session.ts";
import { Message, ProviderReply, Provider, ToolResult, ToolRegistry, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { LiveProvider, CancelWatch, TurnTracker } from "../providers/live.ts";
import { ProviderConfig } from "../providers/openai.ts";
import { handleModelSet } from "./dispatch_model.ts";
import { PROTOCOL_VERSION, ModelSetFrame, encodeModelSet, MODEL_CHANGED, decodeModelChanged, frameType } from "../protocol/frames.ts";

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

function newLive(): LiveProvider {
  let cfg: ProviderConfig = { baseUrl: "http://x", model: "start-model", apiKey: "k" };
  return new LiveProvider(cfg, [], new CancelWatch(), -1, new TurnTracker());
}

class FrameCapture {
  frames: string[];
  constructor() { this.frames = []; }
  add(frameJson: string): void { this.frames.push(frameJson); }
}

function lastFrame(cap: FrameCapture): string {
  return cap.frames[cap.frames.length - 1];
}

test("a model.set frame updates the live provider's model and broadcasts model.changed", () => {
  let session = newSession();
  let live = newLive();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: ModelSetFrame = { v: PROTOCOL_VERSION, seq: 0, type: "model.set", model: "new-model" };
  handleModelSet(session, live, encodeModelSet(f));

  expect(live.cfg.model == "new-model");
  expect(live.cfg.baseUrl == "http://x");
  expect(frameType(lastFrame(cap)) == MODEL_CHANGED);
  let changed = decodeModelChanged(lastFrame(cap));
  expect(changed != null);
  if (changed != null) { expect(changed.model == "new-model"); }
});

test("a model.set frame with an empty model is ignored", () => {
  let session = newSession();
  let live = newLive();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: ModelSetFrame = { v: PROTOCOL_VERSION, seq: 0, type: "model.set", model: "" };
  handleModelSet(session, live, encodeModelSet(f));

  expect(live.cfg.model == "start-model");
  expect(cap.frames.length == 0);
});
