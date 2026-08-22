import { InputLine, PendingApproval, decisionForApprovalOption, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { approvalOptionRow } from "./renderer.ts";
import { TurnStatusTracker, drawScreen } from "./screen.ts";

export class ApprovalLog {
  mode: string;
  callIds: string[];
  decisions: string[];

  constructor(mode: string) {
    this.mode = mode;
    this.callIds = [];
    this.decisions = [];
  }

  reply(callId: string, decision: string): bool {
    let i = 0;
    while (i < this.callIds.length) {
      if (this.callIds[i] == callId) { return false; }
      i = i + 1;
    }
    this.callIds.push(callId);
    this.decisions.push(decision);
    return true;
  }

  findReply(callId: string): string {
    let i = 0;
    while (i < this.callIds.length) {
      if (this.callIds[i] == callId) { return this.decisions[i]; }
      i = i + 1;
    }
    return "";
  }
}

export function repaintApprovalOptionsLocal(sb: Scrollback, pending: PendingApproval): void {
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

export function answerApprovalLocal(log: ApprovalLog, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval, index: int): string {
  pending.select(index, APPROVAL_OPTION_COUNT);
  repaintApprovalOptionsLocal(sb, pending);
  let callId = pending.callId;
  let decision = decisionForApprovalOption(index);
  let applied = log.reply(callId, decision);
  pending.clearIfMatches(callId);
  if (!applied) {
    reportForeignDecision(sb, log.findReply(callId), true);
  }
  drawScreen(sb, input, log.mode, rk);
  return decision;
}

export function reportIfResolvedElsewhereLocal(log: ApprovalLog, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval): void {
  if (pending.callId == "") { return; }
  let decision = log.findReply(pending.callId);
  if (decision == "") { return; }
  pending.clearIfMatches(pending.callId);
  reportForeignDecision(sb, decision, false);
  drawScreen(sb, input, log.mode, rk);
}
