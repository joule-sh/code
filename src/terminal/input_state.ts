import { REPLY_ALLOW, REPLY_DENY, REPLY_ALWAYS, MODE_AUTO_EDIT } from "../approval/gate.ts";
import { Completion } from "./completion.ts";
import { PROMPT_MARKER } from "./prompt_rows.ts";

export class InputLine {
  buf: string;
  marker: string;
  completion: Completion;

  constructor() {
    this.buf = "";
    this.marker = PROMPT_MARKER;
    this.completion = new Completion();
  }

  capturing(): bool {
    return this.marker != PROMPT_MARKER;
  }

  captureWith(marker: string): void {
    this.marker = marker;
    this.setBuf("");
  }

  release(): void {
    this.marker = PROMPT_MARKER;
    this.setBuf("");
  }

  push(ch: string): void {
    this.setBuf(this.buf + ch);
  }

  backspace(): void {
    if (this.buf.length > 0) {
      this.setBuf(this.buf.slice(0, this.buf.length - 1));
    }
  }

  takeAndClear(): string {
    let out = this.buf;
    this.setBuf("");
    return out;
  }

  clear(): void {
    this.setBuf("");
  }

  setBuf(text: string): void {
    this.buf = text;
    if (this.capturing()) {
      this.completion.refresh("");
      return;
    }
    this.completion.refresh(text);
  }

  acceptCompletion(): bool {
    if (!this.completion.isOpen()) {
      return false;
    }
    this.setBuf(this.completion.selectedName());
    return true;
  }
}

export class InputHistory {
  entries: string[];
  cursor: int;
  stash: string;
  navigating: bool;

  constructor() {
    this.entries = [];
    this.cursor = 0;
    this.stash = "";
    this.navigating = false;
  }

  record(text: string): void {
    this.entries.push(text);
    this.cursor = this.entries.length;
    this.stash = "";
    this.navigating = false;
  }

  cancelNavigation(): void {
    this.navigating = false;
  }

  back(current: string): string {
    if (this.entries.length == 0) {
      return current;
    }
    if (!this.navigating) {
      this.stash = current;
      this.navigating = true;
      this.cursor = this.entries.length;
    }
    if (this.cursor > 0) {
      this.cursor = this.cursor - 1;
    }
    return this.entries[this.cursor];
  }

  forward(): string {
    if (!this.navigating) {
      return this.stash;
    }
    this.cursor = this.cursor + 1;
    if (this.cursor >= this.entries.length) {
      this.cursor = this.entries.length;
      this.navigating = false;
      let out = this.stash;
      this.stash = "";
      return out;
    }
    return this.entries[this.cursor];
  }
}

export const APPROVAL_OPTION_ALLOW: int = 0;
export const APPROVAL_OPTION_ALWAYS: int = 1;
export const APPROVAL_OPTION_DENY: int = 2;
export const APPROVAL_OPTION_COUNT: int = 3;

export function approvalOptionForChar(ch: string): int {
  if (ch == "y" || ch == "1") { return APPROVAL_OPTION_ALLOW; }
  if (ch == "a" || ch == "2") { return APPROVAL_OPTION_ALWAYS; }
  if (ch == "n" || ch == "3") { return APPROVAL_OPTION_DENY; }
  return -1;
}

export function decisionForApprovalOption(index: int): string {
  if (index == APPROVAL_OPTION_ALWAYS) { return REPLY_ALWAYS; }
  if (index == APPROVAL_OPTION_DENY) { return REPLY_DENY; }
  return REPLY_ALLOW;
}

export class PendingApproval {
  callId: string;
  tool: string;
  ask: string;
  selected: int;
  firstOptionRow: int;
  blockRow: int;

  constructor() {
    this.callId = "";
    this.tool = "";
    this.ask = "";
    this.selected = 0;
    this.firstOptionRow = -1;
    this.blockRow = -1;
  }

  begin(id: string, tool: string): void {
    this.callId = id;
    this.tool = tool;
    this.ask = "";
    this.selected = 0;
    this.firstOptionRow = -1;
    this.blockRow = -1;
  }

  setAsk(ask: string, blockRow: int): void {
    this.ask = ask;
    this.blockRow = blockRow;
  }

  setOptionRows(first: int): void {
    this.firstOptionRow = first;
  }

  hasOptionRows(): bool {
    return this.firstOptionRow >= 0;
  }

  moveSelection(delta: int, count: int): bool {
    let next = this.selected + delta;
    if (next < 0) {
      next = 0;
    }
    if (next > count - 1) {
      next = count - 1;
    }
    if (next == this.selected) {
      return false;
    }
    this.selected = next;
    return true;
  }

