import { MarkdownState, appendMarkdownDelta, flushMarkdown, styleMarkdownLine } from "./markdown.ts";
import { BOLD, UNDERLINE, DIM, VIOLET, RESET } from "./style.ts";

test("plain text with no markdown passes through unchanged once its line completes", () => {
  let state = new MarkdownState();
  let out = appendMarkdownDelta(state, "just a normal sentence.\n");
  expect(out == "just a normal sentence.\n");
});

test("bold and italic within a single chunk are styled and their markers removed", () => {
  let state = new MarkdownState();
  let out = appendMarkdownDelta(state, "this is **bold** and _italic_ text\n");
  expect(out.indexOf(BOLD + "bold" + RESET) >= 0);
  expect(out.indexOf(UNDERLINE + "italic" + RESET) >= 0);
  expect(out.indexOf("**") < 0);
  expect(out.indexOf("_italic_") < 0);
});

test("a bold marker split across two separate text.delta chunks still renders bold", () => {
  let state = new MarkdownState();
  let first = appendMarkdownDelta(state, "the answer is **bo");
  let second = appendMarkdownDelta(state, "ld** and final\n");
  expect(first == "");
  expect(second.indexOf(BOLD + "bold" + RESET) >= 0);
  expect(second.indexOf("**") < 0);
});

test("an italic marker split across two chunks still renders italic", () => {
  let state = new MarkdownState();
  appendMarkdownDelta(state, "look at _this");
  let out = appendMarkdownDelta(state, " word_ closely\n");
  expect(out.indexOf(UNDERLINE + "this word" + RESET) >= 0);
});

test("underscores inside a snake_case identifier are left untouched, not styled as italic", () => {
  let state = new MarkdownState();
  let out = appendMarkdownDelta(state, "call my_function_name here\n");
  expect(out.indexOf("my_function_name") >= 0);
  expect(out.indexOf(UNDERLINE) < 0);
});

test("an h1 header is styled bold violet with the marker stripped", () => {
  let result = styleMarkdownLine("# Section Title", false);
  expect(result.text == BOLD + VIOLET + "Section Title" + RESET);
  expect(!result.inCodeBlock);
});

test("an h3 header strips all three hashes", () => {
  let result = styleMarkdownLine("### Sub heading", false);
  expect(result.text == BOLD + VIOLET + "Sub heading" + RESET);
});

test("a line that merely starts with a hash but has no following space is not a header", () => {
  let result = styleMarkdownLine("#no-space", false);
  expect(result.text.indexOf(VIOLET) < 0);
  expect(result.text.indexOf("#no-space") >= 0);
});

test("a fenced code block is bordered and left unstyled for markdown markers inside it", () => {
  let state = new MarkdownState();
  let out = appendMarkdownDelta(state, "before\n```\nlet x = **not bold**;\n```\nafter\n");
  let lines = out.split("\n");
  expect(lines[0] == "before");
  expect(lines[1] == DIM + "```" + RESET);
  expect(lines[2] == DIM + "| " + RESET + "let x = **not bold**;");
  expect(lines[2].indexOf(BOLD) < 0);
  expect(lines[3] == DIM + "```" + RESET);
  expect(lines[4] == "after");
});

test("an inline code span is dimmed and its emphasis markers inside are not interpreted", () => {
  let result = styleMarkdownLine("run `a**b**c` now", false);
  expect(result.text.indexOf(DIM + "a**b**c" + RESET) >= 0);
  expect(result.text.indexOf(BOLD) < 0);
});

test("an in-progress line is buffered and not emitted until its newline arrives", () => {
  let state = new MarkdownState();
  let out = appendMarkdownDelta(state, "still typing this sentence");
  expect(out == "");
  expect(state.pending == "still typing this sentence");
});

test("flushMarkdown emits and styles a trailing unterminated line at turn end", () => {
  let state = new MarkdownState();
  appendMarkdownDelta(state, "**final** thought with no newline");
  let out = flushMarkdown(state);
  expect(out.indexOf(BOLD + "final" + RESET) >= 0);
  expect(state.pending == "");
});

test("flushMarkdown resets an unterminated code block rather than leaking state into the next turn", () => {
  let state = new MarkdownState();
  appendMarkdownDelta(state, "```\nsome code with no closing fence");
  flushMarkdown(state);
  expect(!state.inCodeBlock);
});

test("a multi-line chunk delivered in one call styles every completed line", () => {
  let state = new MarkdownState();
  let out = appendMarkdownDelta(state, "**one**\n_two_\nthree\n");
  let lines = out.split("\n");
  expect(lines[0] == BOLD + "one" + RESET);
  expect(lines[1] == UNDERLINE + "two" + RESET);
  expect(lines[2] == "three");
});
