import { PROTOCOL_VERSION, TEXT_DELTA, TOOL_RESULT, TextDeltaFrame, ToolResultFrame, encodeTextDelta, encodeToolResult } from "../protocol/frames.ts";
import { ApprovalResponder } from "../tasks/types.ts";
import { Scrollback } from "./input_state.ts";
import { isTaskTurnId, appendTaggedFrame, tryHandleAgentApprovalChar, repaintTaggedApprovalOptions, tryHandleAgentApprovalArrow, tryHandleAgentApprovalEnter, cancelCommandArg } from "./tasks_bridge.ts";

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
  tool: string;
  selected: int;
  firstOptionRow: int;

  constructor(pending: bool) {
    this.pending = pending;
    this.lastDecision = "";
    this.tool = "run";
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  hasPendingApproval(): bool { return this.pending; }
  answerActiveApproval(decision: string): void { this.lastDecision = decision; this.pending = false; }
  activeApprovalTool(): string { return this.tool; }
  activeApprovalSelected(): int { return this.selected; }
  activeApprovalHasOptionRows(): bool { return this.firstOptionRow >= 0; }
  activeApprovalOptionRows(): int { return this.firstOptionRow; }

  moveActiveApprovalSelection(delta: int, count: int): bool {
    let next = this.selected + delta;
    if (next < 0) { next = 0; }
    if (next > count - 1) { next = count - 1; }
    if (next == this.selected) { return false; }
    this.selected = next;
    return true;
  }
}

function responderFor(fake: FakeApprovals): ApprovalResponder {
  return {
    hasPendingApproval: () => fake.hasPendingApproval(),
    answerActiveApproval: (d: string) => fake.answerActiveApproval(d),
    activeApprovalTool: () => fake.activeApprovalTool(),
    activeApprovalSelected: () => fake.activeApprovalSelected(),
    activeApprovalHasOptionRows: () => fake.activeApprovalHasOptionRows(),
    activeApprovalOptionRows: () => fake.activeApprovalOptionRows(),
    moveActiveApprovalSelection: (delta: int, count: int) => fake.moveActiveApprovalSelection(delta, count),
  };
}

test("tryHandleAgentApprovalChar consumes y/n/a only when input is empty and an approval is pending", () => {
  let fake = new FakeApprovals(true);
  let consumed = tryHandleAgentApprovalChar(responderFor(fake), true, "y");
  expect(consumed);
  expect(fake.lastDecision == "allow");
});

test("tryHandleAgentApprovalChar does not consume when input is not empty", () => {
  let fake = new FakeApprovals(true);
  let consumed = tryHandleAgentApprovalChar(responderFor(fake), false, "y");
  expect(!consumed);
  expect(fake.lastDecision == "");
});

test("tryHandleAgentApprovalChar does not consume when nothing is pending", () => {
  let fake = new FakeApprovals(false);
  let consumed = tryHandleAgentApprovalChar(responderFor(fake), true, "n");
  expect(!consumed);
});

test("tryHandleAgentApprovalChar ignores an unrelated character even while pending and idle", () => {
  let fake = new FakeApprovals(true);
  let consumed = tryHandleAgentApprovalChar(responderFor(fake), true, "x");
  expect(!consumed);
  expect(fake.lastDecision == "");
});

test("tryHandleAgentApprovalChar maps n to deny and a to always", () => {
  let fakeN = new FakeApprovals(true);
  tryHandleAgentApprovalChar(responderFor(fakeN), true, "n");
  expect(fakeN.lastDecision == "deny");

  let fakeA = new FakeApprovals(true);
  tryHandleAgentApprovalChar(responderFor(fakeA), true, "a");
  expect(fakeA.lastDecision == "always");
});

test("tryHandleAgentApprovalChar also takes the option lists number keys", () => {
  let fake1 = new FakeApprovals(true);
  expect(tryHandleAgentApprovalChar(responderFor(fake1), true, "1"));
  expect(fake1.lastDecision == "allow");

  let fake2 = new FakeApprovals(true);
  expect(tryHandleAgentApprovalChar(responderFor(fake2), true, "2"));
  expect(fake2.lastDecision == "always");

  let fake3 = new FakeApprovals(true);
  expect(tryHandleAgentApprovalChar(responderFor(fake3), true, "3"));
  expect(fake3.lastDecision == "deny");
});

test("tryHandleAgentApprovalChar does not touch the arrow-selected highlight", () => {
  let fake = new FakeApprovals(true);
  fake.selected = 2;
  tryHandleAgentApprovalChar(responderFor(fake), true, "y");
  expect(fake.lastDecision == "allow");
});

