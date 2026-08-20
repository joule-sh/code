import { Session } from "../session/session.ts";
import { Gate, MODE_AUTO_EDIT } from "../approval/gate.ts";
import { Message, ProviderReply, Provider, ToolResult, ToolRegistry, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { RelayInputBridge, dispatchInboundFrame } from "./relay_bridge.ts";
import { PROTOCOL_VERSION, CANCEL, CancelFrame, encodeCancel, APPROVAL_REPLY, ApprovalReplyFrame, encodeApprovalReply } from "../protocol/frames.ts";

function okReply(text: string): ProviderReply {
  return { text: text, calls: [], failed: false, errorCode: "", errorMessage: "" };
}

function allowAll(): ApprovalGate {
  return { check: (callId: string, tool: string, summary: string): ApprovalDecision => {
    let d: ApprovalDecision = { allow: true };
    return d;
  } };
}

class Echoer {
  run(tool: string, args: string): ToolResult {
    let r: ToolResult = { ok: true, output: "", truncated: false };
    return r;
  }
}

class EchoProvider {
  ask(history: Message[], onDelta: (text: string) => void): ProviderReply {
    onDelta("ok");
    return okReply("ok");
  }
}

function newSession(provider: Provider): Session {
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  return new Session("/repo", "agent", provider, tools, allowAll());
}

test("dispatchInboundFrame calls session.cancel for a cancel frame", () => {
  let ep = new EchoProvider();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => ep.ask(h, d) };
  let session = newSession(provider);
  let gate = new Gate(MODE_AUTO_EDIT, 1000, (c: string, t: string, s: string) => {}, () => {});
  let bridge = new RelayInputBridge();

  let f: CancelFrame = { v: PROTOCOL_VERSION, seq: 1, type: CANCEL, turnId: "t9" };
  dispatchInboundFrame(session, gate, bridge, encodeCancel(f));
  expect(session.cancelledTurnId == "t9");
});

test("dispatchInboundFrame calls gate.reply for an approval.reply frame", () => {
  let ep = new EchoProvider();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => ep.ask(h, d) };
  let session = newSession(provider);
  let gate = new Gate(MODE_AUTO_EDIT, 1000, (c: string, t: string, s: string) => {}, () => {});
  let bridge = new RelayInputBridge();

  let f: ApprovalReplyFrame = { v: PROTOCOL_VERSION, seq: 1, type: APPROVAL_REPLY, callId: "c1", decision: "allow" };
  dispatchInboundFrame(session, gate, bridge, encodeApprovalReply(f));
  expect(gate.findReply("c1") == "allow");
});

test("dispatchInboundFrame ignores an unrecognized frame type without throwing", () => {
  let ep = new EchoProvider();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => ep.ask(h, d) };
  let session = newSession(provider);
  let gate = new Gate(MODE_AUTO_EDIT, 1000, (c: string, t: string, s: string) => {}, () => {});
  let bridge = new RelayInputBridge();
  dispatchInboundFrame(session, gate, bridge, "{\"v\":1,\"seq\":1,\"type\":\"text.delta\"}");
  expect(bridge.pending.length == 0);
});

test("RelayInputBridge.offer submits immediately when idle", () => {
  let ep = new EchoProvider();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => ep.ask(h, d) };
  let session = newSession(provider);
  let bridge = new RelayInputBridge();
  bridge.offer(session, "hello");
  expect(session.history.length == 3);
  expect(!bridge.busy);
});

class NestedOfferProvider {
  bridgeSlot: RelayInputBridge[];
  sessionSlot: Session[];
  seenSecondQueuedDuringFirst: bool;
  constructor() {
    this.bridgeSlot = [];
    this.sessionSlot = [];
    this.seenSecondQueuedDuringFirst = false;
  }
  ask(history: Message[], onDelta: (text: string) => void): ProviderReply {
    if (this.bridgeSlot.length > 0 && this.sessionSlot.length > 0 && history.length == 2) {
      this.bridgeSlot[0].offer(this.sessionSlot[0], "second");
      if (this.bridgeSlot[0].pending.length > 0) {
        this.seenSecondQueuedDuringFirst = true;
      }
    }
    onDelta("ok");
    return okReply("ok");
  }
}

test("an input frame arriving mid-turn is queued, not submitted reentrantly", () => {
  let np = new NestedOfferProvider();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => np.ask(h, d) };
  let session = newSession(provider);
  let bridge = new RelayInputBridge();
  np.bridgeSlot = [bridge];
  np.sessionSlot = [session];

  bridge.offer(session, "first");

  expect(np.seenSecondQueuedDuringFirst);
  expect(!bridge.busy);
  expect(bridge.pending.length == 0);
  expect(session.history.length == 5);
  expect(session.history[3].text == "second");
});
