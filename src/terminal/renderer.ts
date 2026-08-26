import { frameType, decodeTextDelta, decodeToolCall, decodeToolResult, decodeApprovalRequest, decodeTurnEnd, decodeError, decodeNotice, isWarning, NOTICE, decodeApprovalReplyResult, decodeModeChanged, decodeModelChanged, decodeTasksResponse, decodeDaemonStopping, decodeShareStarted, decodeShareFailed, ToolCallFrame, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR, APPROVAL_REPLY_RESULT, MODE_CHANGED, MODEL_CHANGED, TASKS_RESPONSE, DAEMON_STOPPING, SHARE_STARTED, SHARE_FAILED, REASON_CANCELLED, REASON_ERROR } from "../protocol/frames.ts";
import { diffLines, diffCounts, renderDiffRows, DIFF_DISPLAY_MAX_ROWS } from "./diff.ts";
import { DIM, REVERSE, RESET } from "./style.ts";
import { APPROVAL_OPTION_ALLOW, APPROVAL_OPTION_ALWAYS, APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT, UPDATE_OFFER_ACCEPT_AND_STOP_CHECKING, UPDATE_OFFER_NOT_NOW, UPDATE_OFFER_OPTION_COUNT, PLAN_DECISION_REJECT, PLAN_DECISION_OPTION_COUNT } from "./input_state.ts";
import { settledRow } from "./approval_settled.ts";
import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";

const TOOL_EDIT: string = "edit";
const TOOL_WRITE: string = "write";

function diffableToolPath(tool: string, args: string): string {
  if (tool != TOOL_EDIT && tool != TOOL_WRITE) { return ""; }
  return jsonStringMemberAt(args, 0, "path");
}

function toolCallSummary(f: ToolCallFrame): string {
  let path = diffableToolPath(f.tool, f.args);
  if (path != "") {
    return "\n  -> " + f.tool + " " + path;
  }
  return "\n  -> " + f.tool + " " + f.args;
}

function diffBlockFor(tool: string, args: string): string {
  let path = diffableToolPath(tool, args);
  if (path == "") { return ""; }

  let oldText = "";
  let newText = "";
  if (tool == TOOL_EDIT) {
    oldText = jsonStringMemberAt(args, 0, "old_text");
    newText = jsonStringMemberAt(args, 0, "new_text");
  } else {
    newText = jsonStringMemberAt(args, 0, "content");
  }

  let rows = diffLines(oldText, newText);
  if (rows == null) { return ""; }
  if (rows.length > DIFF_DISPLAY_MAX_ROWS) { return ""; }
  let counts = diffCounts(rows);
  if (counts.added == 0 && counts.removed == 0) { return ""; }
  let body = renderDiffRows(rows);
  if (body == "") { return ""; }
  return "\n" + body;
}

const APPROVAL_OPTION_INDENT: string = "    ";
const APPROVAL_MARKER_ON: string = "> ";
const APPROVAL_MARKER_OFF: string = "  ";

export function approvalOptionLabel(index: int, tool: string): string {
  if (index == APPROVAL_OPTION_ALWAYS) {
    return "2. Yes, and don't ask again for " + tool + " this session";
  }
  if (index == APPROVAL_OPTION_DENY) {
    return "3. No";
  }
  return "1. Yes";
}

export function approvalOptionRow(index: int, selected: int, tool: string): string {
  let label = approvalOptionLabel(index, tool);
  if (index == selected) {
    return APPROVAL_OPTION_INDENT + REVERSE + APPROVAL_MARKER_ON + label + RESET;
  }
  return APPROVAL_OPTION_INDENT + DIM + APPROVAL_MARKER_OFF + label + RESET;
}

export function approvalOptionsBlock(tool: string, selected: int): string {
  let out = "";
  let i = 0;
  while (i < APPROVAL_OPTION_COUNT) {
    out = out + "\n" + approvalOptionRow(i, selected, tool);
    i = i + 1;
  }
  return out;
}

export function updateOfferOptionLabel(index: int): string {
  if (index == UPDATE_OFFER_ACCEPT_AND_STOP_CHECKING) {
    return "2. Yes, and don't ask again (turn off update checks)";
  }
  if (index == UPDATE_OFFER_NOT_NOW) {
    return "3. Not now";
  }
  return "1. Yes, update now";
}

