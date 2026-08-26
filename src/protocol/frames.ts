export const PROTOCOL_VERSION: int = 1;

export const SESSION_HELLO: string = "session.hello";
export const TURN_START: string = "turn.start";
export const TEXT_DELTA: string = "text.delta";
export const TOOL_CALL: string = "tool.call";
export const TOOL_RESULT: string = "tool.result";
export const APPROVAL_REQUEST: string = "approval.request";
export const TURN_END: string = "turn.end";
export const ERROR: string = "error";
export const NOTICE: string = "notice";
export const INPUT: string = "input";
export const CANCEL: string = "cancel";
export const APPROVAL_REPLY: string = "approval.reply";
export const RESUME: string = "resume";
export const APPROVAL_REPLY_RESULT: string = "approval.reply.result";
export const APPROVAL_SETTLED: string = "approval.settled";
export const MODE_SET: string = "mode.set";
export const MODE_CHANGED: string = "mode.changed";
export const MODEL_SET: string = "model.set";
export const MODEL_CHANGED: string = "model.changed";
export const TASKS_REQUEST: string = "tasks.request";
export const TASKS_RESPONSE: string = "tasks.response";
export const DAEMON_STOP: string = "daemon.stop";
export const DAEMON_STOPPING: string = "daemon.stopping";
export const SHARE_REQUEST: string = "share.request";
export const SHARE_STARTED: string = "share.started";
export const SHARE_FAILED: string = "share.failed";

export const LEVEL_INFO: string = "info";
export const LEVEL_WARN: string = "warn";

export const REASON_DONE: string = "done";
export const REASON_CANCELLED: string = "cancelled";
export const REASON_ERROR: string = "error";

export const DECISION_ALLOW: string = "allow";
export const DECISION_DENY: string = "deny";
export const DECISION_ALWAYS: string = "always";

export const DECIDED_BY_PERSON: string = "person";
export const DECIDED_BY_MODE: string = "mode";

export type SessionHelloFrame = { v: int, seq: int, type: string, sessionId: string, workspace: string, model: string, mode: string, protocol: int, build: string };
export type TurnStartFrame = { v: int, seq: int, type: string, turnId: string, prompt: string };
export type TextDeltaFrame = { v: int, seq: int, type: string, turnId: string, text: string };
export type ToolCallFrame = { v: int, seq: int, type: string, turnId: string, callId: string, tool: string, args: string };
export type ToolResultFrame = { v: int, seq: int, type: string, turnId: string, callId: string, ok: bool, output: string, truncated: bool };
export type ApprovalRequestFrame = { v: int, seq: int, type: string, turnId: string, callId: string, tool: string, summary: string, detail: string, args: string };
export type TurnEndFrame = { v: int, seq: int, type: string, turnId: string, reason: string };
export type ErrorFrame = { v: int, seq: int, type: string, code: string, message: string };
export type NoticeFrame = { v: int, seq: int, type: string, code: string, level: string, message: string };

export type InputFrame = { v: int, seq: int, type: string, text: string };
export type CancelFrame = { v: int, seq: int, type: string, turnId: string };
export type ApprovalReplyFrame = { v: int, seq: int, type: string, callId: string, decision: string };
export type ResumeFrame = { v: int, seq: int, type: string, since: int };
export type ApprovalReplyResultFrame = { v: int, seq: int, type: string, callId: string, applied: bool, decision: string };
export type ApprovalSettledFrame = { v: int, seq: int, type: string, turnId: string, callId: string, summary: string, detail: string, decision: string, decidedBy: string };
export type ModeSetFrame = { v: int, seq: int, type: string, mode: string };
export type ModeChangedFrame = { v: int, seq: int, type: string, mode: string };
export type ModelSetFrame = { v: int, seq: int, type: string, model: string };
export type ModelChangedFrame = { v: int, seq: int, type: string, model: string };
export type TasksRequestFrame = { v: int, seq: int, type: string, arg: string };
export type TasksResponseFrame = { v: int, seq: int, type: string, text: string };
export type DaemonStopFrame = { v: int, seq: int, type: string };
export type DaemonStoppingFrame = { v: int, seq: int, type: string, reason: string };
export type ShareRequestFrame = { v: int, seq: int, type: string };
export type ShareStartedFrame = { v: int, seq: int, type: string, code: string, url: string };
export type ShareFailedFrame = { v: int, seq: int, type: string, error: string };

