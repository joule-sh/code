import { PROTOCOL_VERSION, TEXT_DELTA, TOOL_RESULT, TURN_END, APPROVAL_REQUEST, REASON_DONE, TextDeltaFrame, ToolResultFrame, TurnEndFrame, ApprovalRequestFrame, encodeTextDelta, encodeToolResult, encodeTurnEnd, encodeApprovalRequest } from "../protocol/frames.ts";
import { ApprovalResponder } from "../tasks/types.ts";
import { APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { isTaskTurnId, appendTaggedFrame, TaggedTurns, tryHandleAgentApprovalChar, repaintTaggedApprovalOptions, tryHandleAgentApprovalArrow, tryHandleAgentApprovalEnter, cancelCommandArg } from "./tasks_bridge.ts";

function lastLine(sb: Scrollback): string {
  let t = sb.tail(5);
  return t[t.length - 1];
}

function delta(turnId: string, text: string): string {
  let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: 1, type: TEXT_DELTA, turnId: turnId, text: text };
  return encodeTextDelta(f);
}

function turnEnd(turnId: string): string {
  let f: TurnEndFrame = { v: PROTOCOL_VERSION, seq: 1, type: TURN_END, turnId: turnId, reason: REASON_DONE };
  return encodeTurnEnd(f);
}

function approvalRequest(turnId: string, tool: string): string {
  let f: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: 1, type: APPROVAL_REQUEST, turnId: turnId, callId: "c1", tool: tool, summary: "run " + tool, detail: "workspace", args: "npm test" };
  return encodeApprovalRequest(f);
}

function occurrences(haystack: string, needle: string): int {
  let count = 0;
  let at = haystack.indexOf(needle, 0);
  while (at >= 0) {
    count = count + 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

function lineWith(sb: Scrollback, needle: string): string {
  for (const line of sb.lines) {
    if (line.indexOf(needle) >= 0) { return line; }
  }
  return "";
}

function joinedLines(sb: Scrollback): string {
  let out = "";
  for (const line of sb.lines) {
    out = out + line + "\n";
  }
  return out;
}

test("isTaskTurnId recognizes bg: and agent: prefixes only", () => {
  expect(isTaskTurnId("bg:bgrun-1"));
  expect(isTaskTurnId("agent:agent-1"));
  expect(!isTaskTurnId("t1"));
  expect(!isTaskTurnId(""));
  expect(!isTaskTurnId("bgrun-1"));
});

test("appendTaggedFrame prefixes a completed background text line with [task <id>]", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  appendTaggedFrame(sb, turns, delta("bg:bgrun-1", "building...\n"));
  let joined = lastLine(sb);
  expect(joined.indexOf("[task bgrun-1]") >= 0);
  expect(joined.indexOf("building...") >= 0);
});

test("appendTaggedFrame prefixes a subagent tool.result with [agent <id>]", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  let f: ToolResultFrame = { v: PROTOCOL_VERSION, seq: 1, type: TOOL_RESULT, turnId: "agent:agent-1", callId: "agent-1:1", ok: true, output: "done", truncated: false };
  appendTaggedFrame(sb, turns, encodeToolResult(f));
  let joined = lastLine(sb);
  expect(joined.indexOf("[agent agent-1]") >= 0);
});

test("appendTaggedFrame on a foreground frame (no bg:/agent: turnId) still renders, untagged", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  appendTaggedFrame(sb, turns, delta("t1", "hello\n"));
  let joined = lastLine(sb);
  expect(joined.indexOf("hello") >= 0);
  expect(joined.indexOf("[task") < 0);
  expect(joined.indexOf("[agent") < 0);
});

test("streamed subagent tokens accumulate into one prose line carrying the tag once", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "I"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "'ll"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", " run"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", " the"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", " command"));
  expect(lineWith(sb, "I'll run") == "");
  appendTaggedFrame(sb, turns, turnEnd("agent:agent-1"));
  let line = lineWith(sb, "I'll run the command");
  expect(line != "");
  expect(occurrences(line, "[agent agent-1]") == 1);
  expect(occurrences(joinedLines(sb), "I'll run the command") == 1);
});

test("a newline inside the stream flushes that line and tags the next one on its own row", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "first line\nsecond "));
  expect(lineWith(sb, "first line") != "");
  expect(lineWith(sb, "second") == "");
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "line\n"));
  let second = lineWith(sb, "second line");
  expect(second != "");
  expect(occurrences(second, "[agent agent-1]") == 1);
  expect(lineWith(sb, "first line").indexOf("second") < 0);
});

