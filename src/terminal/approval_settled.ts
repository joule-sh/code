import { DECISION_ALWAYS, DECISION_DENY, DECIDED_BY_MODE, DECIDED_BY_PERSON } from "../protocol/frames.ts";
import { PendingApproval, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { DIM, RESET } from "./style.ts";

export const SETTLED_ALLOWED: string = "allowed";
export const SETTLED_ALWAYS: string = "allowed, and not asked again this session";
export const SETTLED_DENIED: string = "denied";
export const SETTLED_BY_MODE: string = "allowed by the session's approval mode";

export const SETTLED_PREFIX: string = "  ? ";
export const SETTLED_JOIN: string = " - ";
const SETTLED_CUT: string = "...";
const SETTLED_MIN_ASK: int = 12;
const SETTLED_FALLBACK_WIDTH: int = 80;

export function approvalAskText(summary: string, detail: string): string {
  return summary + " [" + detail + "]";
}

export function settledPhraseFor(decision: string, by: string): string {
  if (by == DECIDED_BY_MODE) { return SETTLED_BY_MODE; }
  if (decision == DECISION_ALWAYS) { return SETTLED_ALWAYS; }
  if (decision == DECISION_DENY) { return SETTLED_DENIED; }
  return SETTLED_ALLOWED;
}

function cutAt(text: string, n: int): int {
  if (n <= 0) { return 0; }
  if (n >= text.length) { return text.length; }
  let cut = n;
  while (cut > 0 && text.charCodeAt(cut) >= 128 && text.charCodeAt(cut) < 192) {
    cut = cut - 1;
  }
  return cut;
}

export function approvalSettledLine(ask: string, phrase: string, width: int): string {
  let w = width;
  if (w <= 0) { w = SETTLED_FALLBACK_WIDTH; }
  let room = w - SETTLED_PREFIX.length - SETTLED_JOIN.length - phrase.length;
  if (room < SETTLED_MIN_ASK) { room = SETTLED_MIN_ASK; }
  let head = ask;
  if (head.length > room) {
    head = head.slice(0, cutAt(head, room - SETTLED_CUT.length)) + SETTLED_CUT;
  }
  return SETTLED_PREFIX + head + SETTLED_JOIN + phrase;
}

export function styleSettled(line: string): string {
  return DIM + line + RESET;
}

export function settledRow(summary: string, detail: string, decision: string, by: string, width: int): string {
  let ask = approvalAskText(summary, detail);
  return "\n" + styleSettled(approvalSettledLine(ask, settledPhraseFor(decision, by), width));
}

export function noteApprovalBlock(sb: Scrollback, pending: PendingApproval, summary: string, detail: string): void {
  pending.setOptionRows(sb.lineCount() - APPROVAL_OPTION_COUNT);
  pending.setAsk(approvalAskText(summary, detail), sb.approvalBlockRow());
}

export function settleApprovalBlock(sb: Scrollback, pending: PendingApproval, decision: string): void {
  if (!pending.hasOptionRows() || pending.blockRow < 0) { return; }
  if (pending.blockRow >= pending.firstOptionRow) { return; }
  let end = pending.firstOptionRow + APPROVAL_OPTION_COUNT;
  if (end > sb.lineCount()) { return; }
  let phrase = settledPhraseFor(decision, DECIDED_BY_PERSON);
  sb.setLine(pending.blockRow, styleSettled(approvalSettledLine(pending.ask, phrase, sb.width)));
  sb.hideRange(pending.blockRow + 1, end - pending.blockRow - 1);
}