export function encodeSessionHello(f: SessionHelloFrame): string { return JSON.stringify(f); }
export function encodeTurnStart(f: TurnStartFrame): string { return JSON.stringify(f); }
export function encodeTextDelta(f: TextDeltaFrame): string { return JSON.stringify(f); }
export function encodeToolCall(f: ToolCallFrame): string { return JSON.stringify(f); }
export function encodeToolResult(f: ToolResultFrame): string { return JSON.stringify(f); }
export function encodeApprovalRequest(f: ApprovalRequestFrame): string { return JSON.stringify(f); }
export function encodeTurnEnd(f: TurnEndFrame): string { return JSON.stringify(f); }
export function encodeError(f: ErrorFrame): string { return JSON.stringify(f); }
export function encodeNotice(f: NoticeFrame): string { return JSON.stringify(f); }
export function encodeInput(f: InputFrame): string { return JSON.stringify(f); }
export function encodeCancel(f: CancelFrame): string { return JSON.stringify(f); }
export function encodeApprovalReply(f: ApprovalReplyFrame): string { return JSON.stringify(f); }
export function encodeResume(f: ResumeFrame): string { return JSON.stringify(f); }
export function encodeApprovalReplyResult(f: ApprovalReplyResultFrame): string { return JSON.stringify(f); }
export function encodeApprovalSettled(f: ApprovalSettledFrame): string { return JSON.stringify(f); }
export function encodeModeSet(f: ModeSetFrame): string { return JSON.stringify(f); }
export function encodeModeChanged(f: ModeChangedFrame): string { return JSON.stringify(f); }
export function encodeModelSet(f: ModelSetFrame): string { return JSON.stringify(f); }
export function encodeModelChanged(f: ModelChangedFrame): string { return JSON.stringify(f); }
export function encodeTasksRequest(f: TasksRequestFrame): string { return JSON.stringify(f); }
export function encodeTasksResponse(f: TasksResponseFrame): string { return JSON.stringify(f); }
export function encodeDaemonStop(f: DaemonStopFrame): string { return JSON.stringify(f); }
export function encodeDaemonStopping(f: DaemonStoppingFrame): string { return JSON.stringify(f); }
export function encodeShareRequest(f: ShareRequestFrame): string { return JSON.stringify(f); }
export function encodeShareStarted(f: ShareStartedFrame): string { return JSON.stringify(f); }
export function encodeShareFailed(f: ShareFailedFrame): string { return JSON.stringify(f); }

export function decodeSessionHello(text: string): SessionHelloFrame | null {
  try { return JSON.parse<SessionHelloFrame>(text); } catch { return null; }
}
export function decodeTurnStart(text: string): TurnStartFrame | null {
  try { return JSON.parse<TurnStartFrame>(text); } catch { return null; }
}
export function decodeTextDelta(text: string): TextDeltaFrame | null {
  try { return JSON.parse<TextDeltaFrame>(text); } catch { return null; }
}
export function decodeToolCall(text: string): ToolCallFrame | null {
  try { return JSON.parse<ToolCallFrame>(text); } catch { return null; }
}
export function decodeToolResult(text: string): ToolResultFrame | null {
  try { return JSON.parse<ToolResultFrame>(text); } catch { return null; }
}
export function decodeApprovalRequest(text: string): ApprovalRequestFrame | null {
  try { return JSON.parse<ApprovalRequestFrame>(text); } catch { return null; }
}
export function decodeTurnEnd(text: string): TurnEndFrame | null {
  try { return JSON.parse<TurnEndFrame>(text); } catch { return null; }
}
export function decodeError(text: string): ErrorFrame | null {
  try { return JSON.parse<ErrorFrame>(text); } catch { return null; }
}
export function decodeNotice(text: string): NoticeFrame | null {
  try { return JSON.parse<NoticeFrame>(text); } catch { return null; }
}
export function decodeInput(text: string): InputFrame | null {
  try { return JSON.parse<InputFrame>(text); } catch { return null; }
}
export function decodeCancel(text: string): CancelFrame | null {
  try { return JSON.parse<CancelFrame>(text); } catch { return null; }
}
export function decodeApprovalReply(text: string): ApprovalReplyFrame | null {
  try { return JSON.parse<ApprovalReplyFrame>(text); } catch { return null; }
}
export function decodeResume(text: string): ResumeFrame | null {
  try { return JSON.parse<ResumeFrame>(text); } catch { return null; }
}
export function decodeApprovalReplyResult(text: string): ApprovalReplyResultFrame | null {
  try { return JSON.parse<ApprovalReplyResultFrame>(text); } catch { return null; }
}
export function decodeModeSet(text: string): ModeSetFrame | null {
  try { return JSON.parse<ModeSetFrame>(text); } catch { return null; }
}
export function decodeModeChanged(text: string): ModeChangedFrame | null {
  try { return JSON.parse<ModeChangedFrame>(text); } catch { return null; }
}
export function decodeModelSet(text: string): ModelSetFrame | null {
  try { return JSON.parse<ModelSetFrame>(text); } catch { return null; }
}
export function decodeModelChanged(text: string): ModelChangedFrame | null {
  try { return JSON.parse<ModelChangedFrame>(text); } catch { return null; }
}
export function decodeTasksRequest(text: string): TasksRequestFrame | null {
  try { return JSON.parse<TasksRequestFrame>(text); } catch { return null; }
}
export function decodeTasksResponse(text: string): TasksResponseFrame | null {
  try { return JSON.parse<TasksResponseFrame>(text); } catch { return null; }
}
export function decodeDaemonStop(text: string): DaemonStopFrame | null {
  try { return JSON.parse<DaemonStopFrame>(text); } catch { return null; }
}
export function decodeDaemonStopping(text: string): DaemonStoppingFrame | null {
  try { return JSON.parse<DaemonStoppingFrame>(text); } catch { return null; }
}
export function decodeShareRequest(text: string): ShareRequestFrame | null {
  try { return JSON.parse<ShareRequestFrame>(text); } catch { return null; }
}
export function decodeShareStarted(text: string): ShareStartedFrame | null {
  try { return JSON.parse<ShareStartedFrame>(text); } catch { return null; }
}
export function decodeShareFailed(text: string): ShareFailedFrame | null {
  try { return JSON.parse<ShareFailedFrame>(text); } catch { return null; }
}

