import { PROTOCOL_VERSION, TEXT_DELTA, TOOL_RESULT, TURN_END, APPROVAL_REQUEST, REASON_DONE, TextDeltaFrame, ToolResultFrame, TurnEndFrame, ApprovalRequestFrame, encodeTextDelta, encodeToolResult, encodeTurnEnd, encodeApprovalRequest } from "../protocol/frames.ts";
import { PendingApproval, APPROVAL_OPTION_COUNT, APPROVAL_OPTION_DENY } from "./input_state.ts";
import { repaintApprovalOptions } from "./approval_ui.ts";
import { Scrollback } from "./scrollback.ts";
import { TurnStatusTracker, appendFrame } from "./screen.ts";
import { TaggedTurns, appendTaggedFrame } from "./tasks_bridge.ts";

function delta(turnId: string, text: string): string {
  let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: 1, type: TEXT_DELTA, turnId: turnId, text: text };
  return encodeTextDelta(f);
}

function turnEnd(turnId: string): string {
  let f: TurnEndFrame = { v: PROTOCOL_VERSION, seq: 1, type: TURN_END, turnId: turnId, reason: REASON_DONE };
  return encodeTurnEnd(f);
}

function lineWith(sb: Scrollback, needle: string): string {
  for (const line of sb.lines) {
    if (line.indexOf(needle) >= 0) { return line; }
  }
  return "";
}

function viewHas(view: string[], needle: string): bool {
  for (const line of view) {
    if (line.indexOf(needle) >= 0) { return true; }
  }
  return false;
}

function occurrences(sb: Scrollback, needle: string): int {
  let n = 0;
  for (const line of sb.lines) {
    if (line.indexOf(needle) >= 0) { n = n + 1; }
  }
  return n;
}

test("foreground text does not land on the end of a subagent's row", () => {
  let sb = new Scrollback();
  let rk = new TurnStatusTracker();
  let turns = new TaggedTurns();

  appendFrame(sb, rk, delta("t1", "the parent is talking"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "the subagent is talking\n"));
  appendFrame(sb, rk, delta("t1", " about README\n"));

  let agentLine = lineWith(sb, "the subagent is talking");
  expect(agentLine.indexOf("[agent agent-1]") >= 0);
  expect(agentLine.indexOf("parent") < 0);
  expect(agentLine.indexOf("README") < 0);

  let parentLine = lineWith(sb, "the parent is talking about README");
  expect(parentLine != "");
  expect(parentLine.indexOf("[agent") < 0);
});

test("a subagent's row does not land on the end of the foreground's row", () => {
  let sb = new Scrollback();
  let rk = new TurnStatusTracker();
  let turns = new TaggedTurns();

  appendFrame(sb, rk, delta("t1", "parent line one\n"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "subagent line one\n"));

  expect(lineWith(sb, "parent line one").indexOf("subagent") < 0);
  expect(lineWith(sb, "subagent line one").indexOf("[agent agent-1]") >= 0);
});

test("a foreground turn and a subagent turn ending around each other keep their own rows", () => {
  let sb = new Scrollback();
  let rk = new TurnStatusTracker();
  let turns = new TaggedTurns();

  appendFrame(sb, rk, delta("t1", "parent finishing up"));
  appendTaggedFrame(sb, turns, delta("agent:agent-1", "subagent finishing up"));
  let f: ToolResultFrame = { v: PROTOCOL_VERSION, seq: 2, type: TOOL_RESULT, turnId: "agent:agent-1", callId: "agent-1:1", ok: true, output: "done", truncated: false };
  appendTaggedFrame(sb, turns, encodeToolResult(f));
  appendFrame(sb, rk, turnEnd("t1"));

  expect(lineWith(sb, "subagent finishing up").indexOf("parent") < 0);
  expect(lineWith(sb, "parent finishing up").indexOf("subagent") < 0);
  expect(lineWith(sb, "parent finishing up").indexOf("[agent") < 0);
});

test("appendBlock starts a new row only when the last row already has content", () => {
  let sb = new Scrollback();
  sb.appendBlock("first");
  expect(sb.lines.length == 1);
  expect(sb.lines[0] == "first");
  sb.appendBlock("second");
  expect(sb.lines.length == 2);
  expect(sb.lines[1] == "second");
  sb.appendBlock("\nthird");
  expect(sb.lines.length == 3);
  expect(sb.lines[2] == "third");
  sb.appendBlock("");
  expect(sb.lines.length == 3);
});

function longToolResult(turnId: string, n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    if (i > 0) { out = out + "\n"; }
    out = out + "match " + `${i}`;
    i = i + 1;
  }
  let f: ToolResultFrame = { v: PROTOCOL_VERSION, seq: 3, type: TOOL_RESULT, turnId: turnId, callId: "c1", ok: true, output: out, truncated: false };
  return encodeToolResult(f);
}

function approval(turnId: string): string {
  let f: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: 4, type: APPROVAL_REQUEST, turnId: turnId, callId: "c2", tool: "run", summary: "run npm test", detail: "npm test", args: "{}" };
  return encodeApprovalRequest(f);
}

test("long tool output arriving on the transcript collapses to a head and a marker", () => {
  let sb = new Scrollback();
  let rk = new TurnStatusTracker();
  appendFrame(sb, rk, longToolResult("t1", 50));
  expect(sb.collapsedCount() == 1);
  expect(sb.lineCount() == 52);
  expect(sb.visibleCount() == 8);
  let view = sb.tail(100);
  expect(viewHas(view, "ok: match 0"));
  expect(viewHas(view, "match 5"));
  expect(view[view.length - 1].indexOf("+44 lines") >= 0);
  expect(!viewHas(view, "match 44"));
});

test("short tool output is left alone rather than collapsed", () => {
  let sb = new Scrollback();
  let rk = new TurnStatusTracker();
  appendFrame(sb, rk, longToolResult("t1", 10));
  expect(sb.collapsedCount() == 0);
  expect(sb.visibleCount() == sb.lineCount());
  expect(lineWith(sb, "match 9") != "");
});

test("expanding collapsed output above a pending approval keeps its recorded option rows repaintable", () => {
  let sb = new Scrollback();
  let rk = new TurnStatusTracker();
  appendFrame(sb, rk, longToolResult("t1", 50));
  appendFrame(sb, rk, approval("t1"));

  let pending = new PendingApproval();
  pending.set("c2");
  pending.setTool("run");
  pending.setOptionRows(sb.lineCount() - APPROVAL_OPTION_COUNT);
  expect(sb.lines[pending.firstOptionRow].indexOf("1. Yes") >= 0);
  expect(sb.lines[pending.firstOptionRow + 2].indexOf("3. No") >= 0);

  let rows = sb.lineCount();
  expect(sb.toggleLastGroup());
  expect(sb.lineCount() == rows);
  expect(pending.firstOptionRow == sb.lineCount() - APPROVAL_OPTION_COUNT);
  expect(!sb.isHidden(pending.firstOptionRow));
  expect(viewHas(sb.tail(200), "match 44"));

  pending.select(APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT);
  repaintApprovalOptions(sb, pending);
  expect(sb.lines[pending.firstOptionRow + 2].indexOf("> 3. No") >= 0);
  expect(sb.lines[pending.firstOptionRow].indexOf("1. Yes") >= 0);
  expect(occurrences(sb, "3. No") == 1);

  expect(sb.toggleLastGroup());
  let view = sb.tail(200);
  expect(view[view.length - 1].indexOf("> 3. No") >= 0);
  expect(view[view.length - 3].indexOf("1. Yes") >= 0);
  expect(!viewHas(view, "match 44"));
});
