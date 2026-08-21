import { renderFrame } from "./renderer.ts";
import { fixtureScript } from "./fixture.ts";
import { frameType, TEXT_DELTA, PROTOCOL_VERSION, TOOL_CALL, APPROVAL_REQUEST, ToolCallFrame, ApprovalRequestFrame, encodeToolCall, encodeApprovalRequest } from "../protocol/frames.ts";
import { GREEN, RED } from "./style.ts";

type EditArgs = { path: string, old_text: string, new_text: string };
type WriteArgs = { path: string, content: string };
type RunArgs = { command: string };

function editCallFrame(path: string, oldText: string, newText: string): string {
  let args: EditArgs = { path: path, old_text: oldText, new_text: newText };
  let f: ToolCallFrame = { v: PROTOCOL_VERSION, seq: 1, type: TOOL_CALL, turnId: "t1", callId: "c1", tool: "edit", args: JSON.stringify(args) };
  return encodeToolCall(f);
}

function writeCallFrame(path: string, content: string): string {
  let args: WriteArgs = { path: path, content: content };
  let f: ToolCallFrame = { v: PROTOCOL_VERSION, seq: 1, type: TOOL_CALL, turnId: "t1", callId: "c1", tool: "write", args: JSON.stringify(args) };
  return encodeToolCall(f);
}

function editApprovalFrame(path: string, oldText: string, newText: string): string {
  let args: EditArgs = { path: path, old_text: oldText, new_text: newText };
  let argsJson = JSON.stringify(args);
  let f: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: 1, type: APPROVAL_REQUEST, turnId: "t1", callId: "c1", tool: "edit", summary: "edit " + path, detail: argsJson, args: argsJson };
  return encodeApprovalRequest(f);
}

function writeApprovalFrame(path: string, content: string): string {
  let args: WriteArgs = { path: path, content: content };
  let argsJson = JSON.stringify(args);
  let f: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: 1, type: APPROVAL_REQUEST, turnId: "t1", callId: "c1", tool: "write", summary: "write " + path, detail: argsJson, args: argsJson };
  return encodeApprovalRequest(f);
}

function runApprovalFrame(command: string): string {
  let args: RunArgs = { command: command };
  let argsJson = JSON.stringify(args);
  let f: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: 1, type: APPROVAL_REQUEST, turnId: "t1", callId: "c1", tool: "run", summary: "run " + command, detail: argsJson, args: argsJson };
  return encodeApprovalRequest(f);
}

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
  let f = "{\"v\":1,\"seq\":1,\"type\":\"approval.request\",\"turnId\":\"t1\",\"callId\":\"c1\",\"tool\":\"run\",\"summary\":\"run npm test\",\"detail\":\"npm test\",\"args\":\"{\\\"command\\\":\\\"npm test\\\"}\"}";
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

test("an edit tool.call renders the path, then a colored diff of old_text vs new_text", () => {
  let f = editCallFrame("src/a.ts", "const x = 1;", "const x = 2;");
  let out = renderFrame(f, "");
  expect(out.indexOf("-> edit src/a.ts") >= 0);
  expect(out.indexOf(RED + "- const x = 1;") >= 0);
  expect(out.indexOf(GREEN + "+ const x = 2;") >= 0);
});

test("a write tool.call renders the path, then a diff against empty old text with green added lines", () => {
  let f = writeCallFrame("src/new.ts", "line one\nline two");
  let out = renderFrame(f, "");
  expect(out.indexOf("-> write src/new.ts") >= 0);
  expect(out.indexOf(GREEN + "+ line one") >= 0);
  expect(out.indexOf(GREEN + "+ line two") >= 0);
});

test("an edit tool.call with unchanged text renders the path but no diff body", () => {
  let f = editCallFrame("src/same.ts", "same", "same");
  let out = renderFrame(f, "");
  expect(out == "\n  -> edit src/same.ts");
});

function manyLines(prefix: string, count: int): string {
  let out = "";
  let i = 0;
  while (i < count) {
    if (i > 0) { out = out + "\n"; }
    out = out + prefix + `${i}`;
    i = i + 1;
  }
  return out;
}

test("a diff larger than the terminal display cap falls back to the plain summary line, no diff body", () => {
  let f = writeCallFrame("src/big.ts", manyLines("line ", 500));
  let out = renderFrame(f, "");
  expect(out == "\n  -> write src/big.ts");
});

test("a tool.call for a non-diffable tool still dumps its raw args, unchanged", () => {
  let f = "{\"v\":1,\"seq\":1,\"type\":\"tool.call\",\"turnId\":\"t1\",\"callId\":\"c1\",\"tool\":\"grep\",\"args\":\"{\\\"pattern\\\":\\\"TODO\\\"}\"}";
  let out = renderFrame(f, "");
  expect(out == "\n  -> grep {\"pattern\":\"TODO\"}");
});

test("an edit approval.request renders the diff above the y/n/a decision line, before any answer is given", () => {
  let f = editApprovalFrame("src/a.ts", "const x = 1;", "const x = 2;");
  let out = renderFrame(f, "");
  let diffAt = out.indexOf(RED + "- const x = 1;");
  let decisionAt = out.indexOf("(y/n/a)");
  expect(diffAt >= 0);
  expect(decisionAt >= 0);
  expect(diffAt < decisionAt);
  expect(out.indexOf(GREEN + "+ const x = 2;") >= 0);
});

test("a write approval.request renders the diff above the y/n/a decision line", () => {
  let f = writeApprovalFrame("src/new.ts", "line one\nline two");
  let out = renderFrame(f, "");
  let diffAt = out.indexOf(GREEN + "+ line one");
  let decisionAt = out.indexOf("(y/n/a)");
  expect(diffAt >= 0);
  expect(decisionAt >= 0);
  expect(diffAt < decisionAt);
});

test("a run approval.request renders no diff, just the plain summary and decision line", () => {
  let f = runApprovalFrame("npm test");
  let out = renderFrame(f, "");
  expect(out.indexOf("run npm test") >= 0);
  expect(out.indexOf("(y/n/a)") >= 0);
  expect(out.indexOf(GREEN) < 0);
  expect(out.indexOf(RED) < 0);
});

test("an edit approval.request with unchanged text renders no diff body either", () => {
  let f = editApprovalFrame("src/same.ts", "same", "same");
  let out = renderFrame(f, "");
  expect(out.indexOf(GREEN) < 0);
  expect(out.indexOf(RED) < 0);
  expect(out.indexOf("(y/n/a)") >= 0);
});
