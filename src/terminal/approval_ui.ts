import { Gate, REPLY_DENY } from "../approval/gate.ts";
import { settleApprovalBlock } from "./approval_settled.ts";
import { InputLine, PendingApproval, decisionForApprovalOption, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { approvalOptionRow } from "./renderer.ts";
import { TurnStatusTracker, drawScreen } from "./screen.ts";

export function repaintApprovalOptions(sb: Scrollback, pending: PendingApproval): void {
  if (!pending.hasOptionRows()) { return; }
  let i = 0;
  while (i < APPROVAL_OPTION_COUNT) {
    sb.setLine(pending.firstOptionRow + i, approvalOptionRow(i, pending.selected, pending.tool));
    i = i + 1;
  }
}

function reportForeignDecision(sb: Scrollback, decision: string, attempted: bool): void {
  if (attempted) {
    sb.append("\nthat approval was already answered elsewhere (decision: " + decision + ") - this side's choice was not applied");
    return;
  }
  sb.append("\nthat approval was answered elsewhere (decision: " + decision + ")");
}

export function answerApproval(gate: Gate, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval, index: int): void {
  let callId = pending.callId;
  let decision = decisionForApprovalOption(index);
  let applied = gate.reply(callId, decision);
  if (!applied) { decision = gate.findReply(callId); }
  settleApprovalBlock(sb, pending, decision);
  pending.clearIfMatches(callId);
  if (!applied) {
    reportForeignDecision(sb, gate.findReply(callId), true);
  }
  drawScreen(sb, input, gate.mode, rk);
}

export function denyPendingApproval(gate: Gate, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval): void {
  let callId = pending.callId;
  if (callId == "") { return; }
  let applied = gate.reply(callId, REPLY_DENY);
  let decision = REPLY_DENY;
  if (!applied) { decision = gate.findReply(callId); }
  settleApprovalBlock(sb, pending, decision);
  pending.clearIfMatches(callId);
  if (!applied) {
    reportForeignDecision(sb, gate.findReply(callId), true);
  }
  drawScreen(sb, input, gate.mode, rk);
}

export function reportIfResolvedElsewhere(gate: Gate, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval): void {
  if (pending.callId == "") { return; }
  let decision = gate.findReply(pending.callId);
  if (decision == "") { return; }
  settleApprovalBlock(sb, pending, decision);
  pending.clearIfMatches(pending.callId);
  reportForeignDecision(sb, decision, false);
  drawScreen(sb, input, gate.mode, rk);
}
