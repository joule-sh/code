import { frameTurnId } from "../protocol/frames.ts";
import { REPLY_ALLOW, REPLY_DENY, REPLY_ALWAYS } from "../approval/gate.ts";
import { ApprovalResponder } from "../tasks/types.ts";
import { Scrollback } from "./input_state.ts";
import { renderFrame } from "./renderer.ts";

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
  if (ch == "y") { tasks.answerActiveApproval(REPLY_ALLOW); return true; }
  if (ch == "n") { tasks.answerActiveApproval(REPLY_DENY); return true; }
  if (ch == "a") { tasks.answerActiveApproval(REPLY_ALWAYS); return true; }
  return false;
}

export function cancelCommandArg(arg: string): string {
  let prefix = "cancel ";
  if (arg.length <= prefix.length) { return ""; }
  if (arg.slice(0, prefix.length) != prefix) { return ""; }
  return arg.slice(prefix.length, arg.length).trim();
}
