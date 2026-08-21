import { frameType, decodeTextDelta, decodeToolCall, decodeToolResult, decodeApprovalRequest, decodeTurnEnd, decodeError, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR, REASON_CANCELLED, REASON_ERROR } from "../protocol/frames.ts";

export function renderFrame(frameJson: string, prevKind: string): string {
  let kind = frameType(frameJson);

  if (kind == TEXT_DELTA) {
    let f = decodeTextDelta(frameJson);
    if (f == null) { return ""; }
    if (prevKind != TEXT_DELTA) {
      return "\n" + f.text;
    }
    return f.text;
  }

  if (kind == TOOL_CALL) {
    let f = decodeToolCall(frameJson);
    if (f == null) { return ""; }
    return "\n  -> " + f.tool + " " + f.args;
  }

  if (kind == TOOL_RESULT) {
    let f = decodeToolResult(frameJson);
    if (f == null) { return ""; }
    let status = "failed";
    if (f.ok) { status = "ok"; }
    let out = f.output;
    if (f.truncated) {
      out = out + " (truncated)";
    }
    return "\n     " + status + ": " + out;
  }

  if (kind == APPROVAL_REQUEST) {
    let f = decodeApprovalRequest(frameJson);
    if (f == null) { return ""; }
    return "\n  ? " + f.summary + " [" + f.detail + "] (y/n/a)";
  }

  if (kind == TURN_END) {
    let f = decodeTurnEnd(frameJson);
    if (f == null) { return ""; }
    if (f.reason == REASON_CANCELLED) {
      return "\n(cancelled)\n";
    }
    if (f.reason == REASON_ERROR) {
      return "\n(error)\n";
    }
    return "\n";
  }

  if (kind == ERROR) {
    let f = decodeError(frameJson);
    if (f == null) { return ""; }
    return "\n! " + f.code + ": " + f.message;
  }

  return "";
}
