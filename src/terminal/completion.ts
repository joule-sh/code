import { CommandInfo, commandList } from "./commands.ts";
import { VIOLET, DIM, BOLD, wrap } from "./style.ts";

export const COMPLETION_MAX_LIST_ROWS: int = 10;
export const COMPLETION_MARKER: string = "> ";

const NAME_COLUMN: int = 10;
const LEAD_WIDTH: int = 2;
const RULE_ROWS: int = 1;
const MIN_DESCRIPTION_WIDTH: int = 8;
const MIN_TRANSCRIPT_ROWS: int = 1;
const RULE_CHAR: string = "─";
const STATUS_ROWS: int = 1;

function repeatChar(ch: string, n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    out = out + ch;
    i = i + 1;
  }
  return out;
}

function padColumn(text: string, width: int): string {
  let out = text + " ";
  while (out.length < width) {
    out = out + " ";
  }
  return out;
}

export function isCompletionPrefix(buf: string): bool {
  if (buf.length == 0) { return false; }
  if (buf.charAt(0) != "/") { return false; }
  if (buf.indexOf(" ") >= 0) { return false; }
  return true;
}

export function matchCommands(buf: string): CommandInfo[] {
  let out: CommandInfo[] = [];
  if (!isCompletionPrefix(buf)) { return out; }
  let all = commandList();
  let i = 0;
  while (i < all.length) {
    let name = all[i].name;
    if (name.length >= buf.length && name.slice(0, buf.length) == buf) {
      out.push(all[i]);
    }
    i = i + 1;
  }
  return out;
}

export function wrapDescription(text: string, width: int): string[] {
  let out: string[] = [];
  if (width <= 0) {
    out.push(text);
    return out;
  }
  let words = text.split(" ");
  let line = "";
  let i = 0;
  while (i < words.length) {
    let word = words[i];
    if (line == "") {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line = line + " " + word;
    } else {
      out.push(line);
      line = word;
    }
    i = i + 1;
  }
  if (line != "") { out.push(line); }
  if (out.length == 0) { out.push(""); }
  return out;
}

export class Completion {
  matches: CommandInfo[];
  selected: int;

  constructor() {
    this.matches = [];
    this.selected = 0;
  }

  refresh(buf: string): void {
    let next = matchCommands(buf);
    let changed = next.length != this.matches.length;
    let i = 0;
    while (i < next.length && !changed) {
      if (next[i].name != this.matches[i].name) { changed = true; }
      i = i + 1;
    }
    this.matches = next;
    if (changed || this.selected >= next.length) {
      this.selected = 0;
      let j = 0;
      while (j < next.length) {
        if (next[j].name == buf) { this.selected = j; }
        j = j + 1;
      }
    }
  }

  isOpen(): bool {
    return this.matches.length > 0;
  }

  move(delta: int): void {
    if (this.matches.length == 0) { return; }
    let next = this.selected + delta;
    if (next < 0) { next = 0; }
    if (next > this.matches.length - 1) { next = this.matches.length - 1; }
    this.selected = next;
  }

  selectedName(): string {
    if (this.matches.length == 0) { return ""; }
    return this.matches[this.selected].name;
  }
}

function descriptionWidth(width: int): int {
  return width - LEAD_WIDTH - NAME_COLUMN;
}

function entryRowCount(cmd: CommandInfo, descWidth: int): int {
  if (descWidth < MIN_DESCRIPTION_WIDTH) { return 1; }
  return wrapDescription(cmd.description, descWidth).length;
}

export function firstVisibleEntry(matches: CommandInfo[], descWidth: int, selected: int, listBudget: int): int {
  let start = 0;
  while (start <= selected) {
    let used = 0;
    let fits = false;
    let i = start;
    while (i < matches.length) {
      let n = entryRowCount(matches[i], descWidth);
      if (used + n > listBudget) { break; }
      used = used + n;
      if (i == selected) { fits = true; }
      i = i + 1;
    }
    if (fits) { return start; }
    start = start + 1;
  }
  return selected;
}

export function panelBudget(termRows: int, indicatorRows: int, promptRows: int): int {
  let avail = termRows - STATUS_ROWS - promptRows - indicatorRows - MIN_TRANSCRIPT_ROWS;
  let cap = COMPLETION_MAX_LIST_ROWS + RULE_ROWS;
  if (avail > cap) { avail = cap; }
  if (avail < 2) { return 0; }
  return avail;
}

export function entryRows(cmd: CommandInfo, selected: bool, descWidth: int): string[] {
  let out: string[] = [];
  let lead = "  ";
  let color = VIOLET;
  if (selected) {
    lead = COMPLETION_MARKER;
    color = BOLD + VIOLET;
  }
  if (descWidth < MIN_DESCRIPTION_WIDTH) {
    out.push(lead + wrap(color, cmd.name));
    return out;
  }
  let desc = wrapDescription(cmd.description, descWidth);
  let i = 0;
  while (i < desc.length) {
    if (i == 0) {
      out.push(lead + wrap(color, padColumn(cmd.name, NAME_COLUMN)) + wrap(DIM, desc[i]));
    } else {
      out.push("  " + repeatChar(" ", NAME_COLUMN) + wrap(DIM, desc[i]));
    }
    i = i + 1;
  }
  return out;
}

export function completionRows(c: Completion, width: int, budget: int, drawRule: bool): string[] {
  let out: string[] = [];
  if (!c.isOpen()) { return out; }
  if (budget < 2) { return out; }

  let ruleWidth = width;
  if (ruleWidth < 1) { ruleWidth = 1; }
  let descWidth = descriptionWidth(width);
  let listBudget = budget;
  if (drawRule) { listBudget = budget - RULE_ROWS; }
  let start = firstVisibleEntry(c.matches, descWidth, c.selected, listBudget);

  let used = 0;
  let i = start;
  while (i < c.matches.length) {
    let n = entryRowCount(c.matches[i], descWidth);
    if (used + n > listBudget) { break; }
    let block = entryRows(c.matches[i], i == c.selected, descWidth);
    let j = 0;
    while (j < block.length) {
      out.push(block[j]);
      j = j + 1;
    }
    used = used + n;
    i = i + 1;
  }

  if (out.length == 0) { return out; }
  if (drawRule) {
    out.push(wrap(DIM, repeatChar(RULE_CHAR, ruleWidth)));
  }
  return out;
}
