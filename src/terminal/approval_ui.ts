import { Gate } from "../approval/gate.ts";
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

export function answerApproval(gate: Gate, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval, index: int): void {
  pending.select(index, APPROVAL_OPTION_COUNT);
  repaintApprovalOptions(sb, pending);
  let callId = pending.callId;
  gate.reply(callId, decisionForApprovalOption(index));
  pending.clearIfMatches(callId);
  drawScreen(sb, input, gate.mode, rk.quantaText());
}
