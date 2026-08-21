import { PROTOCOL_VERSION, TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, ToolCallFrame, ToolResultFrame, ApprovalRequestFrame, encodeToolCall, encodeToolResult, encodeApprovalRequest } from "../protocol/frames.ts";
import { Session } from "../session/session.ts";
import { SubagentTask } from "./state.ts";
import { DecodedApproval, decodeSubagentToolCallPayload, decodeSubagentToolResultPayload, decodeSubagentApprovalPayload } from "./subagent_protocol.ts";

export function emitAgentToolCall(session: Session, t: SubagentTask, turnId: string, payload: string): void {
  let d = decodeSubagentToolCallPayload(payload);
  if (!d.found) { return; }
  let f: ToolCallFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TOOL_CALL, turnId: turnId, callId: t.id + ":" + d.value.callId, tool: d.value.tool, args: d.value.args };
  session.emit(encodeToolCall(f));
}

export function emitAgentToolResult(session: Session, t: SubagentTask, turnId: string, payload: string): void {
  let d = decodeSubagentToolResultPayload(payload);
  if (!d.found) { return; }
  let f: ToolResultFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TOOL_RESULT, turnId: turnId, callId: t.id + ":" + d.value.callId, ok: d.value.ok, output: d.value.output, truncated: d.value.truncated };
  session.emit(encodeToolResult(f));
}

export function emitAgentApprovalRequest(session: Session, t: SubagentTask, turnId: string, payload: string): DecodedApproval {
  let d = decodeSubagentApprovalPayload(payload);
  if (!d.found) { return d; }
  let f: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: APPROVAL_REQUEST, turnId: turnId, callId: t.id + ":" + d.value.callId, tool: d.value.tool, summary: d.value.summary, detail: d.value.detail, args: d.value.args };
  session.emit(encodeApprovalRequest(f));
  return d;
}
