import { VIOLET, wrap } from "./style.ts";
import { borderLine, contentLine, visualWidth } from "./layout.ts";

export const BOX_PROMPT_ROWS: int = 3;
export const PLAIN_PROMPT_ROWS: int = 1;

export const MIN_ROWS_FOR_BOX: int = 12;

const MARKER: string = "> ";
const BOX_PREFIX: string = " " + MARKER;
const CURSOR_MARGIN: int = 1;

export function promptRowCount(termRows: int): int {
  if (termRows >= MIN_ROWS_FOR_BOX) { return BOX_PROMPT_ROWS; }
  return PLAIN_PROMPT_ROWS;
}

export function usesBox(termRows: int): bool {
  return promptRowCount(termRows) == BOX_PROMPT_ROWS;
}

function utf8ByteCount(first: int): int {
  if (first >= 240) { return 4; }
  if (first >= 224) { return 3; }
  if (first >= 192) { return 2; }
  return 1;
}

export function scrollToEnd(text: string, width: int): string {
  if (width <= 0) { return ""; }
  let total = 0;
  let i = 0;
  while (i < text.length) {
    total = total + 1;
    i = i + utf8ByteCount(text.charCodeAt(i));
  }
  if (total <= width) { return text; }
  let skip = total - width;
  let j = 0;
  let n = 0;
  while (n < skip) {
    j = j + utf8ByteCount(text.charCodeAt(j));
    n = n + 1;
  }
  return text.slice(j, text.length);
}

export type PromptRender = { lines: string[], cursorLine: int, cursorCol: int };

function plainPrompt(buf: string, termWidth: int): PromptRender {
  let avail = termWidth - visualWidth(MARKER);
  if (avail < 0) { avail = 0; }
  let shown = scrollToEnd(buf, avail);
  let line = wrap(VIOLET, MARKER) + shown;
  let col = visualWidth(MARKER) + visualWidth(shown) + 1;
  return { lines: [line], cursorLine: 0, cursorCol: col };
}

function boxPrompt(buf: string, termWidth: int): PromptRender {
  let contentWidth = termWidth - 2;
  let prefixWidth = visualWidth(BOX_PREFIX);
  let avail = contentWidth - prefixWidth - CURSOR_MARGIN;
  if (avail < 0) { avail = 0; }
  let shown = scrollToEnd(buf, avail);

  let top = wrap(VIOLET, borderLine("┌", "┐", termWidth));
  let content = wrap(VIOLET, contentLine(BOX_PREFIX + shown, termWidth));
  let bottom = wrap(VIOLET, borderLine("└", "┘", termWidth));

  let col = 1 + prefixWidth + visualWidth(shown) + 1;
  return { lines: [top, content, bottom], cursorLine: 1, cursorCol: col };
}

export function buildPrompt(buf: string, termWidth: int, termRows: int): PromptRender {
  if (usesBox(termRows)) {
    return boxPrompt(buf, termWidth);
  }
  return plainPrompt(buf, termWidth);
}
