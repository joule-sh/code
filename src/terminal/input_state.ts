import { REPLY_ALLOW, REPLY_DENY, REPLY_ALWAYS } from "../approval/gate.ts";
import { Completion } from "./completion.ts";

export class InputLine {
  buf: string;
  completion: Completion;

  constructor() {
    this.buf = "";
    this.completion = new Completion();
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
  selected: int;
  firstOptionRow: int;

  constructor() {
    this.callId = "";
    this.tool = "";
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  set(id: string): void {
    this.callId = id;
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  setTool(tool: string): void {
    this.tool = tool;
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
      this.firstOptionRow = -1;
    }
  }

  isPending(): bool {
    return this.callId != "";
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
