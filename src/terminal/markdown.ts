import { BOLD, UNDERLINE, DIM, VIOLET, RESET, wrap } from "./style.ts";

const CODE_FENCE: string = "```";
const CODE_BORDER: string = DIM + "| " + RESET;
const MAX_HEADER_LEVEL: int = 6;
const BOLD_MARKER: string = "**";

export type CodeSpan = { open: int, close: int };
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

function findCodeSpans(line: string): CodeSpan[] {
  let out: CodeSpan[] = [];
  let i = 0;
  let n = line.length;
  while (i < n) {
    if (line.charAt(i) == "`") {
      let close = line.indexOf("`", i + 1);
      if (close >= 0) {
        out.push({ open: i, close: close });
        i = close + 1;
        continue;
      }
    }
    i = i + 1;
  }
  return out;
}

function codeSpanCloseAt(spans: CodeSpan[], index: int): int {
  for (const span of spans) {
    if (span.open == index) {
      return span.close;
    }
  }
  return -1;
}

function insideCodeSpan(spans: CodeSpan[], index: int): bool {
  for (const span of spans) {
    if (index >= span.open && index <= span.close) {
      return true;
    }
  }
  return false;
}

function boldCloseAt(text: string, spans: CodeSpan[], start: int): int {
  let n = text.length;
  let m = BOLD_MARKER.length;
  if (start + m > n || text.slice(start, start + m) != BOLD_MARKER) {
    return -1;
  }
  let i = start + m;
  while (i + m <= n) {
    if (!insideCodeSpan(spans, i) && text.slice(i, i + m) == BOLD_MARKER) {
      return i;
    }
    i = i + 1;
  }
  return -1;
}

function italicCloseAt(text: string, spans: CodeSpan[], start: int): int {
  if (text.charAt(start) != "_" || isWordByte(charAtOr(text, start - 1))) {
    return -1;
  }
  let n = text.length;
  let i = start + 1;
  while (i < n) {
    if (!insideCodeSpan(spans, i) && text.charAt(i) == "_" && !isWordByte(charAtOr(text, i + 1))) {
      if (i > start + 1) {
        return i;
      }
      return -1;
    }
    i = i + 1;
  }
  return -1;
}

function styleSpans(text: string, active: string): string {
  let spans = findCodeSpans(text);
  let out = "";
  let i = 0;
  let n = text.length;
  while (i < n) {
    let codeClose = codeSpanCloseAt(spans, i);
    if (codeClose >= 0) {
      out = out + DIM + text.slice(i + 1, codeClose) + RESET + active;
      i = codeClose + 1;
      continue;
    }
    let boldClose = boldCloseAt(text, spans, i);
    if (boldClose >= 0) {
      let inner = text.slice(i + BOLD_MARKER.length, boldClose);
      out = out + BOLD + styleSpans(inner, active + BOLD) + RESET + active;
      i = boldClose + BOLD_MARKER.length;
      continue;
    }
    let italicClose = italicCloseAt(text, spans, i);
    if (italicClose >= 0) {
      let innerItalic = text.slice(i + 1, italicClose);
      out = out + UNDERLINE + styleSpans(innerItalic, active + UNDERLINE) + RESET + active;
      i = italicClose + 1;
      continue;
    }
    out = out + text.charAt(i);
    i = i + 1;
  }
  return out;
}

function styleInline(line: string): string {
  return styleSpans(line, "");
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
