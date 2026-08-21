import { PROTOCOL_VERSION, TEXT_DELTA, TOOL_RESULT, TURN_END, REASON_DONE, TextDeltaFrame, ToolResultFrame, TurnEndFrame, encodeTextDelta, encodeToolResult, encodeTurnEnd } from "../protocol/frames.ts";
import { Scrollback } from "./input_state.ts";
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
