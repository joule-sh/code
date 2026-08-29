import { Selection, countLines, plainSlice, highlightRange, rangeForLine, selectedText, selectionIndicator, lineCountWord, COL_END } from "./selection.ts";
import { COPY_TOOL, COPY_TERMINAL, COPY_NOWHERE } from "./clipboard.ts";
import { REVERSE, RESET, ACCENT, DIM } from "./style.ts";

const ESC_CODE: int = 27;

function isSgrTerminator(c: string): bool {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
}

function escapeEnd(line: string, i: int): int {
  let j = i + 1;
  if (j < line.length && line.charAt(j) == "[") {
    j = j + 1;
    while (j < line.length && !isSgrTerminator(line.charAt(j))) { j = j + 1; }
    if (j < line.length) { j = j + 1; }
  }
  return j;
}

function stripSgr(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) == ESC_CODE) {
      i = escapeEnd(line, i);
      continue;
    }
    out = out + line.charAt(i);
    i = i + 1;
  }
  return out;
}

function sgrBalanced(line: string): bool {
  let open = false;
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) == ESC_CODE) {
      let j = escapeEnd(line, i);
      let seq = line.slice(i, j);
      if (seq == RESET) { open = false; } else { open = true; }
      i = j;
      continue;
    }
    i = i + 1;
  }
  return !open;
}

function nothingHidden(i: int): bool {
  return false;
}

function dragged(anchorLine: int, anchorCol: int, headLine: int, headCol: int): Selection {
  let sel = new Selection();
  sel.begin(anchorLine, anchorCol);
  sel.extend(headLine, headCol);
  return sel;
}

test("plainSlice takes a visible column range and drops the styling around it", () => {
  expect(plainSlice("hello world", 1, 5) == "hello");
  expect(plainSlice("hello world", 7, COL_END) == "world");
  expect(plainSlice(ACCENT + "hello" + RESET + " world", 1, 5) == "hello");
  expect(plainSlice("hello", 4, 2) == "");
});

test("plainSlice counts a multi-byte character as one column", () => {
  let line = "caf" + String.fromCharCode(195) + String.fromCharCode(169) + " bar";
  expect(plainSlice(line, 1, 4) == "caf" + String.fromCharCode(195) + String.fromCharCode(169));
  expect(plainSlice(line, 6, COL_END) == "bar");
});

test("highlightRange puts the range in reverse video and closes it again", () => {
  let out = highlightRange("abcdef", 3, 4);
  expect(out == "ab" + RESET + REVERSE + "cd" + RESET + "ef");
  expect(sgrBalanced(out));
});

test("a highlight that runs to the end of the line still closes its attribute", () => {
  let out = highlightRange("abcdef", 3, COL_END);
  expect(out == "ab" + RESET + REVERSE + "cdef" + RESET);
  expect(sgrBalanced(out));
});

test("highlighting never adds or drops a visible character", () => {
  expect(stripSgr(highlightRange("abcdef", 2, 4)) == "abcdef");
  expect(stripSgr(highlightRange(ACCENT + "abcdef" + RESET, 2, 4)) == "abcdef");
  expect(stripSgr(highlightRange("abcdef", 1, COL_END)) == "abcdef");
  expect(stripSgr(highlightRange("abcdef", 9, 12)) == "abcdef");
});

test("a highlight inside a coloured line reopens that colour afterwards and stays balanced", () => {
  let out = highlightRange(ACCENT + "abcdef" + RESET, 3, 4);
  expect(out.indexOf(REVERSE) > 0);
  expect(sgrBalanced(out));
  expect(out.endsWith(RESET));
});

test("a highlight is balanced whatever shape the underlying line has", () => {
  expect(sgrBalanced(highlightRange("plain text", 2, 5)));
  expect(sgrBalanced(highlightRange(DIM + "dim text" + RESET, 1, COL_END)));
  expect(sgrBalanced(highlightRange("lead " + ACCENT + "mid" + RESET + " tail", 4, 8)));
  expect(sgrBalanced(highlightRange("", 1, 5)));
});

test("a range that starts past the end of the line leaves it untouched", () => {
  expect(highlightRange("abc", 10, 20) == "abc");
});

test("a press with no movement is not a range, so a plain click selects nothing", () => {
  let sel = new Selection();
  sel.begin(4, 6);
  expect(!sel.hasRange());
  sel.extend(4, 6);
  expect(!sel.hasRange());
  expect(selectionIndicator(sel) == "");
});

test("a drag becomes a range as soon as the pointer leaves the anchor", () => {
  let sel = dragged(4, 6, 4, 9);
  expect(sel.hasRange());
  expect(sel.startCol() == 6);
  expect(sel.endCol() == 9);
  expect(sel.lineSpan() == 1);
});

test("a backwards drag reads out in document order", () => {
  let sel = dragged(9, 4, 6, 2);
  expect(sel.startLine() == 6);
  expect(sel.startCol() == 2);
  expect(sel.endLine() == 9);
  expect(sel.endCol() == 4);
  expect(sel.lineSpan() == 4);
});

