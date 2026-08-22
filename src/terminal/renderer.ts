import { frameType, decodeTextDelta, decodeToolCall, decodeToolResult, decodeApprovalRequest, decodeTurnEnd, decodeError, ToolCallFrame, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR, REASON_CANCELLED, REASON_ERROR } from "../protocol/frames.ts";
import { diffLines, diffCounts, renderDiffRows, DIFF_DISPLAY_MAX_ROWS } from "./diff.ts";
import { DIM, REVERSE, RESET } from "./style.ts";
import { APPROVAL_OPTION_ALLOW, APPROVAL_OPTION_ALWAYS, APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT, UPDATE_OFFER_ACCEPT_AND_STOP_CHECKING, UPDATE_OFFER_NOT_NOW, UPDATE_OFFER_OPTION_COUNT } from "./input_state.ts";
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

function approvalPrompt(summary: string, detail: string, tool: string, args: string): string {
  let diff = diffBlockFor(tool, args);
  return "\n  ? " + summary + " [" + detail + "] " + diff + approvalOptionsBlock(tool, APPROVAL_OPTION_ALLOW);
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

  return "";
}
