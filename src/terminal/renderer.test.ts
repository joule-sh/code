import { renderFrame } from "./renderer.ts";
import { fixtureScript } from "./fixture.ts";
import { frameType, TEXT_DELTA } from "../protocol/frames.ts";

test("the fixture script renders into an expected transcript", () => {
  let script = fixtureScript();
  let out = "";
  let prevKind = "";
  for (const frame of script) {
    out = out + renderFrame(frame, prevKind);
    prevKind = frameType(frame);
  }
  expect(out.indexOf("No health route yet") >= 0);
  expect(out.indexOf("-> write src/routes/health.ts") >= 0);
  expect(out.indexOf("ok: wrote 12 lines") >= 0);
  expect(out.indexOf("-> run npm test") >= 0);
  expect(out.indexOf("ok: 2 passed, 0 failed") >= 0);
});

test("turn.start renders nothing on its own, the model's own text does", () => {
  let script = fixtureScript();
  expect(renderFrame(script[0], "") == "");
});

test("a tool.result that failed renders its status as failed", () => {
  let f = "{\"v\":1,\"seq\":1,\"type\":\"tool.result\",\"turnId\":\"t1\",\"callId\":\"c1\",\"ok\":false,\"output\":\"permission denied\",\"truncated\":false}";
  let out = renderFrame(f, "");
  expect(out.indexOf("failed: permission denied") >= 0);
});

test("a truncated tool.result says so", () => {
  let f = "{\"v\":1,\"seq\":1,\"type\":\"tool.result\",\"turnId\":\"t1\",\"callId\":\"c1\",\"ok\":true,\"output\":\"lots\",\"truncated\":true}";
  let out = renderFrame(f, "");
  expect(out.indexOf("(truncated)") >= 0);
});

test("approval.request renders the summary and detail", () => {
  let f = "{\"v\":1,\"seq\":1,\"type\":\"approval.request\",\"turnId\":\"t1\",\"callId\":\"c1\",\"tool\":\"run\",\"summary\":\"run npm test\",\"detail\":\"npm test\"}";
  let out = renderFrame(f, "");
  expect(out.indexOf("run npm test") >= 0);
  expect(out.indexOf("(y/n/a)") >= 0);
});

test("turn.end with reason cancelled renders a cancelled marker", () => {
  let f = "{\"v\":1,\"seq\":1,\"type\":\"turn.end\",\"turnId\":\"t1\",\"reason\":\"cancelled\"}";
  expect(renderFrame(f, "").indexOf("cancelled") >= 0);
});

test("an unknown frame type renders nothing rather than crashing", () => {
  let f = "{\"v\":1,\"seq\":1,\"type\":\"some.future.thing\",\"whatever\":true}";
  expect(renderFrame(f, "") == "");
});

test("a malformed frame renders nothing rather than crashing", () => {
  expect(renderFrame("not json at all", "") == "");
});

test("a text.delta right after a tool.result gets a separating newline", () => {
  let toolResult = "{\"v\":1,\"seq\":1,\"type\":\"tool.result\",\"turnId\":\"t1\",\"callId\":\"c1\",\"ok\":true,\"output\":\"003-transport\",\"truncated\":false}";
  let delta = "{\"v\":1,\"seq\":2,\"type\":\"text.delta\",\"turnId\":\"t1\",\"text\":\"Here's the project structure:\"}";
  let out = renderFrame(toolResult, "") + renderFrame(delta, frameType(toolResult));
  expect(out.indexOf("003-transport\nHere's the project structure:") >= 0);
});

test("two consecutive text.delta frames do not get a newline inserted between them", () => {
  let first = "{\"v\":1,\"seq\":1,\"type\":\"text.delta\",\"turnId\":\"t1\",\"text\":\"No health route yet. \"}";
  let second = "{\"v\":1,\"seq\":2,\"type\":\"text.delta\",\"turnId\":\"t1\",\"text\":\"I'll add GET /health.\"}";
  let out = renderFrame(first, TEXT_DELTA) + renderFrame(second, frameType(first));
  expect(out == "No health route yet. I'll add GET /health.");
});
