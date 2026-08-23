import { PROTOCOL_VERSION, SESSION_HELLO, TURN_START, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR, INPUT, CANCEL, APPROVAL_REPLY, RESUME, REASON_DONE, DECISION_ALLOW, MODE_SET, MODE_CHANGED, MODEL_SET, MODEL_CHANGED, TASKS_REQUEST, TASKS_RESPONSE, DAEMON_STOP, DAEMON_STOPPING, SHARE_REQUEST, SHARE_STARTED, SHARE_FAILED, SessionHelloFrame, TurnStartFrame, TextDeltaFrame, ToolCallFrame, ToolResultFrame, ApprovalRequestFrame, TurnEndFrame, ErrorFrame, InputFrame, CancelFrame, ApprovalReplyFrame, ResumeFrame, ModeSetFrame, ModeChangedFrame, ModelSetFrame, ModelChangedFrame, TasksRequestFrame, TasksResponseFrame, DaemonStopFrame, DaemonStoppingFrame, ShareRequestFrame, ShareStartedFrame, ShareFailedFrame, encodeSessionHello, decodeSessionHello, encodeTurnStart, decodeTurnStart, encodeTextDelta, decodeTextDelta, encodeToolCall, decodeToolCall, encodeToolResult, decodeToolResult, encodeApprovalRequest, decodeApprovalRequest, encodeTurnEnd, decodeTurnEnd, encodeError, decodeError, encodeInput, decodeInput, encodeCancel, decodeCancel, encodeApprovalReply, decodeApprovalReply, encodeResume, decodeResume, encodeModeSet, decodeModeSet, encodeModeChanged, decodeModeChanged, encodeModelSet, decodeModelSet, encodeModelChanged, decodeModelChanged, encodeTasksRequest, decodeTasksRequest, encodeTasksResponse, decodeTasksResponse, encodeDaemonStop, decodeDaemonStop, encodeDaemonStopping, decodeDaemonStopping, encodeShareRequest, decodeShareRequest, encodeShareStarted, decodeShareStarted, encodeShareFailed, decodeShareFailed, frameType, frameVersion, frameSeq, frameTurnId, isSupportedVersion, isKnownType, hasSeqGap } from "./frames.ts";

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

test("MODE_SET round-trips", () => {
  let f: ModeSetFrame = { v: PROTOCOL_VERSION, seq: 13, type: MODE_SET, mode: "full-auto" };
  let back = decodeModeSet(encodeModeSet(f));
  expect(back != null);
  expect(back!.mode == "full-auto");
});

test("MODE_CHANGED round-trips", () => {
  let f: ModeChangedFrame = { v: PROTOCOL_VERSION, seq: 14, type: MODE_CHANGED, mode: "read-only" };
  let back = decodeModeChanged(encodeModeChanged(f));
  expect(back != null);
  expect(back!.mode == "read-only");
});

test("MODEL_SET round-trips", () => {
  let f: ModelSetFrame = { v: PROTOCOL_VERSION, seq: 15, type: MODEL_SET, model: "gpt-5" };
  let back = decodeModelSet(encodeModelSet(f));
  expect(back != null);
  expect(back!.model == "gpt-5");
});

test("MODEL_CHANGED round-trips", () => {
  let f: ModelChangedFrame = { v: PROTOCOL_VERSION, seq: 16, type: MODEL_CHANGED, model: "gpt-5" };
  let back = decodeModelChanged(encodeModelChanged(f));
  expect(back != null);
  expect(back!.model == "gpt-5");
});

test("TASKS_REQUEST round-trips", () => {
  let f: TasksRequestFrame = { v: PROTOCOL_VERSION, seq: 17, type: TASKS_REQUEST, arg: "cancel bgrun-1" };
  let back = decodeTasksRequest(encodeTasksRequest(f));
  expect(back != null);
  expect(back!.arg == "cancel bgrun-1");
});

test("TASKS_RESPONSE round-trips", () => {
  let f: TasksResponseFrame = { v: PROTOCOL_VERSION, seq: 18, type: TASKS_RESPONSE, text: "no background tasks" };
  let back = decodeTasksResponse(encodeTasksResponse(f));
  expect(back != null);
  expect(back!.text == "no background tasks");
});

test("DAEMON_STOP round-trips", () => {
  let f: DaemonStopFrame = { v: PROTOCOL_VERSION, seq: 19, type: DAEMON_STOP };
  let back = decodeDaemonStop(encodeDaemonStop(f));
  expect(back != null);
  expect(back!.type == DAEMON_STOP);
});

test("DAEMON_STOPPING round-trips", () => {
  let f: DaemonStoppingFrame = { v: PROTOCOL_VERSION, seq: 20, type: DAEMON_STOPPING, reason: "an attached client asked the daemon to stop" };
  let back = decodeDaemonStopping(encodeDaemonStopping(f));
  expect(back != null);
  expect(back!.reason == "an attached client asked the daemon to stop");
});

test("SHARE_REQUEST round-trips", () => {
  let f: ShareRequestFrame = { v: PROTOCOL_VERSION, seq: 21, type: SHARE_REQUEST };
  let back = decodeShareRequest(encodeShareRequest(f));
  expect(back != null);
  expect(back!.type == SHARE_REQUEST);
});

test("SHARE_STARTED round-trips", () => {
  let f: ShareStartedFrame = { v: PROTOCOL_VERSION, seq: 22, type: SHARE_STARTED, code: "ABCDEF", url: "https://joule.sh/w/ABCDEF" };
  let back = decodeShareStarted(encodeShareStarted(f));
  expect(back != null);
  expect(back!.code == "ABCDEF");
  expect(back!.url == "https://joule.sh/w/ABCDEF");
});

test("SHARE_FAILED round-trips", () => {
  let f: ShareFailedFrame = { v: PROTOCOL_VERSION, seq: 23, type: SHARE_FAILED, error: "relay refused: 503" };
  let back = decodeShareFailed(encodeShareFailed(f));
  expect(back != null);
  expect(back!.error == "relay refused: 503");
});

test("the new session-state and lifecycle frame types are known", () => {
  expect(isKnownType(MODE_SET));
  expect(isKnownType(MODE_CHANGED));
  expect(isKnownType(MODEL_SET));
  expect(isKnownType(MODEL_CHANGED));
  expect(isKnownType(TASKS_REQUEST));
  expect(isKnownType(TASKS_RESPONSE));
  expect(isKnownType(DAEMON_STOP));
  expect(isKnownType(DAEMON_STOPPING));
  expect(isKnownType(SHARE_REQUEST));
  expect(isKnownType(SHARE_STARTED));
  expect(isKnownType(SHARE_FAILED));
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

test("frameTurnId reads the turnId field generically, empty when absent", () => {
  let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: 6, type: TEXT_DELTA, turnId: "bg:bgrun-1", text: "hi" };
  expect(frameTurnId(encodeTextDelta(f)) == "bg:bgrun-1");
  let noTurn = "{\"v\":1,\"seq\":1,\"type\":\"error\",\"code\":\"E\",\"message\":\"m\"}";
  expect(frameTurnId(noTurn) == "");
});