  select(index: int, count: int): void {
    if (index < 0 || index >= count) {
      return;
    }
    this.selected = index;
  }

  clearIfMatches(id: string): void {
    if (this.callId == id) {
      this.callId = "";
      this.tool = "";
      this.ask = "";
      this.firstOptionRow = -1;
      this.blockRow = -1;
    }
  }

  isPending(): bool {
    return this.callId != "";
  }
}

export const UPDATE_OFFER_ACCEPT: int = 0;
export const UPDATE_OFFER_ACCEPT_AND_STOP_CHECKING: int = 1;
export const UPDATE_OFFER_NOT_NOW: int = 2;
export const UPDATE_OFFER_OPTION_COUNT: int = 3;

export function updateOfferOptionForChar(ch: string): int {
  if (ch == "y" || ch == "1") { return UPDATE_OFFER_ACCEPT; }
  if (ch == "a" || ch == "2") { return UPDATE_OFFER_ACCEPT_AND_STOP_CHECKING; }
  if (ch == "n" || ch == "3") { return UPDATE_OFFER_NOT_NOW; }
  return -1;
}

export class PendingUpdateOffer {
  active: bool;
  toVersion: string;
  selected: int;
  firstOptionRow: int;

  constructor() {
    this.active = false;
    this.toVersion = "";
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  open(toVersion: string): void {
    this.active = true;
    this.toVersion = toVersion;
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  setOptionRows(first: int): void {
    this.firstOptionRow = first;
  }

  hasOptionRows(): bool {
    return this.firstOptionRow >= 0;
  }

  moveSelection(delta: int): bool {
    let next = this.selected + delta;
    if (next < 0) { next = 0; }
    if (next > UPDATE_OFFER_OPTION_COUNT - 1) { next = UPDATE_OFFER_OPTION_COUNT - 1; }
    if (next == this.selected) { return false; }
    this.selected = next;
    return true;
  }

  select(index: int): void {
    if (index < 0 || index >= UPDATE_OFFER_OPTION_COUNT) { return; }
    this.selected = index;
  }

  close(): void {
    this.active = false;
    this.toVersion = "";
    this.firstOptionRow = -1;
  }

  isPending(): bool {
    return this.active;
  }
}

export const PLAN_DECISION_ACCEPT: int = 0;
export const PLAN_DECISION_REJECT: int = 1;
export const PLAN_DECISION_OPTION_COUNT: int = 2;

export function planDecisionOptionForChar(ch: string): int {
  if (ch == "y" || ch == "1") { return PLAN_DECISION_ACCEPT; }
  if (ch == "n" || ch == "2") { return PLAN_DECISION_REJECT; }
  return -1;
}

// The three answers to the Ctrl-C prompt: keep the session running as a
// background daemon, quit outright, or stay put.
export const QUIT_DECISION_KEEP: int = 0;
export const QUIT_DECISION_QUIT: int = 1;
export const QUIT_DECISION_STAY: int = 2;
export const QUIT_DECISION_OPTION_COUNT: int = 3;

export function quitDecisionOptionForChar(ch: string): int {
  if (ch == "1" || ch == "k") { return QUIT_DECISION_KEEP; }
  if (ch == "2" || ch == "q") { return QUIT_DECISION_QUIT; }
  if (ch == "3" || ch == "s") { return QUIT_DECISION_STAY; }
  return -1;
}

export class PendingQuitDecision {
  active: bool;
  selected: int;
  firstOptionRow: int;

  constructor() {
    this.active = false;
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  open(): void {
    this.active = true;
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  setOptionRows(first: int): void {
    this.firstOptionRow = first;
  }

  hasOptionRows(): bool {
    return this.firstOptionRow >= 0;
  }

  moveSelection(delta: int): bool {
    let next = this.selected + delta;
    if (next < 0) { next = 0; }
    if (next > QUIT_DECISION_OPTION_COUNT - 1) { next = QUIT_DECISION_OPTION_COUNT - 1; }
    if (next == this.selected) { return false; }
    this.selected = next;
    return true;
  }

  close(): void {
    this.active = false;
    this.firstOptionRow = -1;
  }

  isPending(): bool {
    return this.active;
  }
}

export class PendingPlanDecision {
  active: bool;
  previousMode: string;
  selected: int;
  firstOptionRow: int;

  constructor() {
    this.active = false;
    this.previousMode = MODE_AUTO_EDIT;
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  setPreviousMode(mode: string): void {
    this.previousMode = mode;
  }

  open(): void {
    this.active = true;
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  setOptionRows(first: int): void {
    this.firstOptionRow = first;
  }

  hasOptionRows(): bool {
    return this.firstOptionRow >= 0;
  }

  moveSelection(delta: int): bool {
    let next = this.selected + delta;
    if (next < 0) { next = 0; }
    if (next > PLAN_DECISION_OPTION_COUNT - 1) { next = PLAN_DECISION_OPTION_COUNT - 1; }
    if (next == this.selected) { return false; }
    this.selected = next;
    return true;
  }

  select(index: int): void {
    if (index < 0 || index >= PLAN_DECISION_OPTION_COUNT) { return; }
    this.selected = index;
  }

  close(): void {
    this.active = false;
    this.firstOptionRow = -1;
  }

  isPending(): bool {
    return this.active;
  }
}

// One line in the /model picker. `kind` is "header" (a group title), "note" (a
// dim, unselectable line such as "not available yet") or "model" (a switchable
// entry). Only "model" rows take the cursor; `id` is the wire model to switch
// to, while `label` is what the row shows.
export const MODEL_KIND_HEADER: string = "header";
export const MODEL_KIND_NOTE: string = "note";
export const MODEL_KIND_MODEL: string = "model";

export type ModelEntry = { kind: string, label: string, id: string };

export class PendingModelPick {
  active: bool;
  entries: ModelEntry[];
  selected: int;
  firstOptionRow: int;

  constructor() {
    this.active = false;
    this.entries = [];
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  firstSelectable(): int {
    let i = 0;
    while (i < this.entries.length) {
      if (this.entries[i].kind == MODEL_KIND_MODEL) { return i; }
      i = i + 1;
    }
    return 0;
  }

  open(entries: ModelEntry[]): void {
    this.entries = entries;
    this.active = true;
    this.firstOptionRow = -1;
    this.selected = this.firstSelectable();
  }

  setOptionRows(first: int): void {
    this.firstOptionRow = first;
  }

  hasOptionRows(): bool {
    return this.firstOptionRow >= 0;
  }

  // Step to the next selectable row in `delta`'s direction, skipping headers and
  // notes. Clamps at the ends rather than wrapping, and reports whether the
  // cursor actually moved so the caller only repaints when it did.
  moveSelection(delta: int): bool {
    let n = this.entries.length;
    if (n == 0) { return false; }
    let step = 1;
    if (delta < 0) { step = -1; }
    let next = this.selected;
    while (true) {
      next = next + step;
      if (next < 0 || next >= n) { return false; }
      if (this.entries[next].kind == MODEL_KIND_MODEL) { break; }
    }
    if (next == this.selected) { return false; }
    this.selected = next;
    return true;
  }

  selectedEntry(): ModelEntry {
    if (this.selected < 0 || this.selected >= this.entries.length) {
      let empty: ModelEntry = { kind: MODEL_KIND_NOTE, label: "", id: "" };
      return empty;
    }
    return this.entries[this.selected];
  }

  close(): void {
    this.active = false;
    this.firstOptionRow = -1;
    this.entries = [];
  }

  isPending(): bool {
    return this.active;
  }
}

const ESC_CODE: int = 27;

function isSgrTerminator(c: string): bool {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
}

function utf8ByteCount(first: int): int {
  if (first >= 240) { return 4; }
  if (first >= 224) { return 3; }
  if (first >= 192) { return 2; }
  return 1;
}

export function clip(line: string, width: int): string {
  if (width <= 0) {
    return line;
  }

  let visible = 0;
  let out = "";
  let hadEscape = false;
  let i = 0;

  while (i < line.length) {
    if (line.charCodeAt(i) == ESC_CODE) {
      hadEscape = true;
      let j = i + 1;
      if (j < line.length && line.charAt(j) == "[") {
        j = j + 1;
        while (j < line.length && !isSgrTerminator(line.charAt(j))) {
          j = j + 1;
        }
        if (j < line.length) {
          j = j + 1;
        }
      }
      out = out + line.slice(i, j);
      i = j;
      continue;
    }

    if (visible >= width) {
      break;
    }
    let charBytes = utf8ByteCount(line.charCodeAt(i));
    let end = i + charBytes;
    if (end > line.length) {
      end = line.length;
    }
    out = out + line.slice(i, end);
    visible = visible + 1;
    i = end;
  }

  if (hadEscape) {
    out = out + String.fromCharCode(ESC_CODE) + "[0m";
  }
  return out;
}
