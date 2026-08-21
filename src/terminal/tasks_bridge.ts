import { frameTurnId } from "../protocol/frames.ts";
import { ApprovalResponder } from "../tasks/types.ts";
import { Scrollback, approvalOptionForChar, decisionForApprovalOption, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { renderFrame, approvalOptionRow } from "./renderer.ts";

const BG_PREFIX: string = "bg:";
const AGENT_PREFIX: string = "agent:";

function tagFor(turnId: string): string {
  if (turnId.length >= BG_PREFIX.length && turnId.slice(0, BG_PREFIX.length) == BG_PREFIX) {
    return "[task " + turnId.slice(BG_PREFIX.length, turnId.length) + "] ";
  }
  if (turnId.length >= AGENT_PREFIX.length && turnId.slice(0, AGENT_PREFIX.length) == AGENT_PREFIX) {
    return "[agent " + turnId.slice(AGENT_PREFIX.length, turnId.length) + "] ";
  }
  return "";
}

function insertTag(rendered: string, tag: string): string {
  if (tag == "") { return rendered; }
  if (rendered.length > 0 && rendered.charAt(0) == "\n") {
    return "\n" + tag + rendered.slice(1, rendered.length);
  }
  return tag + rendered;
}

export function isTaskTurnId(turnId: string): bool {
  if (turnId.length >= BG_PREFIX.length && turnId.slice(0, BG_PREFIX.length) == BG_PREFIX) { return true; }
  if (turnId.length >= AGENT_PREFIX.length && turnId.slice(0, AGENT_PREFIX.length) == AGENT_PREFIX) { return true; }
  return false;
}

export function appendTaggedFrame(sb: Scrollback, frameJson: string): void {
  let turnId = frameTurnId(frameJson);
  let rendered = renderFrame(frameJson, "");
  if (rendered == "") { return; }
  sb.append(insertTag(rendered, tagFor(turnId)));
}

export function tryHandleAgentApprovalChar(tasks: ApprovalResponder, inputEmpty: bool, ch: string): bool {
  if (!inputEmpty) { return false; }
  if (!tasks.hasPendingApproval()) { return false; }
  let option = approvalOptionForChar(ch);
  if (option < 0) { return false; }
  tasks.answerActiveApproval(decisionForApprovalOption(option));
  return true;
}

export function repaintTaggedApprovalOptions(sb: Scrollback, tasks: ApprovalResponder): void {
  if (!tasks.activeApprovalHasOptionRows()) { return; }
  let first = tasks.activeApprovalOptionRows();
  let selected = tasks.activeApprovalSelected();
  let tool = tasks.activeApprovalTool();
  let i = 0;
  while (i < APPROVAL_OPTION_COUNT) {
    sb.setLine(first + i, approvalOptionRow(i, selected, tool));
    i = i + 1;
  }
}

export function tryHandleAgentApprovalArrow(tasks: ApprovalResponder, sb: Scrollback, inputEmpty: bool, delta: int): bool {
  if (!inputEmpty) { return false; }
  if (!tasks.hasPendingApproval()) { return false; }
  if (tasks.moveActiveApprovalSelection(delta, APPROVAL_OPTION_COUNT)) {
    repaintTaggedApprovalOptions(sb, tasks);
  }
  return true;
}

export function tryHandleAgentApprovalEnter(tasks: ApprovalResponder, sb: Scrollback, inputEmpty: bool): bool {
  if (!inputEmpty) { return false; }
  if (!tasks.hasPendingApproval()) { return false; }
  repaintTaggedApprovalOptions(sb, tasks);
  tasks.answerActiveApproval(decisionForApprovalOption(tasks.activeApprovalSelected()));
  return true;
}

export function cancelCommandArg(arg: string): string {
  let prefix = "cancel ";
  if (arg.length <= prefix.length) { return ""; }
  if (arg.slice(0, prefix.length) != prefix) { return ""; }
  return arg.slice(prefix.length, arg.length).trim();
}
