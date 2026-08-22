export const PROTOCOL_VERSION: int = 1;

export const SESSION_HELLO: string = "session.hello";
export const TURN_START: string = "turn.start";
export const TEXT_DELTA: string = "text.delta";
export const TOOL_CALL: string = "tool.call";
export const TOOL_RESULT: string = "tool.result";
export const APPROVAL_REQUEST: string = "approval.request";
export const TURN_END: string = "turn.end";
export const ERROR: string = "error";
export const INPUT: string = "input";
export const CANCEL: string = "cancel";
export const APPROVAL_REPLY: string = "approval.reply";
export const RESUME: string = "resume";
export const APPROVAL_REPLY_RESULT: string = "approval.reply.result";

export const REASON_DONE: string = "done";
export const REASON_CANCELLED: string = "cancelled";
export const REASON_ERROR: string = "error";

export const DECISION_ALLOW: string = "allow";
export const DECISION_DENY: string = "deny";
export const DECISION_ALWAYS: string = "always";

export type SessionHelloFrame = { v: int, seq: int, type: string, sessionId: string, workspace: string, model: string, mode: string, protocol: int };
export type TurnStartFrame = { v: int, seq: int, type: string, turnId: string, prompt: string };
export type TextDeltaFrame = { v: int, seq: int, type: string, turnId: string, text: string };
export type ToolCallFrame = { v: int, seq: int, type: string, turnId: string, callId: string, tool: string, args: string };
export type ToolResultFrame = { v: int, seq: int, type: string, turnId: string, callId: string, ok: bool, output: string, truncated: bool };
export type ApprovalRequestFrame = { v: int, seq: int, type: string, turnId: string, callId: string, tool: string, summary: string, detail: string, args: string };
export type TurnEndFrame = { v: int, seq: int, type: string, turnId: string, reason: string };
export type ErrorFrame = { v: int, seq: int, type: string, code: string, message: string };

export type InputFrame = { v: int, seq: int, type: string, text: string };
export type CancelFrame = { v: int, seq: int, type: string, turnId: string };
export type ApprovalReplyFrame = { v: int, seq: int, type: string, callId: string, decision: string };
export type ResumeFrame = { v: int, seq: int, type: string, since: int };
export type ApprovalReplyResultFrame = { v: int, seq: int, type: string, callId: string, applied: bool, decision: string };

export function encodeSessionHello(f: SessionHelloFrame): string { return JSON.stringify(f); }
export function encodeTurnStart(f: TurnStartFrame): string { return JSON.stringify(f); }
export function encodeTextDelta(f: TextDeltaFrame): string { return JSON.stringify(f); }
export function encodeToolCall(f: ToolCallFrame): string { return JSON.stringify(f); }
export function encodeToolResult(f: ToolResultFrame): string { return JSON.stringify(f); }
export function encodeApprovalRequest(f: ApprovalRequestFrame): string { return JSON.stringify(f); }
export function encodeTurnEnd(f: TurnEndFrame): string { return JSON.stringify(f); }
export function encodeError(f: ErrorFrame): string { return JSON.stringify(f); }
export function encodeInput(f: InputFrame): string { return JSON.stringify(f); }
export function encodeCancel(f: CancelFrame): string { return JSON.stringify(f); }
export function encodeApprovalReply(f: ApprovalReplyFrame): string { return JSON.stringify(f); }
export function encodeResume(f: ResumeFrame): string { return JSON.stringify(f); }
export function encodeApprovalReplyResult(f: ApprovalReplyResultFrame): string { return JSON.stringify(f); }

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

export function isSupportedVersion(v: int): bool {
  return v == PROTOCOL_VERSION;
}

export function isKnownType(t: string): bool {
  if (t == SESSION_HELLO || t == TURN_START || t == TEXT_DELTA || t == TOOL_CALL) { return true; }
  if (t == TOOL_RESULT || t == APPROVAL_REQUEST || t == TURN_END || t == ERROR) { return true; }
  if (t == INPUT || t == CANCEL || t == APPROVAL_REPLY || t == RESUME) { return true; }
  if (t == APPROVAL_REPLY_RESULT) { return true; }
  return false;
}

export function hasSeqGap(lastSeq: int, seq: int): bool {
  return seq != lastSeq + 1;
}
