import { collapsedMarker, expandedMarker } from "./collapse.ts";
import { Selection } from "./selection.ts";
import { wrapToWidth } from "./wrap.ts";

export class CollapseGroup {
  markerRow: int;
  bodyStart: int;
  bodyEnd: int;
  hidden: int;
  expanded: bool;

  constructor(markerRow: int, bodyStart: int, bodyEnd: int, hidden: int) {
    this.markerRow = markerRow;
    this.bodyStart = bodyStart;
    this.bodyEnd = bodyEnd;
    this.hidden = hidden;
    this.expanded = false;
  }

  covers(index: int): bool {
    return index >= this.bodyStart && index < this.bodyEnd;
  }

  size(): int {
    return this.bodyEnd - this.bodyStart;
  }
}

export class Scrollback {
  lines: string[];
  offset: int;
  groups: CollapseGroup[];
  selection: Selection;
  width: int;

  constructor() {
    this.lines = [""];
    this.offset = 0;
    this.groups = [];
    this.selection = new Selection();
    this.width = 0;
  }

  setWidth(width: int): void {
    this.width = width;
  }

  appendFixed(text: string): void {
    this.pushParts(text.split("\n"), false);
  }

  append(text: string): void {
    this.pushParts(text.split("\n"), true);
  }

  pushParts(parts: string[], reflow: bool): void {
    let before = this.lines.length;
    let i = 0;
    while (i < parts.length) {
      if (i == 0) {
        if (parts[0] != "") {
          let last = this.lines.length - 1;
          let merged = this.lines[last] + parts[0];
          this.lines = [...this.lines.slice(0, last), ...this.rows(merged, reflow)];
        }
      } else {
        for (const row of this.rows(parts[i], reflow)) { this.lines.push(row); }
      }
      i = i + 1;
    }
    if (this.offset > 0) {
      let added = this.lines.length - before;
      if (added > 0) {
        this.offset = this.offset + added;
      }
    }
  }

  rows(line: string, reflow: bool): string[] {
    if (!reflow || this.width <= 0) { return [line]; }
    return wrapToWidth(line, this.width);
  }

  appendBlock(text: string): void {
    if (text == "") { return; }
    if (text.charAt(0) == "\n" || this.lines[this.lines.length - 1] == "") {
      this.append(text);
      return;
    }
    this.append("\n" + text);
  }

  appendCollapsible(head: string, body: string, hidden: int): void {
    let startLen = this.lines.length;
    let startOffset = this.offset;
    this.append(head);
    let markerRow = this.lines.length;
    this.append("\n" + collapsedMarker(hidden));
    let bodyStart = this.lines.length;
    this.append("\n" + body);
    let actual = this.lines.length - bodyStart;
    this.setLine(markerRow, collapsedMarker(actual));
    this.groups.push(new CollapseGroup(markerRow, bodyStart, this.lines.length, actual));
    if (startOffset > 0) {
      this.offset = startOffset + (markerRow - startLen) + 1;
    }
  }

  clear(): void {
    this.lines = [""];
    this.offset = 0;
    this.groups = [];
    this.selection.clear();
  }

  setLine(index: int, text: string): void {
    if (index < 0 || index >= this.lines.length) {
      return;
    }
    this.lines = [...this.lines.slice(0, index), text, ...this.lines.slice(index + 1, this.lines.length)];
  }

  lineCount(): int {
    return this.lines.length;
  }

  isHidden(index: int): bool {
    for (const g of this.groups) {
      if (!g.expanded && g.covers(index)) {
        return true;
      }
    }
    return false;
  }

  visibleCount(): int {
    let n = this.lines.length;
    for (const g of this.groups) {
      if (!g.expanded) {
        n = n - g.size();
      }
    }
    return n;
  }

  collapsedCount(): int {
    let n = 0;
    for (const g of this.groups) {
      if (!g.expanded) {
        n = n + 1;
      }
    }
    return n;
  }

  toggleLastGroup(): bool {
    if (this.groups.length == 0) {
      return false;
    }
    let g = this.groups[this.groups.length - 1];
    g.expanded = !g.expanded;
    if (g.expanded) {
      this.setLine(g.markerRow, expandedMarker(g.hidden));
    } else {
      this.setLine(g.markerRow, collapsedMarker(g.hidden));
    }
    this.resetToBottom();
    return true;
  }

  tail(n: int): string[] {
    return this.tailFrom(n, 0);
  }

  tailIndicesFrom(visible: int, offset: int): int[] {
    let off = offset;
    if (off < 0) {
      off = 0;
    }
    let m = this.maxOffset(visible);
    if (off > m) {
      off = m;
    }
    let picked: int[] = [];
    let skipped = 0;
    let i = this.lines.length - 1;
    while (i >= 0 && picked.length < visible) {
      if (!this.isHidden(i)) {
        if (skipped < off) {
          skipped = skipped + 1;
        } else {
          picked.push(i);
        }
      }
      i = i - 1;
    }
    let out: int[] = [];
    let j = picked.length - 1;
    while (j >= 0) {
      out.push(picked[j]);
      j = j - 1;
    }
    return out;
  }

  tailFrom(visible: int, offset: int): string[] {
    let out: string[] = [];
    for (const i of this.tailIndicesFrom(visible, offset)) {
      out.push(this.lines[i]);
    }
    return out;
  }

  maxOffset(visible: int): int {
    let m = this.visibleCount() - visible;
    if (m < 0) {
      m = 0;
    }
    return m;
  }

  scrollUp(visible: int, n: int): void {
    this.offset = this.offset + n;
    let m = this.maxOffset(visible);
    if (this.offset > m) {
      this.offset = m;
    }
  }

  scrollDown(visible: int, n: int): void {
    this.offset = this.offset - n;
    if (this.offset < 0) {
      this.offset = 0;
    }
  }

  resetToBottom(): void {
    this.offset = 0;
  }

  isAtBottom(): bool {
    return this.offset <= 0;
  }
}
