import { BOLD, UNDERLINE, DIM, VIOLET, RESET, wrap } from "./style.ts";

const CODE_FENCE: string = "```";
const CODE_BORDER: string = DIM + "| " + RESET;
const MAX_HEADER_LEVEL: int = 6;

export type LineSegment = { text: string, isCode: bool };
export type MarkdownLineResult = { text: string, inCodeBlock: bool };

export class MarkdownState {
  pending: string;
  inCodeBlock: bool;

  constructor() {
    this.pending = "";
    this.inCodeBlock = false;
  }
}

function isFenceLine(line: string): bool {
  let t = line.trim();
  return t.length >= CODE_FENCE.length && t.slice(0, CODE_FENCE.length) == CODE_FENCE;
}

function headerLevel(line: string): int {
  let i = 0;
  let n = line.length;
  while (i < n && i < MAX_HEADER_LEVEL && line.charAt(i) == "#") {
    i = i + 1;
  }
  if (i == 0) {
    return 0;
  }
  if (i < n && line.charAt(i) == " ") {
    return i;
  }
  return 0;
}

function isWordByte(ch: string): bool {
  if (ch == "") {
    return false;
  }
  let c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) {
    return true;
  }
  if (c >= 65 && c <= 90) {
    return true;
  }
  if (c >= 97 && c <= 122) {
    return true;
  }
  return c == 95;
}

function charAtOr(text: string, index: int): string {
  if (index < 0 || index >= text.length) {
    return "";
  }
  return text.charAt(index);
}

function styleMarker(text: string, marker: string, color: string): string {
  let out = "";
  let i = 0;
  let n = text.length;
  let m = marker.length;
  while (i < n) {
    if (i + m <= n && text.slice(i, i + m) == marker) {
      let close = text.indexOf(marker, i + m);
      if (close >= 0) {
        out = out + color + text.slice(i + m, close) + RESET;
        i = close + m;
        continue;
      }
    }
    out = out + text.charAt(i);
    i = i + 1;
  }
  return out;
}

function styleItalic(text: string): string {
  let out = "";
  let i = 0;
  let n = text.length;
  while (i < n) {
    if (text.charAt(i) == "_" && !isWordByte(charAtOr(text, i - 1))) {
      let close = -1;
      let j = i + 1;
      while (j < n) {
        if (text.charAt(j) == "_" && !isWordByte(charAtOr(text, j + 1))) {
          close = j;
          break;
        }
        j = j + 1;
      }
      if (close > i + 1) {
        out = out + UNDERLINE + text.slice(i + 1, close) + RESET;
        i = close + 1;
        continue;
      }
    }
    out = out + text.charAt(i);
    i = i + 1;
  }
  return out;
}

function splitCodeSpans(line: string): LineSegment[] {
  let out: LineSegment[] = [];
  let i = 0;
  let n = line.length;
  let plainStart = 0;
  while (i < n) {
    if (line.charAt(i) == "`") {
      let close = line.indexOf("`", i + 1);
      if (close >= 0) {
        if (i > plainStart) {
          out.push({ text: line.slice(plainStart, i), isCode: false });
        }
        out.push({ text: line.slice(i + 1, close), isCode: true });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }
    i = i + 1;
  }
  if (plainStart < n) {
    out.push({ text: line.slice(plainStart, n), isCode: false });
  }
  return out;
}

function styleInline(line: string): string {
  let segments = splitCodeSpans(line);
  let out = "";
  for (const seg of segments) {
    if (seg.isCode) {
      out = out + DIM + seg.text + RESET;
    } else {
      out = out + styleItalic(styleMarker(seg.text, "**", BOLD));
    }
  }
  return out;
}

export function styleMarkdownLine(line: string, inCodeBlock: bool): MarkdownLineResult {
  if (isFenceLine(line)) {
    return { text: wrap(DIM, line), inCodeBlock: !inCodeBlock };
  }
  if (inCodeBlock) {
    return { text: CODE_BORDER + line, inCodeBlock: true };
  }
  let level = headerLevel(line);
  if (level > 0) {
    let rest = "";
    if (level + 1 <= line.length) {
      rest = line.slice(level + 1, line.length);
    }
    return { text: wrap(BOLD + VIOLET, rest), inCodeBlock: false };
  }
  return { text: styleInline(line), inCodeBlock: false };
}

export function appendMarkdownDelta(state: MarkdownState, chunk: string): string {
  if (chunk == "") {
    return "";
  }
  let combined = state.pending + chunk;
  let parts = combined.split("\n");
  let out = "";
  let i = 0;
  while (i < parts.length - 1) {
    let result = styleMarkdownLine(parts[i], state.inCodeBlock);
    state.inCodeBlock = result.inCodeBlock;
    if (i > 0) {
      out = out + "\n";
    }
    out = out + result.text;
    i = i + 1;
  }
  if (parts.length > 1) {
    out = out + "\n";
  }
  state.pending = parts[parts.length - 1];
  return out;
}

export function flushMarkdown(state: MarkdownState): string {
  let out = "";
  if (state.pending != "") {
    let result = styleMarkdownLine(state.pending, state.inCodeBlock);
    out = result.text;
  }
  state.pending = "";
  state.inCodeBlock = false;
  return out;
}
