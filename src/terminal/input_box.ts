import { VIOLET, wrap } from "./style.ts";
import { borderLine, contentLine, visualWidth } from "./layout.ts";
import { BOX_PROMPT_ROWS, PLAIN_PROMPT_ROWS, MIN_ROWS_FOR_BOX, PROMPT_MARKER, CODE_MARKER, promptRowCount, usesBox } from "./prompt_rows.ts";

export { BOX_PROMPT_ROWS, PLAIN_PROMPT_ROWS, MIN_ROWS_FOR_BOX, PROMPT_MARKER, CODE_MARKER, promptRowCount, usesBox };

const CURSOR_MARGIN: int = 1;

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

function plainPrompt(buf: string, marker: string, termWidth: int): PromptRender {
  let avail = termWidth - visualWidth(marker);
  if (avail < 0) { avail = 0; }
  let shown = scrollToEnd(buf, avail);
  let line = wrap(VIOLET, marker) + shown;
  let col = visualWidth(marker) + visualWidth(shown) + 1;
  return { lines: [line], cursorLine: 0, cursorCol: col };
}

function boxPrompt(buf: string, marker: string, termWidth: int): PromptRender {
  let prefix = " " + marker;
  let contentWidth = termWidth - 2;
  let prefixWidth = visualWidth(prefix);
  let avail = contentWidth - prefixWidth - CURSOR_MARGIN;
  if (avail < 0) { avail = 0; }
  let shown = scrollToEnd(buf, avail);

  let top = wrap(VIOLET, borderLine("┌", "┐", termWidth));
  let content = wrap(VIOLET, contentLine(prefix + shown, termWidth));
  let bottom = wrap(VIOLET, borderLine("└", "┘", termWidth));

  let col = 1 + prefixWidth + visualWidth(shown) + 1;
  return { lines: [top, content, bottom], cursorLine: 1, cursorCol: col };
}

export function buildPromptMarked(buf: string, marker: string, termWidth: int, termRows: int): PromptRender {
  if (usesBox(termRows)) {
    return boxPrompt(buf, marker, termWidth);
  }
  return plainPrompt(buf, marker, termWidth);
}

export function buildPrompt(buf: string, termWidth: int, termRows: int): PromptRender {
  return buildPromptMarked(buf, PROMPT_MARKER, termWidth, termRows);
}
