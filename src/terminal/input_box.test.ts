import { promptRowCount, usesBox, scrollToEnd, buildPrompt, buildPromptMarked, PROMPT_MARKER, CODE_MARKER, MIN_ROWS_FOR_BOX, BOX_PROMPT_ROWS, PLAIN_PROMPT_ROWS } from "./input_box.ts";
import { VIOLET, RESET } from "./style.ts";
import { visualWidth } from "./layout.ts";

function removeAll(line: string, needle: string): string {
  let out = line;
  let idx = out.indexOf(needle);
  while (idx >= 0) {
    out = out.slice(0, idx) + out.slice(idx + needle.length, out.length);
    idx = out.indexOf(needle);
  }
  return out;
}

function stripColor(line: string): string {
  return removeAll(removeAll(line, VIOLET), RESET);
}

test("the row threshold is 12, matching the two short cases verify_layout.py tests on either side of it", () => {
  expect(MIN_ROWS_FOR_BOX == 12);
});

test("the prompt is a single plain row below the threshold and a three row box at or above it", () => {
  expect(promptRowCount(4) == PLAIN_PROMPT_ROWS);
  expect(promptRowCount(10) == PLAIN_PROMPT_ROWS);
  expect(promptRowCount(11) == PLAIN_PROMPT_ROWS);
  expect(promptRowCount(12) == BOX_PROMPT_ROWS);
  expect(promptRowCount(13) == BOX_PROMPT_ROWS);
  expect(promptRowCount(24) == BOX_PROMPT_ROWS);
  expect(!usesBox(11));
  expect(usesBox(12));
});

test("scrollToEnd keeps the buffer whole when it already fits the width", () => {
  expect(scrollToEnd("hello", 10) == "hello");
  expect(scrollToEnd("hello", 5) == "hello");
});

test("scrollToEnd keeps the tail rather than the head, so an append-only cursor stays visible", () => {
  expect(scrollToEnd("hello world", 5) == "world");
  expect(scrollToEnd("abcdef", 3) == "def");
});

test("scrollToEnd counts columns, not UTF-8 bytes, and never splits a multi-byte character", () => {
  let text = "héllo wörld";
  expect(scrollToEnd(text, 5) == "wörld");
  expect(scrollToEnd(text, 11) == text);
});

test("a width of zero or less produces an empty window rather than crashing", () => {
  expect(scrollToEnd("anything", 0) == "");
  expect(scrollToEnd("anything", -1) == "");
});

test("below the row threshold the prompt is the bare marker on one row", () => {
  let render = buildPrompt("hi", 80, 10);
  expect(render.lines.length == 1);
  expect(render.cursorLine == 0);
  expect(render.lines[0].indexOf(VIOLET) == 0);
  expect(render.lines[0].indexOf("hi") >= 0);
});

test("the plain prompt cursor sits immediately after the typed text", () => {
  let render = buildPrompt("hi", 80, 10);
  expect(render.cursorCol == 5);
});

test("at and above the row threshold the prompt is a three row bordered box", () => {
  let render = buildPrompt("hi", 40, 12);
  expect(render.lines.length == 3);
  expect(render.cursorLine == 1);
  let below = buildPrompt("hi", 40, 11);
  expect(below.lines.length == 1);
});

test("the box has square single-line corners, like the welcome box", () => {
  let render = buildPrompt("", 60, 24);
  let top = stripColor(render.lines[0]);
  let bottom = stripColor(render.lines[2]);
  expect(top.slice(0, 3) == "┌");
  expect(top.slice(top.length - 3, top.length) == "┐");
  expect(bottom.slice(0, 3) == "└");
  expect(bottom.slice(bottom.length - 3, bottom.length) == "┘");
});

test("the content row is flanked by single vertical bars", () => {
  let render = buildPrompt("hi", 50, 24);
  let content = stripColor(render.lines[1]);
  expect(content.slice(0, 3) == "│");
  expect(content.slice(content.length - 3, content.length) == "│");
});

test("the prompt marker stays legible inside the box", () => {
  let render = buildPrompt("hi", 50, 24);
  expect(render.lines[1].indexOf("> ") >= 0);
  expect(render.lines[1].indexOf("hi") >= 0);
});

