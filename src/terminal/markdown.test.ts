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

test("bold that wraps inline code renders the code dimmed with no literal markers left behind", () => {
  let result = styleMarkdownLine("- **`.githooks`, `.github`** — CI / git hook tooling", false);
  expect(result.text.indexOf("**") < 0);
  expect(result.text.indexOf(BOLD) >= 0);
  expect(result.text.indexOf(DIM + ".githooks" + RESET) >= 0);
  expect(result.text.indexOf(DIM + ".github" + RESET) >= 0);
  expect(result.text.indexOf("— CI / git hook tooling") >= 0);
  expect(result.text.slice(0, 2 + BOLD.length) == "- " + BOLD);
});

test("bold enclosing a single inline code span keeps the bold and dims the code", () => {
  let result = styleMarkdownLine("the **`--force`** flag", false);
  expect(result.text.indexOf("**") < 0);
  expect(result.text.indexOf(BOLD + DIM + "--force" + RESET) >= 0);
});

test("italic enclosing an inline code span keeps the underline and dims the code", () => {
  let result = styleMarkdownLine("see _the `flag` here_ please", false);
  expect(result.text.indexOf(UNDERLINE) >= 0);
  expect(result.text.indexOf(DIM + "flag" + RESET) >= 0);
  expect(result.text.indexOf("_the") < 0);
  expect(result.text.indexOf("here_") < 0);
});

test("emphasis markers inside an inline code span stay literal and are never styled", () => {
  let result = styleMarkdownLine("write `**x**` verbatim", false);
  expect(result.text.indexOf(DIM + "**x**" + RESET) >= 0);
  expect(result.text.indexOf(BOLD) < 0);
});

test("a bold marker whose partner only exists inside a code span is left literal", () => {
  let result = styleMarkdownLine("**start `**` end", false);
  expect(result.text.indexOf("**start") >= 0);
  expect(result.text.indexOf(DIM + "**" + RESET) >= 0);
  expect(result.text.indexOf(BOLD) < 0);
});

test("bold nested inside italic and italic nested inside bold both render", () => {
  let boldOuter = styleMarkdownLine("**bold with _italic_ inside**", false);
  expect(boldOuter.text.indexOf(BOLD) >= 0);
  expect(boldOuter.text.indexOf(UNDERLINE + "italic" + RESET) >= 0);
  expect(boldOuter.text.indexOf("**") < 0);
  let italicOuter = styleMarkdownLine("_italic with **bold** inside_", false);
  expect(italicOuter.text.indexOf(UNDERLINE) >= 0);
  expect(italicOuter.text.indexOf(BOLD + "bold" + RESET) >= 0);
  expect(italicOuter.text.indexOf("**") < 0);
});

test("adjacent bold spans and a code span between them each style independently", () => {
  let result = styleMarkdownLine("**one**`mid`**two**", false);
  expect(result.text.indexOf("**") < 0);
  expect(result.text.indexOf(BOLD + "one" + RESET) >= 0);
  expect(result.text.indexOf(DIM + "mid" + RESET) >= 0);
  expect(result.text.indexOf("two") >= 0);
});

test("an unmatched bold marker passes through as literal text", () => {
  let result = styleMarkdownLine("2 ** 3 is not bold", false);
  expect(result.text == "2 ** 3 is not bold");
});

test("an unmatched bold marker around a code span still leaves the code span dimmed", () => {
  let result = styleMarkdownLine("**unclosed `code` here", false);
  expect(result.text.indexOf("**unclosed ") >= 0);
  expect(result.text.indexOf(DIM + "code" + RESET) >= 0);
  expect(result.text.indexOf(BOLD) < 0);
});

test("an unmatched backtick passes through as literal text", () => {
  let result = styleMarkdownLine("a lone ` backtick", false);
  expect(result.text == "a lone ` backtick");
});

test("snake_case survives inside bold, inside a code span, and inside a code block", () => {
  let inBold = styleMarkdownLine("**call my_function_name now**", false);
  expect(inBold.text.indexOf("my_function_name") >= 0);
  expect(inBold.text.indexOf(UNDERLINE) < 0);
  let inCode = styleMarkdownLine("**`my_function_name`**", false);
  expect(inCode.text.indexOf(DIM + "my_function_name" + RESET) >= 0);
  expect(inCode.text.indexOf(UNDERLINE) < 0);
  let state = new MarkdownState();
  let out = appendMarkdownDelta(state, "```\nmy_function_name = 1\n```\n");
  let lines = out.split("\n");
  expect(lines[1] == DIM + "| " + RESET + "my_function_name = 1");
  expect(out.indexOf(UNDERLINE) < 0);
});

test("a bold span wrapping code split across two delta chunks still renders once the line completes", () => {
  let state = new MarkdownState();
  let first = appendMarkdownDelta(state, "run **`make ");
  let second = appendMarkdownDelta(state, "build`** first\n");
  expect(first == "");
  expect(second.indexOf("**") < 0);
  expect(second.indexOf(BOLD + DIM + "make build" + RESET) >= 0);
});