test("rangeForLine opens the middle lines fully and clips the first and last", () => {
  let sel = dragged(2, 5, 4, 3);
  let first = rangeForLine(sel, 2);
  expect(first.from == 5);
  expect(first.to == COL_END);
  let middle = rangeForLine(sel, 3);
  expect(middle.from == 1);
  expect(middle.to == COL_END);
  let last = rangeForLine(sel, 4);
  expect(last.from == 1);
  expect(last.to == 3);
  expect(rangeForLine(sel, 1).to < rangeForLine(sel, 1).from);
  expect(rangeForLine(sel, 5).to < rangeForLine(sel, 5).from);
});

test("selectedText stitches the partial first and last lines around the whole middle", () => {
  let lines: string[] = ["zero", "alpha", "beta", "gamma", "delta"];
  let sel = dragged(1, 3, 3, 2);
  expect(selectedText(sel, lines, nothingHidden) == "pha" + String.fromCharCode(10) + "beta" + String.fromCharCode(10) + "ga");
});

test("selectedText takes the text under the styling, not the escape bytes", () => {
  let lines: string[] = [ACCENT + "coloured" + RESET];
  let sel = dragged(0, 1, 0, COL_END);
  expect(selectedText(sel, lines, nothingHidden) == "coloured");
});

test("a selection with no range yields no text at all", () => {
  let sel = new Selection();
  sel.begin(0, 1);
  expect(selectedText(sel, ["anything"], nothingHidden) == "");
});

test("the row map turns a screen row back into the scrollback line under it", () => {
  let sel = new Selection();
  sel.setRowMap([-1, -1, 7, 8, -1]);
  expect(sel.lineAtRow(2) == 7);
  expect(sel.lineAtRow(3) == 8);
  expect(sel.lineAtRow(1) == -1);
  expect(sel.lineAtRow(99) == -1);
  expect(sel.lineAtRow(-2) == -1);
});

test("the indicator says what is happening in words, not only in colour", () => {
  let sel = dragged(2, 1, 4, 5);
  expect(selectionIndicator(sel).indexOf("selecting 3 lines") >= 0);
  expect(selectionIndicator(sel).indexOf("release to copy") >= 0);
  sel.dragging = false;
  sel.copied = true;
  sel.copiedLines = 3;
  sel.copiedWhere = COPY_TOOL;
  let done = selectionIndicator(sel);
  expect(done.indexOf("copied 3 lines") >= 0);
  expect(done.indexOf("/mouse off") < 0);
});

test("the indicator claims a copy only when a clipboard command took the text", () => {
  let sel = dragged(2, 1, 4, 5);
  sel.dragging = false;
  sel.copied = true;
  sel.copiedLines = 3;
  sel.copiedWhere = COPY_TERMINAL;
  let asked = selectionIndicator(sel);
  expect(asked.indexOf("copied") < 0);
  expect(asked.indexOf("asked the terminal for 3 lines") >= 0);
  expect(asked.indexOf("nothing pasted") >= 0);
  expect(asked.indexOf("/mouse off") >= 0);
  sel.copiedWhere = COPY_NOWHERE;
  let none = selectionIndicator(sel);
  expect(none.indexOf("copied") < 0);
  expect(none.indexOf("no clipboard here") >= 0);
  expect(none.indexOf("/mouse off") >= 0);
});

test("each indicator fits an 80 column terminal without being clipped", () => {
  let sel = dragged(2, 1, 4, 5);
  expect(selectionIndicator(sel).length <= 80);
  sel.dragging = false;
  sel.copied = true;
  sel.copiedLines = 99999;
  sel.copiedWhere = COPY_TOOL;
  expect(selectionIndicator(sel).length <= 80);
  sel.copiedWhere = COPY_TERMINAL;
  expect(selectionIndicator(sel).length <= 80);
  sel.copiedWhere = COPY_NOWHERE;
  expect(selectionIndicator(sel).length <= 80);
});

test("a cleared selection shows nothing and highlights nothing", () => {
  let sel = dragged(2, 1, 4, 5);
  sel.copied = true;
  sel.copiedWhere = COPY_TOOL;
  sel.clear();
  expect(sel.copiedWhere == "");
  expect(!sel.hasRange());
  expect(!sel.isLive());
  expect(selectionIndicator(sel) == "");
  expect(rangeForLine(sel, 3).to < rangeForLine(sel, 3).from);
});

test("lineCountWord keeps the singular readable", () => {
  expect(lineCountWord(1) == "1 line");
  expect(lineCountWord(4) == "4 lines");
});

test("selectedText skips the lines a caller reports as hidden, and countLines agrees", () => {
  let lines: string[] = ["alpha", "beta", "gamma"];
  let sel = dragged(0, 1, 2, COL_END);
  let hideMiddle = (i: int) => i == 1;
  let out = selectedText(sel, lines, hideMiddle);
  expect(out == "alpha" + String.fromCharCode(10) + "gamma");
  expect(countLines(out) == 2);
  expect(countLines(selectedText(sel, lines, nothingHidden)) == 3);
  expect(countLines("") == 0);
});
