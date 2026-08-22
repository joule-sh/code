import { Gate, MODE_PLAN } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { ROLE_ASSISTANT } from "../session/types.ts";
import { Scrollback } from "./scrollback.ts";
import { RelayInputBridge } from "./relay_bridge.ts";
import { PendingPlanDecision, PLAN_DECISION_ACCEPT, PLAN_DECISION_OPTION_COUNT, planDecisionOptionForChar } from "./input_state.ts";
import { planDecisionOptionsBlock, planDecisionOptionRow } from "./renderer.ts";
import { styleBanner, stylePrompt } from "./style.ts";
import { decodeTurnEnd, REASON_DONE } from "../protocol/frames.ts";

const PLAN_MODE_BRIEFING: string = "Plan mode is active. Investigate with read, list, grep, and safe read-only shell commands run through run - writes, edits, and any other shell command are refused automatically, so do not expect to make changes yet. Once you understand enough, reply with a concrete, step by step plan for the change: which files, what approach, in what order. Do not start implementing. The user will accept or reject this plan before any work begins.";

const PLAN_APPROVED_MESSAGE: string = "The plan above is approved. Proceed to implement it.";

const PLAN_OFFER_BANNER: string = "plan ready - start working on it?";

export function enterPlanMode(pending: PendingPlanDecision, session: Session, currentMode: string): void {
  pending.setPreviousMode(currentMode);
  session.injectSystemContext(PLAN_MODE_BRIEFING);
}

function lastAssistantTextNonEmpty(session: Session): bool {
  let historyMsgs = session.history;
  if (historyMsgs.length == 0) { return false; }
  let lastMsg = historyMsgs[historyMsgs.length - 1];
  return lastMsg.role == ROLE_ASSISTANT && lastMsg.text.trim() != "";
}

export function offerPlanDecision(pending: PendingPlanDecision, gate: Gate, session: Session, sb: Scrollback, frameJson: string): void {
  let endFrame = decodeTurnEnd(frameJson);
  if (endFrame == null || endFrame.reason != REASON_DONE) { return; }
  if (gate.mode != MODE_PLAN) { return; }
  if (!lastAssistantTextNonEmpty(session)) { return; }
  sb.append("\n" + styleBanner(PLAN_OFFER_BANNER) + planDecisionOptionsBlock(PLAN_DECISION_ACCEPT));
  pending.open();
  pending.setOptionRows(sb.lineCount() - PLAN_DECISION_OPTION_COUNT);
}

export function repaintPlanDecisionOptions(sb: Scrollback, pending: PendingPlanDecision): void {
  if (!pending.hasOptionRows()) { return; }
  let i = 0;
  while (i < PLAN_DECISION_OPTION_COUNT) {
    sb.setLine(pending.firstOptionRow + i, planDecisionOptionRow(i, pending.selected));
    i = i + 1;
  }
}

function answerPlanDecision(pending: PendingPlanDecision, gate: Gate, session: Session, bridge: RelayInputBridge, sb: Scrollback, index: int): void {
  pending.select(index);
  repaintPlanDecisionOptions(sb, pending);
  let priorMode = pending.previousMode;
  pending.close();
  if (index != PLAN_DECISION_ACCEPT) { return; }
  gate.mode = priorMode;
  sb.append("
" + stylePrompt("> ") + PLAN_APPROVED_MESSAGE);
  bridge.runNow(session, PLAN_APPROVED_MESSAGE);
}

export function tryHandlePlanDecisionArrow(pending: PendingPlanDecision, sb: Scrollback, inputEmpty: bool, delta: int): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  if (pending.moveSelection(delta)) {
    repaintPlanDecisionOptions(sb, pending);
  }
  return true;
}

export function tryHandlePlanDecisionEnter(pending: PendingPlanDecision, gate: Gate, session: Session, bridge: RelayInputBridge, sb: Scrollback, inputEmpty: bool): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  answerPlanDecision(pending, gate, session, bridge, sb, pending.selected);
  return true;
}

export function tryHandlePlanDecisionChar(pending: PendingPlanDecision, gate: Gate, session: Session, bridge: RelayInputBridge, sb: Scrollback, inputEmpty: bool, ch: string): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  let index = planDecisionOptionForChar(ch);
  if (index < 0) { return false; }
  answerPlanDecision(pending, gate, session, bridge, sb, index);
  return true;
}
