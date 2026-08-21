import { quantaVerb, buildQuantaIndicator } from "./quanta.ts";
import { VIOLET, RESET } from "./style.ts";
import { TURN_START, TOOL_CALL, TOOL_RESULT, TURN_END, TEXT_DELTA } from "../protocol/frames.ts";

test("a turn.start frame maps to the thinking state, the core gap this ticket exists for", () => {
  expect(quantaVerb(TURN_START, "") == "thinking");
});

test("a tool.result frame maps back to thinking, since the model is invoked again right after", () => {
  expect(quantaVerb(TOOL_RESULT, "") == "thinking");
});

test("a read tool call maps to reading", () => {
  expect(quantaVerb(TOOL_CALL, "read") == "reading");
});

test("write and edit tool calls both map to writing", () => {
  expect(quantaVerb(TOOL_CALL, "write") == "writing");
  expect(quantaVerb(TOOL_CALL, "edit") == "writing");
});

test("list and grep tool calls both map to searching", () => {
  expect(quantaVerb(TOOL_CALL, "list") == "searching");
  expect(quantaVerb(TOOL_CALL, "grep") == "searching");
});

test("a run tool call maps to running", () => {
  expect(quantaVerb(TOOL_CALL, "run") == "running");
});

test("an unrecognized tool name still gets a fallback verb rather than an empty state", () => {
  expect(quantaVerb(TOOL_CALL, "some_future_tool") == "working");
});

test("turn.end and text.delta frames are idle, no quanta state to show once real content is flowing or the turn is over", () => {
  expect(quantaVerb(TURN_END, "") == "");
  expect(quantaVerb(TEXT_DELTA, "") == "");
});

test("the idle state builds no indicator text at all", () => {
  expect(buildQuantaIndicator(TURN_END, "") == "");
});

test("the thinking indicator names quanta and is styled violet with a reset", () => {
  let out = buildQuantaIndicator(TURN_START, "");
  expect(out.indexOf(VIOLET) == 0);
  expect(out.indexOf("quanta is thinking") >= 0);
  expect(out.slice(out.length - RESET.length, out.length) == RESET);
});

test("the tool indicator names the specific state for the tool in flight", () => {
  let out = buildQuantaIndicator(TOOL_CALL, "read");
  expect(out.indexOf("quanta is reading") >= 0);
});
