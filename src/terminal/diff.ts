import { DIM, GREEN, RED, RESET } from "./style.ts";

export const DIFF_ROW_SAME: string = "same";
export const DIFF_ROW_ADD: string = "add";
export const DIFF_ROW_DEL: string = "del";

export type DiffRow = { kind: string, text: string, a: int, b: int };
export type DiffCounts = { added: int, removed: int };

const DIFF_MAX_LINES: int = 4000;
const DIFF_MAX_CELLS: int = 1000000;
export const DIFF_DISPLAY_MAX_ROWS: int = 400;

function sliceStrings(items: string[], start: int, end: int): string[] {
  let out: string[] = [];
  let i = start;
  while (i < end) {
    out.push(items[i]);
    i = i + 1;
  }
  return out;
}

function buildTableRows(midA: string[], midB: string[]): int[][] {
  let w = midB.length + 1;
  let rows: int[][] = [];
  let zeroRow: int[] = [];
  let z = 0;
  while (z < w) {
    zeroRow.push(0);
    z = z + 1;
  }
  rows.push(zeroRow);

  let i = midA.length - 1;
  while (i >= 0) {
    let below = rows[rows.length - 1];
    let rev: int[] = [];
    let right = 0;
    let j = midB.length - 1;
    while (j >= 0) {
      let v = 0;
      if (midA[i] == midB[j]) {
        v = below[j + 1] + 1;
      } else {
        v = Math.max(below[j], right);
      }
      rev.push(v);
      right = v;
      j = j - 1;
    }
    let row: int[] = [];
    let k = rev.length - 1;
    while (k >= 0) {
      row.push(rev[k]);
      k = k - 1;
    }
    row.push(0);
    rows.push(row);
    i = i - 1;
  }
  return rows;
}

function cellAt(rows: int[][], midALen: int, i: int, j: int): int {
  return rows[midALen - i][j];
}

export function diffLines(oldText: string, newText: string): DiffRow[] | null {
  let a = oldText.split("\n");
  let b = newText.split("\n");
  if (a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES) {
    return null;
  }

  let start = 0;
  while (start < a.length && start < b.length && a[start] == b[start]) {
    start = start + 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] == b[endB - 1]) {
    endA = endA - 1;
    endB = endB - 1;
  }

  let midA = sliceStrings(a, start, endA);
  let midB = sliceStrings(b, start, endB);
  if (midA.length * midB.length > DIFF_MAX_CELLS) {
    return null;
  }

  let rows = buildTableRows(midA, midB);
  let midALen = midA.length;

  let out: DiffRow[] = [];
  let n = 0;
  while (n < start) {
    out.push({ kind: DIFF_ROW_SAME, text: a[n], a: n + 1, b: n + 1 });
    n = n + 1;
  }

  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] == midB[j]) {
      out.push({ kind: DIFF_ROW_SAME, text: midA[i], a: start + i + 1, b: start + j + 1 });
      i = i + 1;
      j = j + 1;
    } else if (cellAt(rows, midALen, i + 1, j) >= cellAt(rows, midALen, i, j + 1)) {
      out.push({ kind: DIFF_ROW_DEL, text: midA[i], a: start + i + 1, b: 0 });
      i = i + 1;
    } else {
      out.push({ kind: DIFF_ROW_ADD, text: midB[j], a: 0, b: start + j + 1 });
      j = j + 1;
    }
  }
  while (i < midA.length) {
    out.push({ kind: DIFF_ROW_DEL, text: midA[i], a: start + i + 1, b: 0 });
    i = i + 1;
  }
  while (j < midB.length) {
    out.push({ kind: DIFF_ROW_ADD, text: midB[j], a: 0, b: start + j + 1 });
    j = j + 1;
  }

  let m = 0;
  while (m < a.length - endA) {
    out.push({ kind: DIFF_ROW_SAME, text: a[endA + m], a: endA + m + 1, b: endB + m + 1 });
    m = m + 1;
  }
  return out;
}

export function diffCounts(rows: DiffRow[]): DiffCounts {
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.kind == DIFF_ROW_ADD) { added = added + 1; }
    if (r.kind == DIFF_ROW_DEL) { removed = removed + 1; }
  }
  return { added: added, removed: removed };
}

function gutterFor(row: DiffRow): int {
  if (row.kind == DIFF_ROW_ADD) { return row.b; }
  return row.a;
}

function padLeftNum(n: int, width: int): string {
  let s = `${n}`;
  while (s.length < width) {
    s = " " + s;
  }
  return s;
}

function gutterWidth(rows: DiffRow[]): int {
  let width = 2;
  for (const r of rows) {
    let s = `${gutterFor(r)}`;
    if (s.length > width) { width = s.length; }
  }
  return width;
}

function joinWithNewline(lines: string[]): string {
  let out = "";
  let i = 0;
  while (i < lines.length) {
    if (i > 0) { out = out + "\n"; }
    out = out + lines[i];
    i = i + 1;
  }
  return out;
}

export function renderDiffRows(rows: DiffRow[]): string {
  if (rows.length == 0) {
    return "";
  }
  let width = gutterWidth(rows);
  let lines: string[] = [];
  for (const r of rows) {
    let gutter = DIM + padLeftNum(gutterFor(r), width) + RESET;
    if (r.kind == DIFF_ROW_ADD) {
      lines.push(gutter + " " + GREEN + "+ " + r.text + RESET);
    } else if (r.kind == DIFF_ROW_DEL) {
      lines.push(gutter + " " + RED + "- " + r.text + RESET);
    } else {
      lines.push(gutter + "   " + r.text);
    }
  }
  return joinWithNewline(lines);
}