function rawFieldValue(body: string, key: string): string {
  let mark = "\"" + key + "\"";
  let at = body.indexOf(mark);
  if (at < 0) { return ""; }
  let colon = body.indexOf(":", at + mark.length);
  if (colon < 0) { return ""; }
  let i = colon + 1;
  while (i < body.length && (body.charAt(i) == " " || body.charAt(i) == "\n" || body.charAt(i) == "\t")) {
    i = i + 1;
  }
  if (i >= body.length) { return ""; }
  if (body.charAt(i) == "\"") {
    let out = "";
    let j = i + 1;
    while (j < body.length) {
      let c = body.charAt(j);
      if (c == "\\") { out = out + body.charAt(j + 1); j = j + 2; continue; }
      if (c == "\"") { return out; }
      out = out + c;
      j = j + 1;
    }
    return "";
  }
  let end = i;
  while (end < body.length) {
    let c = body.charAt(end);
    if (c == "," || c == "}" || c == "\n" || c == " ") { break; }
    end = end + 1;
  }
  return body.slice(i, end);
}

function parseNonNegativeInt(s: string, fallback: int): int {
  if (s == "") { return fallback; }
  let out: int = 0;
  let i: int = 0;
  while (i < s.length) {
    let c = s.charAt(i);
    let code = c.charCodeAt(0) - "0".charCodeAt(0);
    if (code < 0 || code > 9) { return fallback; }
    out = out * 10 + code;
    i = i + 1;
  }
  return out;
}

export function frameType(text: string): string {
  return rawFieldValue(text, "type");
}

export function frameVersion(text: string): int {
  return parseNonNegativeInt(rawFieldValue(text, "v"), -1);
}

export function frameSeq(text: string): int {
  return parseNonNegativeInt(rawFieldValue(text, "seq"), -1);
}

export function frameTurnId(text: string): string {
  return rawFieldValue(text, "turnId");
}

export function errorFrameCode(text: string): string {
  return rawFieldValue(text, "code");
}

export function helloFrameWorkspace(text: string): string {
  return rawFieldValue(text, "workspace");
}

export function helloFrameBuild(text: string): string {
  return rawFieldValue(text, "build");
}

export function modeSetFrameMode(text: string): string {
  return rawFieldValue(text, "mode");
}

export function modelSetFrameModel(text: string): string {
  return rawFieldValue(text, "model");
}

export function tasksRequestFrameArg(text: string): string {
  return rawFieldValue(text, "arg");
}

export function isSupportedVersion(v: int): bool {
  return v == PROTOCOL_VERSION;
}

export function isKnownType(t: string): bool {
  if (t == SESSION_HELLO || t == TURN_START || t == TEXT_DELTA || t == TOOL_CALL) { return true; }
  if (t == TOOL_RESULT || t == APPROVAL_REQUEST || t == TURN_END || t == ERROR) { return true; }
  if (t == INPUT || t == CANCEL || t == APPROVAL_REPLY || t == RESUME) { return true; }
  if (t == APPROVAL_REPLY_RESULT || t == APPROVAL_SETTLED) { return true; }
  if (t == MODE_SET || t == MODE_CHANGED || t == MODEL_SET || t == MODEL_CHANGED) { return true; }
  if (t == TASKS_REQUEST || t == TASKS_RESPONSE || t == DAEMON_STOP || t == DAEMON_STOPPING) { return true; }
  if (t == SHARE_REQUEST || t == SHARE_STARTED || t == SHARE_FAILED) { return true; }
  if (t == NOTICE) { return true; }
  return false;
}

export function noticeFrame(code: string, level: string, message: string): NoticeFrame {
  let f: NoticeFrame = { v: PROTOCOL_VERSION, seq: 0, type: NOTICE, code: code, level: level, message: message };
  return f;
}

export function isWarning(level: string): bool {
  return level == LEVEL_WARN;
}

export function hasSeqGap(lastSeq: int, seq: int): bool {
  return seq != lastSeq + 1;
}