export function updateOfferOptionRow(index: int, selected: int): string {
  let label = updateOfferOptionLabel(index);
  if (index == selected) {
    return APPROVAL_OPTION_INDENT + REVERSE + APPROVAL_MARKER_ON + label + RESET;
  }
  return APPROVAL_OPTION_INDENT + DIM + APPROVAL_MARKER_OFF + label + RESET;
}

export function updateOfferOptionsBlock(selected: int): string {
  let out = "";
  let i = 0;
  while (i < UPDATE_OFFER_OPTION_COUNT) {
    out = out + "\n" + updateOfferOptionRow(i, selected);
    i = i + 1;
  }
  return out;
}

export function planDecisionOptionLabel(index: int): string {
  if (index == PLAN_DECISION_REJECT) {
    return "2. No, keep planning";
  }
  return "1. Yes, start working";
}

export function planDecisionOptionRow(index: int, selected: int): string {
  let label = planDecisionOptionLabel(index);
  if (index == selected) {
    return APPROVAL_OPTION_INDENT + REVERSE + APPROVAL_MARKER_ON + label + RESET;
  }
  return APPROVAL_OPTION_INDENT + DIM + APPROVAL_MARKER_OFF + label + RESET;
}

export function planDecisionOptionsBlock(selected: int): string {
  let out = "";
  let i = 0;
  while (i < PLAN_DECISION_OPTION_COUNT) {
    out = out + "
" + planDecisionOptionRow(i, selected);
    i = i + 1;
  }
  return out;
}

function approvalPrompt(summary: string, detail: string, tool: string, args: string): string {
  let diff = diffBlockFor(tool, args);
  return "\n  ? " + summary + " [" + detail + "]" + diff;
}

export function approvalOptionsFor(frameJson: string): string {
  return approvalOptionsBlock(jsonStringMemberAt(frameJson, 0, "tool"), APPROVAL_OPTION_ALLOW);
}

export function approvalSettledFor(frameJson: string, width: int): string {
  let summary = jsonStringMemberAt(frameJson, 0, "summary");
  let detail = jsonStringMemberAt(frameJson, 0, "detail");
  let decision = jsonStringMemberAt(frameJson, 0, "decision");
  let by = jsonStringMemberAt(frameJson, 0, "decidedBy");
  return settledRow(summary, detail, decision, by, width);
}

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
    return toolCallSummary(f) + diffBlockFor(f.tool, f.args);
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
    return approvalPrompt(f.summary, f.detail, f.tool, f.args);
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

  if (kind == NOTICE) {
    let f = decodeNotice(frameJson);
    if (f == null) { return ""; }
    if (isWarning(f.level)) { return "\n! " + f.message; }
    return "\n" + f.message;
  }

  if (kind == APPROVAL_REPLY_RESULT) {
    let f = decodeApprovalReplyResult(frameJson);
    if (f == null) { return ""; }
    if (f.applied) { return ""; }
    return "\n  (a reply for that approval arrived after it was already decided: " + f.decision + ")";
  }

  if (kind == MODE_CHANGED) {
    let f = decodeModeChanged(frameJson);
    if (f == null) { return ""; }
    return "\nmode set to " + f.mode;
  }

  if (kind == MODEL_CHANGED) {
    let f = decodeModelChanged(frameJson);
    if (f == null) { return ""; }
    return "\nmodel set to " + f.model;
  }

  if (kind == TASKS_RESPONSE) {
    let f = decodeTasksResponse(frameJson);
    if (f == null) { return ""; }
    return "\n" + f.text;
  }

  if (kind == DAEMON_STOPPING) {
    let f = decodeDaemonStopping(frameJson);
    if (f == null) { return "\nthe daemon is stopping"; }
    return "\nthe daemon is stopping (" + f.reason + ")";
  }

  if (kind == SHARE_STARTED) {
    let f = decodeShareStarted(frameJson);
    if (f == null) { return ""; }
    return "\nattached - code " + f.code + " - " + f.url;
  }

  if (kind == SHARE_FAILED) {
    let f = decodeShareFailed(frameJson);
    if (f == null) { return ""; }
    return "\n" + f.error;
  }

  return "";
}
