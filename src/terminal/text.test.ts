import { visualWidth, truncateToWidth, tailToWidth, fitText, fitPath, padTo, repeatChar } from "./text.ts";

test("width is counted in columns, not in the bytes UTF-8 spends on them", () => {
  expect(visualWidth("abc") == 3);
  expect(visualWidth("┌ · ┐") == 5);
  expect("┌ · ┐".length > 5);
});

test("truncating and tailing both cut on a character boundary, never mid-sequence", () => {
  expect(truncateToWidth("┌─┐abc", 3) == "┌─┐");
  expect(tailToWidth("abc┌─┐", 3) == "┌─┐");
  expect(visualWidth(truncateToWidth("┌─┐abc", 4)) == 4);
});

test("text that fits is left exactly as it was", () => {
  expect(fitText("agent", 10) == "agent");
  expect(fitPath("/tmp/x", 10) == "/tmp/x");
});

test("text too long loses its tail to an ellipsis, since its head is what names it", () => {
  expect(fitText("reads and edits", 10) == "reads a...");
  expect(visualWidth(fitText("reads and edits", 10)) == 10);
});

test("a path too long loses its head instead, since its tail is what names it", () => {
  expect(fitPath("/home/aymen/projects/code", 12) == "...ects/code");
  expect(visualWidth(fitPath("/home/aymen/projects/code", 12)) == 12);
});

test("a column too narrow for an ellipsis still fits, rather than overflowing the row", () => {
  expect(visualWidth(fitText("workspace", 2)) == 2);
  expect(visualWidth(fitPath("/a/b/c", 2)) == 2);
  expect(fitText("workspace", 0) == "");
});

test("padding fills to exactly the column width, and truncates anything wider", () => {
  expect(padTo("agent", 9) == "agent    ");
  expect(visualWidth(padTo("workspace", 9)) == 9);
  expect(visualWidth(padTo("a much longer label", 9)) == 9);
});

test("repeatChar counts characters, so a multi-byte rule glyph repeats the number asked for", () => {
  expect(repeatChar(" ", 3) == "   ");
  expect(visualWidth(repeatChar("─", 5)) == 5);
  expect(repeatChar("x", 0) == "");
});
