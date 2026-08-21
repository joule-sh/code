import { PROTOCOL_VERSION, TEXT_DELTA, TOOL_RESULT, TextDeltaFrame, ToolResultFrame, encodeTextDelta, encodeToolResult } from "../protocol/frames.ts";
import { ApprovalResponder } from "../tasks/types.ts";
import { Scrollback } from "./input_state.ts";
import { isTaskTurnId, appendTaggedFrame, tryHandleAgentApprovalChar, cancelCommandArg } from "./tasks_bridge.ts";

function lastLine(sb: Scrollback): string {
  let t = sb.tail(5);
  return t[t.length - 1];
}

test("isTaskTurnId recognizes bg: and agent: prefixes only", () => {
  expect(isTaskTurnId("bg:bgrun-1"));
  expect(isTaskTurnId("agent:agent-1"));
  expect(!isTaskTurnId("t1"));
  expect(!isTaskTurnId(""));
  expect(!isTaskTurnId("bgrun-1"));
});

test("appendTaggedFrame prefixes a background text.delta with [task <id>]", () => {
  let sb = new Scrollback();
  let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: 1, type: TEXT_DELTA, turnId: "bg:bgrun-1", text: "building..." };
  appendTaggedFrame(sb, encodeTextDelta(f));
  let joined = lastLine(sb);
  expect(joined.indexOf("[task bgrun-1]") >= 0);
  expect(joined.indexOf("building...") >= 0);
});

test("appendTaggedFrame prefixes a subagent tool.result with [agent <id>]", () => {
  let sb = new Scrollback();
  let f: ToolResultFrame = { v: PROTOCOL_VERSION, seq: 1, type: TOOL_RESULT, turnId: "agent:agent-1", callId: "agent-1:1", ok: true, output: "done", truncated: false };
  appendTaggedFrame(sb, encodeToolResult(f));
  let joined = lastLine(sb);
  expect(joined.indexOf("[agent agent-1]") >= 0);
});

test("appendTaggedFrame on a foreground frame (no bg:/agent: turnId) still renders, untagged", () => {
  let sb = new Scrollback();
  let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: 1, type: TEXT_DELTA, turnId: "t1", text: "hello" };
  appendTaggedFrame(sb, encodeTextDelta(f));
  let joined = lastLine(sb);
  expect(joined.indexOf("hello") >= 0);
  expect(joined.indexOf("[task") < 0);
  expect(joined.indexOf("[agent") < 0);
});

class FakeApprovals {
  pending: bool;
  lastDecision: string;
  constructor(pending: bool) { this.pending = pending; this.lastDecision = ""; }
  hasPendingApproval(): bool { return this.pending; }
  answerActiveApproval(decision: string): void { this.lastDecision = decision; this.pending = false; }
}

test("tryHandleAgentApprovalChar consumes y/n/a only when input is empty and an approval is pending", () => {
  let fake = new FakeApprovals(true);
  let responder: ApprovalResponder = { hasPendingApproval: () => fake.hasPendingApproval(), answerActiveApproval: (d: string) => fake.answerActiveApproval(d) };
  let consumed = tryHandleAgentApprovalChar(responder, true, "y");
  expect(consumed);
  expect(fake.lastDecision == "allow");
});

test("tryHandleAgentApprovalChar does not consume when input is not empty", () => {
  let fake = new FakeApprovals(true);
  let responder: ApprovalResponder = { hasPendingApproval: () => fake.hasPendingApproval(), answerActiveApproval: (d: string) => fake.answerActiveApproval(d) };
  let consumed = tryHandleAgentApprovalChar(responder, false, "y");
  expect(!consumed);
  expect(fake.lastDecision == "");
});

test("tryHandleAgentApprovalChar does not consume when nothing is pending", () => {
  let fake = new FakeApprovals(false);
  let responder: ApprovalResponder = { hasPendingApproval: () => fake.hasPendingApproval(), answerActiveApproval: (d: string) => fake.answerActiveApproval(d) };
  let consumed = tryHandleAgentApprovalChar(responder, true, "n");
  expect(!consumed);
});

test("tryHandleAgentApprovalChar ignores an unrelated character even while pending and idle", () => {
  let fake = new FakeApprovals(true);
  let responder: ApprovalResponder = { hasPendingApproval: () => fake.hasPendingApproval(), answerActiveApproval: (d: string) => fake.answerActiveApproval(d) };
  let consumed = tryHandleAgentApprovalChar(responder, true, "x");
  expect(!consumed);
  expect(fake.lastDecision == "");
});

test("tryHandleAgentApprovalChar maps n to deny and a to always", () => {
  let fakeN = new FakeApprovals(true);
  let responderN: ApprovalResponder = { hasPendingApproval: () => fakeN.hasPendingApproval(), answerActiveApproval: (d: string) => fakeN.answerActiveApproval(d) };
  tryHandleAgentApprovalChar(responderN, true, "n");
  expect(fakeN.lastDecision == "deny");

  let fakeA = new FakeApprovals(true);
  let responderA: ApprovalResponder = { hasPendingApproval: () => fakeA.hasPendingApproval(), answerActiveApproval: (d: string) => fakeA.answerActiveApproval(d) };
  tryHandleAgentApprovalChar(responderA, true, "a");
  expect(fakeA.lastDecision == "always");
});

test("cancelCommandArg extracts the id after 'cancel '", () => {
  expect(cancelCommandArg("cancel agent-1") == "agent-1");
  expect(cancelCommandArg("cancel  bgrun-2  ") == "bgrun-2");
});

test("cancelCommandArg returns empty for anything else", () => {
  expect(cancelCommandArg("") == "");
  expect(cancelCommandArg("cancel") == "");
  expect(cancelCommandArg("list") == "");
});