test("repaintTaggedApprovalOptions is a no-op when the active approval has no tracked option rows", () => {
  let fake = new FakeApprovals(true);
  let sb = new Scrollback();
  sb.append("a\nb\nc");
  let before = sb.lines.length;
  repaintTaggedApprovalOptions(sb, responderFor(fake));
  expect(sb.lines.length == before);
});

test("repaintTaggedApprovalOptions redraws exactly the three option rows at the tracked offset", () => {
  let fake = new FakeApprovals(true);
  fake.firstOptionRow = 1;
  fake.selected = 1;
  let sb = new Scrollback();
  sb.append("header\n1\n2\n3\ntrailer");
  repaintTaggedApprovalOptions(sb, responderFor(fake));
  expect(sb.lines[0] == "header");
  expect(sb.lines[1].indexOf("1. Yes") >= 0);
  expect(sb.lines[2].indexOf("2. Yes, and") >= 0);
  expect(sb.lines[3].indexOf("3. No") >= 0);
  expect(sb.lines[4] == "trailer");
});

test("tryHandleAgentApprovalArrow moves the highlight and repaints when input is empty and an approval is pending", () => {
  let fake = new FakeApprovals(true);
  fake.firstOptionRow = 0;
  let sb = new Scrollback();
  sb.append("1\n2\n3");
  let consumed = tryHandleAgentApprovalArrow(responderFor(fake), sb, true, 1);
  expect(consumed);
  expect(fake.selected == 1);
  expect(sb.lines[1].indexOf("2. Yes") >= 0);
});

test("tryHandleAgentApprovalArrow still reports consumed at the clamped end, without a further repaint change", () => {
  let fake = new FakeApprovals(true);
  fake.selected = 2;
  fake.firstOptionRow = 0;
  let sb = new Scrollback();
  sb.append("1\n2\n3");
  let consumed = tryHandleAgentApprovalArrow(responderFor(fake), sb, true, 1);
  expect(consumed);
  expect(fake.selected == 2);
});

test("tryHandleAgentApprovalArrow does not consume when input is not empty, leaving history navigation to happen", () => {
  let fake = new FakeApprovals(true);
  let sb = new Scrollback();
  let consumed = tryHandleAgentApprovalArrow(responderFor(fake), sb, false, 1);
  expect(!consumed);
  expect(fake.selected == 0);
});

test("tryHandleAgentApprovalArrow does not consume when nothing is pending", () => {
  let fake = new FakeApprovals(false);
  let sb = new Scrollback();
  let consumed = tryHandleAgentApprovalArrow(responderFor(fake), sb, true, 1);
  expect(!consumed);
});

test("tryHandleAgentApprovalEnter answers with the currently highlighted option", () => {
  let fake = new FakeApprovals(true);
  fake.firstOptionRow = 0;
  fake.selected = 2;
  let sb = new Scrollback();
  sb.append("1\n2\n3");
  let consumed = tryHandleAgentApprovalEnter(responderFor(fake), sb, true);
  expect(consumed);
  expect(fake.lastDecision == "deny");
  expect(sb.lines[2].indexOf("3. No") >= 0);
});

test("tryHandleAgentApprovalEnter defaults to the allow option when the highlight was never moved", () => {
  let fake = new FakeApprovals(true);
  let sb = new Scrollback();
  let consumed = tryHandleAgentApprovalEnter(responderFor(fake), sb, true);
  expect(consumed);
  expect(fake.lastDecision == "allow");
});

test("tryHandleAgentApprovalEnter does not consume when input is not empty or nothing is pending", () => {
  let fakeTyping = new FakeApprovals(true);
  let sb = new Scrollback();
  expect(!tryHandleAgentApprovalEnter(responderFor(fakeTyping), sb, false));
  expect(fakeTyping.lastDecision == "");

  let fakeIdle = new FakeApprovals(false);
  expect(!tryHandleAgentApprovalEnter(responderFor(fakeIdle), sb, true));
});

test("cancelCommandArg extracts the id after cancel ", () => {
  expect(cancelCommandArg("cancel agent-1") == "agent-1");
  expect(cancelCommandArg("cancel  bgrun-2  ") == "bgrun-2");
});

test("cancelCommandArg returns empty for anything else", () => {
  expect(cancelCommandArg("") == "");
  expect(cancelCommandArg("cancel") == "");
  expect(cancelCommandArg("list") == "");
});
