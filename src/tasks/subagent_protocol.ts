export type SubagentToolCallPayload = { callId: string, tool: string, args: string };
export type SubagentToolResultPayload = { callId: string, ok: bool, output: string, truncated: bool };
export type SubagentApprovalPayload = { callId: string, tool: string, summary: string, detail: string, args: string };
export type SubagentErrorPayload = { code: string, message: string };

export type DecodedToolCall = { found: bool, value: SubagentToolCallPayload };
export type DecodedToolResult = { found: bool, value: SubagentToolResultPayload };
export type DecodedApproval = { found: bool, value: SubagentApprovalPayload };
export type DecodedError = { found: bool, value: SubagentErrorPayload };

export const TAG_DELTA: string = "DELTA";
export const TAG_TOOLCALL: string = "TOOLCALL";
export const TAG_TOOLRESULT: string = "TOOLRESULT";
export const TAG_APPROVAL_REQUEST: string = "APPROVAL_REQUEST";
export const TAG_ERROR: string = "ERROR";
export const TAG_DONE: string = "DONE";
export const TAG_CANCELLED: string = "CANCELLED";

function emptyToolCall(): SubagentToolCallPayload {
  return { callId: "", tool: "", args: "" };
}

function emptyToolResult(): SubagentToolResultPayload {
  return { callId: "", ok: false, output: "", truncated: false };
}

function emptyApproval(): SubagentApprovalPayload {
  return { callId: "", tool: "", summary: "", detail: "", args: "" };
}

function emptyError(): SubagentErrorPayload {
  return { code: "", message: "" };
}

export function encodeSubagentToolCallPayload(p: SubagentToolCallPayload): string {
  return JSON.stringify(p);
}

export function encodeSubagentToolResultPayload(p: SubagentToolResultPayload): string {
  return JSON.stringify(p);
}

export function encodeSubagentApprovalPayload(p: SubagentApprovalPayload): string {
  return JSON.stringify(p);
}

export function encodeSubagentErrorPayload(p: SubagentErrorPayload): string {
  return JSON.stringify(p);
}

export function decodeSubagentToolCallPayload(text: string): DecodedToolCall {
  try {
    let v = JSON.parse<SubagentToolCallPayload>(text);
    let r: DecodedToolCall = { found: true, value: v };
    return r;
  } catch {
    let r: DecodedToolCall = { found: false, value: emptyToolCall() };
    return r;
  }
}

export function decodeSubagentToolResultPayload(text: string): DecodedToolResult {
  try {
    let v = JSON.parse<SubagentToolResultPayload>(text);
    let r: DecodedToolResult = { found: true, value: v };
    return r;
  } catch {
    let r: DecodedToolResult = { found: false, value: emptyToolResult() };
    return r;
  }
}

export function decodeSubagentApprovalPayload(text: string): DecodedApproval {
  try {
    let v = JSON.parse<SubagentApprovalPayload>(text);
    let r: DecodedApproval = { found: true, value: v };
    return r;
  } catch {
    let r: DecodedApproval = { found: false, value: emptyApproval() };
    return r;
  }
}

export function decodeSubagentErrorPayload(text: string): DecodedError {
  try {
    let v = JSON.parse<SubagentErrorPayload>(text);
    let r: DecodedError = { found: true, value: v };
    return r;
  } catch {
    let r: DecodedError = { found: false, value: emptyError() };
    return r;
  }
}
