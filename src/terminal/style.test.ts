import { styleFrame, stylePrompt, styleBanner, RESET, VIOLET, RED, GREEN, BOLD, YELLOW, DIM } from "./style.ts";
import { TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR, NOTICE, TEXT_DELTA } from "../protocol/frames.ts";

test("a tool call is wrapped in violet and reset", () => {
  let out = styleFrame(TOOL_CALL, "  -> read a.ts");
  expect(out.indexOf(VIOLET) == 0);
  expect(out.indexOf("  -> read a.ts") >= 0);
  expect(out.slice(out.length - RESET.length, out.length) == RESET);
});

test("an ok tool result is green, a failed one is red", () => {
  let ok = styleFrame(TOOL_RESULT, "     ok: wrote 12 lines");
  let failed = styleFrame(TOOL_RESULT, "     failed: permission denied");
  expect(ok.indexOf(GREEN) == 0);
  expect(failed.indexOf(RED) == 0);
});

test("an approval request is bold yellow", () => {
  let out = styleFrame(APPROVAL_REQUEST, "  ? run npm test (y/n/a)");
  expect(out.indexOf(BOLD + YELLOW) == 0);
});

test("an error frame is red", () => {
  let out = styleFrame(ERROR, "! E_HTTP_400: bad request");
  expect(out.indexOf(RED) == 0);
});

test("a turn.end line with visible content is dim", () => {
  let out = styleFrame(TURN_END, "\n(cancelled)\n");
  expect(out.indexOf(DIM) >= 0);
  expect(out.indexOf("(cancelled)") >= 0);
});

test("a turn.end line with no visible content is left untouched", () => {
  let out = styleFrame(TURN_END, "\n");
  expect(out == "\n");
});

test("an unstyled frame kind passes text through unchanged", () => {
  expect(styleFrame(TEXT_DELTA, "hello") == "hello");
});

test("stylePrompt and styleBanner wrap in their own color and reset", () => {
  expect(stylePrompt("> ").indexOf(VIOLET) == 0);
  expect(styleBanner("joule").indexOf(DIM) == 0);
});

test("a leading newline stays outside the color so it does not bleed onto the previous line", () => {
  let out = styleFrame(ERROR, "\n! E_HTTP_400: bad request");
  expect(out.charAt(0) == "\n");
  expect(out.indexOf(RED) == 1);
});

test("a trailing newline stays outside the color and reset", () => {
  let out = styleFrame(TURN_END, "\n(error)\n");
  expect(out.slice(out.length - 1, out.length) == "\n");
  expect(out.indexOf(RESET) < out.length - 1);
});

test("a warning notice is bold yellow, distinct from the red an error gets", () => {
  let warn = styleFrame(NOTICE, "! cannot reach the daemon (closed), still retrying");
  expect(warn.indexOf(BOLD + YELLOW) == 0);
  expect(warn.indexOf(RED) < 0);
});

test("an informational notice is dim, so a lifecycle event never shouts", () => {
  let info = styleFrame(NOTICE, "connected to the daemon");
  expect(info.indexOf(DIM) == 0);
  expect(info.indexOf(RED) < 0);
  expect(info.indexOf(YELLOW) < 0);
});
