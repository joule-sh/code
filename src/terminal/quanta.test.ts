import { quantaVerb, buildQuantaIndicator } from "./quanta.ts";
import { VIOLET, RESET } from "./style.ts";
import { TURN_START, TOOL_CALL, TOOL_RESULT, TURN_END, TEXT_DELTA } from "../protocol/frames.ts";

test("a turn.start frame maps to thinking", () => {
  expect(quantaVerb(TURN_START, "") == "thinking");
});

test("a tool.call frame maps to thinking, regardless of which tool", () => {
  expect(quantaVerb(TOOL_CALL, "read") == "thinking");
  expect(quantaVerb(TOOL_CALL, "write") == "thinking");
  expect(quantaVerb(TOOL_CALL, "run") == "thinking");
  expect(quantaVerb(TOOL_CALL, "some_future_tool") == "thinking");
});

test("a tool.result frame maps to thinking, since the model is invoked again right after", () => {
  expect(quantaVerb(TOOL_RESULT, "") == "thinking");
});

test("turn.end and text.delta frames are idle, no indicator to show once real content is flowing or the turn is over", () => {
  expect(quantaVerb(TURN_END, "") == "");
  expect(quantaVerb(TEXT_DELTA, "") == "");
});

test("the idle state builds no indicator text at all", () => {
  expect(buildQuantaIndicator(TURN_END, "") == "");
});

test("the thinking indicator is styled violet with a reset, no mascot name in the text", () => {
  let out = buildQuantaIndicator(TURN_START, "");
  expect(out.indexOf(VIOLET) == 0);
  expect(out.indexOf("thinking") >= 0);
  expect(out.indexOf("quanta") < 0);
  expect(out.slice(out.length - RESET.length, out.length) == RESET);
});
