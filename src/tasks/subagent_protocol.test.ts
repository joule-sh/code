import { SubagentToolCallPayload, SubagentToolResultPayload, SubagentApprovalPayload, SubagentErrorPayload, encodeSubagentToolCallPayload, encodeSubagentToolResultPayload, encodeSubagentApprovalPayload, encodeSubagentErrorPayload, decodeSubagentToolCallPayload, decodeSubagentToolResultPayload, decodeSubagentApprovalPayload, decodeSubagentErrorPayload } from "./subagent_protocol.ts";

test("a tool call payload round-trips through encode and decode", () => {
  let p: SubagentToolCallPayload = { callId: "1", tool: "run", args: "{\"command\":\"ls\"}" };
  let text = encodeSubagentToolCallPayload(p);
  let d = decodeSubagentToolCallPayload(text);
  expect(d.found);
  expect(d.value.callId == "1");
  expect(d.value.tool == "run");
  expect(d.value.args == "{\"command\":\"ls\"}");
});

test("a tool result payload round-trips, including a false ok and truncated flag", () => {
  let p: SubagentToolResultPayload = { callId: "2", ok: false, output: "no match found", truncated: true };
  let text = encodeSubagentToolResultPayload(p);
  let d = decodeSubagentToolResultPayload(text);
  expect(d.found);
  expect(!d.value.ok);
  expect(d.value.truncated);
  expect(d.value.output == "no match found");
});

test("an approval payload round-trips every field", () => {
  let p: SubagentApprovalPayload = { callId: "3", tool: "write", summary: "write a.ts", detail: "write a.ts", args: "{\"path\":\"a.ts\",\"content\":\"x\"}" };
  let text = encodeSubagentApprovalPayload(p);
  let d = decodeSubagentApprovalPayload(text);
  expect(d.found);
  expect(d.value.tool == "write");
  expect(d.value.args == "{\"path\":\"a.ts\",\"content\":\"x\"}");
});

test("an error payload round-trips code and message", () => {
  let p: SubagentErrorPayload = { code: "E_STREAM", message: "connection reset" };
  let text = encodeSubagentErrorPayload(p);
  let d = decodeSubagentErrorPayload(text);
  expect(d.found);
  expect(d.value.code == "E_STREAM");
  expect(d.value.message == "connection reset");
});

test("decoding malformed json sets found to false rather than throwing", () => {
  expect(!decodeSubagentToolCallPayload("not json").found);
  expect(!decodeSubagentToolResultPayload("{broken").found);
  expect(!decodeSubagentApprovalPayload("").found);
  expect(!decodeSubagentErrorPayload("42").found);
});
