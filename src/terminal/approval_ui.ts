import { Gate, REPLY_DENY } from "../approval/gate.ts";
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
  pending.select(index, APPROVAL_OPTION_COUNT);
  repaintApprovalOptions(sb, pending);
  let callId = pending.callId;
  let applied = gate.reply(callId, decisionForApprovalOption(index));
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
  pending.clearIfMatches(callId);
  if (!applied) {
    reportForeignDecision(sb, gate.findReply(callId), true);
    drawScreen(sb, input, gate.mode, rk);
  }
}

export function reportIfResolvedElsewhere(gate: Gate, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval): void {
  if (pending.callId == "") { return; }
  let decision = gate.findReply(pending.callId);
  if (decision == "") { return; }
  pending.clearIfMatches(pending.callId);
  reportForeignDecision(sb, decision, false);
  drawScreen(sb, input, gate.mode, rk);
}
