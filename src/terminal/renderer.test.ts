import { renderFrame, approvalOptionsFor, approvalOptionLabel, approvalOptionRow, approvalOptionsBlock } from "./renderer.ts";
import { fixtureScript } from "./fixture.ts";
import { frameType, TEXT_DELTA, PROTOCOL_VERSION, TOOL_CALL, APPROVAL_REQUEST, ToolCallFrame, ApprovalRequestFrame, encodeToolCall, encodeApprovalRequest, encodeNotice, noticeFrame, LEVEL_INFO, LEVEL_WARN } from "../protocol/frames.ts";
import { GREEN, RED, DIM, REVERSE, RESET } from "./style.ts";
import { APPROVAL_OPTION_ALLOW, APPROVAL_OPTION_ALWAYS, APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT } from "./input_state.ts";

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
  let out = renderFrame(f, "") + approvalOptionsFor(f);
  expect(out.indexOf("run npm test") >= 0);
  expect(out.indexOf("1. Yes") >= 0);
  expect(out.indexOf("2. Yes, and don't ask again for run this session") >= 0);
  expect(out.indexOf("3. No") >= 0);
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

test("an edit approval.request renders the diff above the option list, before any answer is given", () => {
  let f = editApprovalFrame("src/a.ts", "const x = 1;", "const x = 2;");
  let out = renderFrame(f, "") + approvalOptionsFor(f);
  let diffAt = out.indexOf(RED + "- const x = 1;");
  let decisionAt = out.indexOf("1. Yes");
  expect(diffAt >= 0);
  expect(decisionAt >= 0);
  expect(diffAt < decisionAt);
  expect(out.indexOf(GREEN + "+ const x = 2;") >= 0);
});

test("a write approval.request renders the diff above the option list", () => {
  let f = writeApprovalFrame("src/new.ts", "line one\nline two");
  let out = renderFrame(f, "") + approvalOptionsFor(f);
  let diffAt = out.indexOf(GREEN + "+ line one");
  let decisionAt = out.indexOf("1. Yes");
  expect(diffAt >= 0);
  expect(decisionAt >= 0);
  expect(diffAt < decisionAt);
});

test("a run approval.request renders no diff, just the plain summary and the option list", () => {
  let f = runApprovalFrame("npm test");
  let out = renderFrame(f, "") + approvalOptionsFor(f);
  expect(out.indexOf("run npm test") >= 0);
  expect(out.indexOf("1. Yes") >= 0);
  expect(out.indexOf(GREEN) < 0);
  expect(out.indexOf(RED) < 0);
});

test("an edit approval.request with unchanged text renders no diff body either", () => {
  let f = editApprovalFrame("src/same.ts", "same", "same");
  let out = renderFrame(f, "") + approvalOptionsFor(f);
  expect(out.indexOf(GREEN) < 0);
  expect(out.indexOf(RED) < 0);
  expect(out.indexOf("1. Yes") >= 0);
});

test("the option list names the tool in the always option, so option 2 says what it will stop asking about", () => {
  expect(approvalOptionLabel(APPROVAL_OPTION_ALLOW, "run") == "1. Yes");
  expect(approvalOptionLabel(APPROVAL_OPTION_ALWAYS, "run") == "2. Yes, and don't ask again for run this session");
  expect(approvalOptionLabel(APPROVAL_OPTION_ALWAYS, "edit") == "2. Yes, and don't ask again for edit this session");
  expect(approvalOptionLabel(APPROVAL_OPTION_DENY, "run") == "3. No");
});

test("the highlighted option row is reverse video with a marker, the others are dim without one", () => {
  let selected = approvalOptionRow(APPROVAL_OPTION_ALLOW, APPROVAL_OPTION_ALLOW, "run");
  let other = approvalOptionRow(APPROVAL_OPTION_DENY, APPROVAL_OPTION_ALLOW, "run");
  expect(selected == "    " + REVERSE + "> 1. Yes" + RESET);
  expect(other == "    " + DIM + "  3. No" + RESET);
});

test("every option row closes its own colour so repainting one row cannot bleed into the next", () => {
  let i = 0;
  while (i < APPROVAL_OPTION_COUNT) {
    let row = approvalOptionRow(i, APPROVAL_OPTION_ALWAYS, "run");
    expect(row.slice(row.length - RESET.length, row.length) == RESET);
    i = i + 1;
  }
});

test("the option block is one row per option, each on its own line, highlighting only the selection", () => {
  let block = approvalOptionsBlock("run", APPROVAL_OPTION_DENY);
  let lines = block.split("\n");
  expect(lines.length == APPROVAL_OPTION_COUNT + 1);
  expect(lines[0] == "");
  expect(lines[1].indexOf(REVERSE) < 0);
  expect(lines[2].indexOf(REVERSE) < 0);
  expect(lines[3].indexOf(REVERSE) >= 0);
  expect(lines[3].indexOf("3. No") >= 0);
});

test("an approval.request highlights the first option by default so Enter on an untouched prompt allows", () => {
  let out = approvalOptionsFor(runApprovalFrame("npm test"));
  expect(out.indexOf(REVERSE + "> 1. Yes") >= 0);
  expect(out.indexOf(REVERSE + "> 3. No") < 0);
});

function noticeJson(code: string, level: string, message: string): string {
  return encodeNotice(noticeFrame(code, level, message));
}

test("a warning notice renders with the ! marker, so something worth seeing still stands out", () => {
  let out = renderFrame(noticeJson("daemon.unreachable", LEVEL_WARN, "cannot reach the daemon (closed), still retrying"), "");
  expect(out.indexOf("! cannot reach the daemon") >= 0);
});

test("an informational notice renders as a plain line, with no error marker at all", () => {
  let out = renderFrame(noticeJson("daemon.attached", LEVEL_INFO, "connected to the daemon"), "");
  expect(out.indexOf("!") < 0);
  expect(out.indexOf("connected to the daemon") >= 0);
});

test("a notice never renders the code, which belongs in the log rather than on the first screen", () => {
  let out = renderFrame(noticeJson("relay.buffer_overflow", LEVEL_WARN, "the buffer overflowed"), "");
  expect(out.indexOf("relay.buffer_overflow") < 0);
});
