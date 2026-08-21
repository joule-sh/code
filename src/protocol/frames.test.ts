import { PROTOCOL_VERSION, SESSION_HELLO, TURN_START, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR, INPUT, CANCEL, APPROVAL_REPLY, RESUME, REASON_DONE, DECISION_ALLOW, SessionHelloFrame, TurnStartFrame, TextDeltaFrame, ToolCallFrame, ToolResultFrame, ApprovalRequestFrame, TurnEndFrame, ErrorFrame, InputFrame, CancelFrame, ApprovalReplyFrame, ResumeFrame, encodeSessionHello, decodeSessionHello, encodeTurnStart, decodeTurnStart, encodeTextDelta, decodeTextDelta, encodeToolCall, decodeToolCall, encodeToolResult, decodeToolResult, encodeApprovalRequest, decodeApprovalRequest, encodeTurnEnd, decodeTurnEnd, encodeError, decodeError, encodeInput, decodeInput, encodeCancel, decodeCancel, encodeApprovalReply, decodeApprovalReply, encodeResume, decodeResume, frameType, frameVersion, frameSeq, isSupportedVersion, isKnownType, hasSeqGap } from "./frames.ts";

test("SESSION_HELLO round-trips", () => {
  let f: SessionHelloFrame = { v: PROTOCOL_VERSION, seq: 1, type: SESSION_HELLO, sessionId: "s1", workspace: "/repo", model: "gpt", mode: "agent", protocol: 1 };
  let text = encodeSessionHello(f);
  let back = decodeSessionHello(text);
  expect(back != null);
  expect(back!.sessionId == "s1");
  expect(back!.type == SESSION_HELLO);
});

test("TURN_START round-trips", () => {
  let f: TurnStartFrame = { v: PROTOCOL_VERSION, seq: 2, type: TURN_START, turnId: "t1", prompt: "add a test" };
  let back = decodeTurnStart(encodeTurnStart(f));
  expect(back != null);
  expect(back!.prompt == "add a test");
});

test("TEXT_DELTA round-trips", () => {
  let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: 3, type: TEXT_DELTA, turnId: "t1", text: "hello" };
  let back = decodeTextDelta(encodeTextDelta(f));
  expect(back != null);
  expect(back!.text == "hello");
});

test("TOOL_CALL round-trips", () => {
  let f: ToolCallFrame = { v: PROTOCOL_VERSION, seq: 4, type: TOOL_CALL, turnId: "t1", callId: "c1", tool: "read_file", args: "{\"path\":\"a.ts\"}" };
  let back = decodeToolCall(encodeToolCall(f));
  expect(back != null);
  expect(back!.tool == "read_file");
});

test("TOOL_RESULT round-trips", () => {
  let f: ToolResultFrame = { v: PROTOCOL_VERSION, seq: 5, type: TOOL_RESULT, turnId: "t1", callId: "c1", ok: true, output: "done", truncated: false };
  let back = decodeToolResult(encodeToolResult(f));
  expect(back != null);
  expect(back!.ok);
  expect(!back!.truncated);
});

test("APPROVAL_REQUEST round-trips", () => {
  let f: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: 6, type: APPROVAL_REQUEST, turnId: "t1", callId: "c1", tool: "run", summary: "run tests", detail: "npm test", args: "{\"command\":\"npm test\"}" };
  let back = decodeApprovalRequest(encodeApprovalRequest(f));
  expect(back != null);
  expect(back!.summary == "run tests");
});

test("TURN_END round-trips", () => {
  let f: TurnEndFrame = { v: PROTOCOL_VERSION, seq: 7, type: TURN_END, turnId: "t1", reason: REASON_DONE };
  let back = decodeTurnEnd(encodeTurnEnd(f));
  expect(back != null);
  expect(back!.reason == REASON_DONE);
});

test("error round-trips", () => {
  let f: ErrorFrame = { v: PROTOCOL_VERSION, seq: 8, type: ERROR, code: "E_BAD", message: "bad" };
  let back = decodeError(encodeError(f));
  expect(back != null);
  expect(back!.code == "E_BAD");
});

test("input round-trips", () => {
  let f: InputFrame = { v: PROTOCOL_VERSION, seq: 9, type: INPUT, text: "hi" };
  let back = decodeInput(encodeInput(f));
  expect(back != null);
  expect(back!.text == "hi");
});

test("cancel round-trips", () => {
  let f: CancelFrame = { v: PROTOCOL_VERSION, seq: 10, type: CANCEL, turnId: "t1" };
  let back = decodeCancel(encodeCancel(f));
  expect(back != null);
  expect(back!.turnId == "t1");
});

test("APPROVAL_REPLY round-trips", () => {
  let f: ApprovalReplyFrame = { v: PROTOCOL_VERSION, seq: 11, type: APPROVAL_REPLY, callId: "c1", decision: DECISION_ALLOW };
  let back = decodeApprovalReply(encodeApprovalReply(f));
  expect(back != null);
  expect(back!.decision == DECISION_ALLOW);
});

test("resume round-trips", () => {
  let f: ResumeFrame = { v: PROTOCOL_VERSION, seq: 12, type: RESUME, since: 41 };
  let back = decodeResume(encodeResume(f));
  expect(back != null);
  expect(back!.since == 41);
});

test("unknown frame type is not fatal", () => {
  let text = "{\"v\":1,\"seq\":1,\"type\":\"some.future.frame\",\"whatever\":true}";
  expect(frameType(text) == "some.future.frame");
  expect(!isKnownType(frameType(text)));
});

test("a newer protocol version is recognised, not guessed at", () => {
  let text = "{\"v\":99,\"seq\":1,\"type\":\"" + SESSION_HELLO + "\"}";
  expect(frameVersion(text) == 99);
  expect(!isSupportedVersion(frameVersion(text)));
  expect(isSupportedVersion(PROTOCOL_VERSION));
});

test("a malformed payload is rejected without throwing", () => {
  expect(decodeSessionHello("not json") == null);
  expect(decodeSessionHello("{\"v\":1") == null);
  expect(decodeTurnStart("{\"v\":1,\"seq\":1,\"type\":\"" + TURN_START + "\",\"turnId\":\"t1\",\"prompt\":\"x\",\"extra\":true}") == null);
});

test("seq gaps are detectable", () => {
  expect(!hasSeqGap(5, 6));
  expect(hasSeqGap(5, 8));
  expect(hasSeqGap(5, 5));
});

test("frameSeq reads the envelope seq generically", () => {
  let text = "{\"v\":1,\"seq\":42,\"type\":\"input\",\"text\":\"hi\"}";
  expect(frameSeq(text) == 42);
});
