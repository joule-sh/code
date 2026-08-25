import { REVERSE, RESET } from "./style.ts";

const ESC_CODE: int = 27;
export const COL_END: int = 1000000;

export type ColRange = { from: int, to: int };

const NO_RANGE: ColRange = { from: 0, to: -1 };

function isSgrTerminator(c: string): bool {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
}

function utf8ByteCount(first: int): int {
  if (first >= 240) { return 4; }
  if (first >= 224) { return 3; }
  if (first >= 192) { return 2; }
  return 1;
}

function escapeEnd(line: string, i: int): int {
  let j = i + 1;
  if (j < line.length && line.charAt(j) == "[") {
    j = j + 1;
    while (j < line.length && !isSgrTerminator(line.charAt(j))) {
      j = j + 1;
    }
    if (j < line.length) { j = j + 1; }
  }
  return j;
}

function charEnd(line: string, i: int): int {
  let end = i + utf8ByteCount(line.charCodeAt(i));
  if (end > line.length) { end = line.length; }
  return end;
}

export function plainSlice(line: string, fromCol: int, toCol: int): string {
  if (toCol < fromCol) { return ""; }
  let out = "";
  let col = 1;
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) == ESC_CODE) {
      i = escapeEnd(line, i);
      continue;
    }
    let end = charEnd(line, i);
    if (col >= fromCol && col <= toCol) { out = out + line.slice(i, end); }
    col = col + 1;
    i = end;
  }
  return out;
}

export function highlightRange(line: string, fromCol: int, toCol: int): string {
  if (toCol < fromCol) { return line; }
  let out = "";
  let openPrefix = "";
  let inHighlight = false;
  let col = 1;
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) == ESC_CODE) {
      let j = escapeEnd(line, i);
      let seq = line.slice(i, j);
      if (seq == RESET) { openPrefix = ""; } else { openPrefix = openPrefix + seq; }
      if (!inHighlight) { out = out + seq; }
      i = j;
      continue;
    }
    if (!inHighlight && col >= fromCol && col <= toCol) {
      out = out + RESET + REVERSE;
      inHighlight = true;
    } else if (inHighlight && col > toCol) {
      out = out + RESET + openPrefix;
      inHighlight = false;
    }
    let end = charEnd(line, i);
    out = out + line.slice(i, end);
    col = col + 1;
    i = end;
  }
  if (inHighlight) {
    out = out + RESET;
    openPrefix = "";
  }
  if (openPrefix != "") { out = out + RESET; }
  return out;
}

export class Selection {
  enabled: bool;
  anchorLine: int;
  anchorCol: int;
  headLine: int;
  headCol: int;
  dragging: bool;
  moved: bool;
  copied: bool;
  copiedLines: int;
  rowLine: int[];

  constructor() {
    this.enabled = true;
    this.anchorLine = -1;
    this.anchorCol = 0;
    this.headLine = -1;
    this.headCol = 0;
    this.dragging = false;
    this.moved = false;
    this.copied = false;
    this.copiedLines = 0;
    this.rowLine = [];
  }

  setRowMap(map: int[]): void {
    this.rowLine = map;
  }

  lineAtRow(row: int): int {
    if (row < 0 || row >= this.rowLine.length) { return -1; }
    return this.rowLine[row];
  }

  clear(): void {
    this.anchorLine = -1;
    this.headLine = -1;
    this.dragging = false;
    this.moved = false;
    this.copied = false;
    this.copiedLines = 0;
  }

  begin(line: int, col: int): void {
    this.clear();
    this.anchorLine = line;
    this.anchorCol = col;
    this.headLine = line;
    this.headCol = col;
    this.dragging = true;
  }

  extend(line: int, col: int): void {
    if (!this.dragging) { return; }
    this.headLine = line;
    this.headCol = col;
    if (line != this.anchorLine || col != this.anchorCol) { this.moved = true; }
  }

  hasRange(): bool {
    return this.anchorLine >= 0 && this.headLine >= 0 && this.moved;
  }

  isLive(): bool {
    return (this.dragging && this.hasRange()) || this.copied;
  }

  forward(): bool {
    if (this.anchorLine != this.headLine) { return this.anchorLine < this.headLine; }
    return this.anchorCol <= this.headCol;
  }

  startLine(): int {
    if (this.forward()) { return this.anchorLine; }
    return this.headLine;
  }

  startCol(): int {
    if (this.forward()) { return this.anchorCol; }
    return this.headCol;
  }

  endLine(): int {
    if (this.forward()) { return this.headLine; }
    return this.anchorLine;
  }

  endCol(): int {
    if (this.forward()) { return this.headCol; }
    return this.anchorCol;
  }

  lineSpan(): int {
    return this.endLine() - this.startLine() + 1;
  }
}

export function rangeForLine(sel: Selection, lineIndex: int): ColRange {
  if (!sel.hasRange()) { return NO_RANGE; }
  let first = sel.startLine();
  let last = sel.endLine();
  if (lineIndex < first || lineIndex > last) { return NO_RANGE; }
  let from = 1;
  let to = COL_END;
  if (lineIndex == first) { from = sel.startCol(); }
  if (lineIndex == last) { to = sel.endCol(); }
  return { from: from, to: to };
}

export function selectedText(sel: Selection, lines: string[], isHidden: (i: int) => bool): string {
  if (!sel.hasRange()) { return ""; }
  let out = "";
  let i = sel.startLine();
  let wrote = 0;
  while (i <= sel.endLine()) {
    if (i >= 0 && i < lines.length && !isHidden(i)) {
      let r = rangeForLine(sel, i);
      if (wrote > 0) { out = out + String.fromCharCode(10); }
      out = out + plainSlice(lines[i], r.from, r.to);
      wrote = wrote + 1;
    }
    i = i + 1;
  }
  return out;
}

export function countLines(text: string): int {
  if (text == "") { return 0; }
  return text.split(String.fromCharCode(10)).length;
}

export function lineCountWord(n: int): string {
  if (n == 1) { return "1 line"; }
  return `${n}` + " lines";
}

export function selectionIndicator(sel: Selection): string {
  if (sel.dragging && sel.hasRange()) {
    return "-- selecting " + lineCountWord(sel.lineSpan()) + ", release to copy --";
  }
  if (sel.copied) {
    return "-- copied " + lineCountWord(sel.copiedLines) + " - Esc clears - /mouse off if nothing pasted --";
  }
  return "";
}