test("two turnIds streaming interleaved never merge into each other's line", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "reading"));
  appendTaggedFrame(sb, turns, delta("agent:agent-2", "writing"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", " the"));
  appendTaggedFrame(sb, turns, delta("agent:agent-2", " the"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", " config"));
  appendTaggedFrame(sb, turns, delta("agent:agent-2", " report"));
  appendTaggedFrame(sb, turns, turnEnd("agent:agent-1"));
  appendTaggedFrame(sb, turns, turnEnd("agent:agent-2"));

  let one = lineWith(sb, "reading the config");
  let two = lineWith(sb, "writing the report");
  expect(one != "");
  expect(two != "");
  expect(one.indexOf("[agent agent-1]") >= 0);
  expect(one.indexOf("agent-2") < 0);
  expect(one.indexOf("writing") < 0);
  expect(two.indexOf("[agent agent-2]") >= 0);
  expect(two.indexOf("agent-1") < 0);
  expect(two.indexOf("reading") < 0);
});

test("a background task and a subagent streaming at once keep their own tags", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  appendTaggedFrame(sb, turns, delta("bg:bgrun-1", "npm"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "looking"));
  appendTaggedFrame(sb, turns, delta("bg:bgrun-1", " test passed\n"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", " into it\n"));
  expect(lineWith(sb, "npm test passed").indexOf("[task bgrun-1]") >= 0);
  expect(lineWith(sb, "looking into it").indexOf("[agent agent-1]") >= 0);
});

test("a turn ending frees its buffer so a later turn with the same id starts clean", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "half a sentence"));
  expect(turns.streaming() == 1);
  appendTaggedFrame(sb, turns, turnEnd("agent:agent-1"));
  expect(turns.streaming() == 0);
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "a new thought\n"));
  expect(lineWith(sb, "a new thought").indexOf("half a sentence") < 0);
});

test("pending streamed text is flushed above a tool.result rather than after it", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "checking the tests"));
  let f: ToolResultFrame = { v: PROTOCOL_VERSION, seq: 2, type: TOOL_RESULT, turnId: "agent:agent-1", callId: "agent-1:1", ok: true, output: "12 passed", truncated: false };
  appendTaggedFrame(sb, turns, encodeToolResult(f));
  let textRow = -1;
  let resultRow = -1;
  let i = 0;
  while (i < sb.lines.length) {
    if (sb.lines[i].indexOf("checking the tests") >= 0) { textRow = i; }
    if (sb.lines[i].indexOf("12 passed") >= 0) { resultRow = i; }
    i = i + 1;
  }
  expect(textRow >= 0);
  expect(resultRow > textRow);
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

test("an approval arriving mid-stream lands on rows that stay valid while the turn keeps streaming", () => {
  let sb = new Scrollback();
  let turns = new TaggedTurns();
  let fake = new FakeApprovals(true);
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "I need to run the tests"));
  appendTaggedFrame(sb, turns, approvalRequest("agent:agent-1", "run"));
  fake.firstOptionRow = sb.lineCount() - APPROVAL_OPTION_COUNT;

  expect(sb.lines[fake.firstOptionRow].indexOf("1. Yes") >= 0);
  expect(sb.lines[fake.firstOptionRow + 1].indexOf("2. Yes, and") >= 0);
  expect(sb.lines[fake.firstOptionRow + 2].indexOf("3. No") >= 0);
  expect(lineWith(sb, "I need to run the tests") != "");

  appendTaggedFrame(sb, turns, delta("agent:agent-1", "meanwhile"));
  appendTaggedFrame(sb, turns, delta("agent:agent-2", "another agent talks\n"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", " I wait\n"));

  fake.selected = 2;
  repaintTaggedApprovalOptions(sb, responderFor(fake));
  expect(sb.lines[fake.firstOptionRow].indexOf("1. Yes") >= 0);
  expect(sb.lines[fake.firstOptionRow + 2].indexOf("3. No") >= 0);
  expect(occurrences(joinedLines(sb), "3. No") == 1);
  expect(lineWith(sb, "meanwhile I wait") != "");
  expect(lineWith(sb, "another agent talks") != "");
});