test("every row of the box is exactly the terminal width, in columns, at several widths", () => {
  let widths: int[] = [20, 40, 45, 80, 120];
  let w = 0;
  while (w < widths.length) {
    let width = widths[w];
    let render = buildPrompt("some typed text", width, 24);
    let i = 0;
    while (i < render.lines.length) {
      expect(visualWidth(stripColor(render.lines[i])) == width);
      i = i + 1;
    }
    w = w + 1;
  }
});

test("every row of the plain prompt is at most the terminal width, at several widths", () => {
  let widths: int[] = [20, 40, 45, 80, 120];
  let w = 0;
  while (w < widths.length) {
    let width = widths[w];
    let render = buildPrompt("some typed text", width, 10);
    expect(visualWidth(stripColor(render.lines[0])) <= width);
    w = w + 1;
  }
});

test("a long line scrolls horizontally inside the box, keeping the append-only cursor in view", () => {
  let long = "";
  let i = 0;
  while (i < 200) {
    long = long + "x";
    i = i + 1;
  }
  let render = buildPrompt(long, 40, 24);
  let content = stripColor(render.lines[1]);
  expect(visualWidth(content) == 40);
  expect(content.indexOf("x") >= 0);
  expect(render.cursorCol > 1);
  expect(render.cursorCol < 40);
});

test("the box cursor never lands on the right border, even when the buffer overruns the row", () => {
  let widths: int[] = [20, 30, 45, 80];
  let w = 0;
  while (w < widths.length) {
    let width = widths[w];
    let long = "";
    let i = 0;
    while (i < 200) {
      long = long + "y";
      i = i + 1;
    }
    let render = buildPrompt(long, width, 24);
    expect(render.cursorCol < width);
    w = w + 1;
  }
});

test("a long line in the plain prompt scrolls too, so typing never wraps onto a second row", () => {
  let long = "";
  let i = 0;
  while (i < 200) {
    long = long + "z";
    i = i + 1;
  }
  let render = buildPrompt(long, 40, 10);
  expect(render.lines.length == 1);
  expect(visualWidth(stripColor(render.lines[0])) <= 40);
});

test("a terminal too narrow for any content still renders well-formed rows without crashing", () => {
  let boxed = buildPrompt("hello", 4, 24);
  expect(boxed.lines.length == 3);
  let plain = buildPrompt("hello", 0, 10);
  expect(plain.lines.length == 1);
});

test("an empty buffer still places the cursor right after the marker", () => {
  let plain = buildPrompt("", 80, 10);
  expect(plain.cursorCol == 3);
  let boxed = buildPrompt("", 80, 24);
  expect(boxed.cursorCol == 5);
});

test("the code prompt is drawn inside the box, as its content row, not as a second prompt below it", () => {
  let render = buildPromptMarked("ABC234", CODE_MARKER, 80, 24);
  expect(render.lines.length == BOX_PROMPT_ROWS);
  expect(render.lines[1].indexOf(CODE_MARKER + "ABC234") >= 0);
  expect(render.cursorLine == 1);
  expect(render.cursorCol == 1 + 1 + CODE_MARKER.length + 6 + 1);
});

test("a marked prompt degrades to the same single plain row a short terminal always gets", () => {
  let render = buildPromptMarked("ABC234", CODE_MARKER, 45, 10);
  expect(render.lines.length == PLAIN_PROMPT_ROWS);
  expect(render.lines[0].indexOf(CODE_MARKER) >= 0);
  expect(render.cursorLine == 0);
});

test("a long entry scrolls inside the marked prompt rather than pushing the box wider", () => {
  let render = buildPromptMarked("0123456789012345678901234567890123456789", CODE_MARKER, 30, 24);
  let content = render.lines[1];
  expect(content.indexOf("9") >= 0);
  expect(render.cursorCol <= 30);
});

test("buildPrompt is the marked prompt with the ordinary marker, so the two cannot drift", () => {
  let plain = buildPrompt("hi", 80, 24);
  let marked = buildPromptMarked("hi", PROMPT_MARKER, 80, 24);
  expect(plain.lines.length == marked.lines.length);
  expect(plain.lines[1] == marked.lines[1]);
  expect(plain.cursorCol == marked.cursorCol);
});
