import { PendingPlanDecision, PLAN_DECISION_ACCEPT, PLAN_DECISION_OPTION_COUNT, planDecisionOptionForChar } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { planDecisionOptionsBlock, planDecisionOptionRow } from "./renderer.ts";
import { styleBanner, stylePrompt } from "./style.ts";
import { REASON_DONE } from "../protocol/frames.ts";
import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { MODE_PLAN } from "./attach_slots.ts";

const PLAN_APPROVED_MESSAGE: string = "The plan above is approved. Proceed to implement it.";
const PLAN_OFFER_BANNER: string = "plan ready - start working on it?";

export class PlanOfferTracker {
  sawAssistantText: bool;

  constructor() {
    this.sawAssistantText = false;
  }

  noteTurnStart(): void {
    this.sawAssistantText = false;
  }

  noteAssistantText(text: string): void {
    if (text.trim() != "") { this.sawAssistantText = true; }
  }
}

export function maybeOfferPlanDecision(pending: PendingPlanDecision, tracker: PlanOfferTracker, mode: string, sb: Scrollback, frameJson: string): void {
  let reason = jsonStringMemberAt(frameJson, 0, "reason");
  if (reason != REASON_DONE) { return; }
  if (mode != MODE_PLAN) { return; }
  if (!tracker.sawAssistantText) { return; }
  sb.append("\n" + styleBanner(PLAN_OFFER_BANNER));
  sb.appendFixed(planDecisionOptionsBlock(PLAN_DECISION_ACCEPT));
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

function answerPlanDecision(pending: PendingPlanDecision, sb: Scrollback, index: int, setMode: (m: string) => void, sendInput: (t: string) => void): void {
  pending.select(index);
  repaintPlanDecisionOptions(sb, pending);
  let priorMode = pending.previousMode;
  pending.close();
  if (index != PLAN_DECISION_ACCEPT) { return; }
  setMode(priorMode);
  sb.append("\n" + stylePrompt("> ") + PLAN_APPROVED_MESSAGE);
  sendInput(PLAN_APPROVED_MESSAGE);
}

export function tryHandlePlanDecisionArrow(pending: PendingPlanDecision, sb: Scrollback, inputEmpty: bool, delta: int): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  if (pending.moveSelection(delta)) { repaintPlanDecisionOptions(sb, pending); }
  return true;
}

export function tryHandlePlanDecisionEnter(pending: PendingPlanDecision, sb: Scrollback, inputEmpty: bool, setMode: (m: string) => void, sendInput: (t: string) => void): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  answerPlanDecision(pending, sb, pending.selected, setMode, sendInput);
  return true;
}

export function tryHandlePlanDecisionChar(pending: PendingPlanDecision, sb: Scrollback, inputEmpty: bool, ch: string, setMode: (m: string) => void, sendInput: (t: string) => void): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  let index = planDecisionOptionForChar(ch);
  if (index < 0) { return false; }
  answerPlanDecision(pending, sb, index, setMode, sendInput);
  return true;
}
