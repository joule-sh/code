import { Scrollback, InputLine, PendingApproval, clip } from "./input_state.ts";

test("Scrollback starts with a single empty line", () => {
  let sb = new Scrollback();
  expect(sb.lines.length == 1);
  expect(sb.lines[0] == "");
});

test("append with no newline continues the current line", () => {
  let sb = new Scrollback();
  sb.append("hello");
  sb.append(" world");
  expect(sb.lines.length == 1);
  expect(sb.lines[0] == "hello world");
});

test("append with embedded newlines starts new lines", () => {
  let sb = new Scrollback();
  sb.append("a\nb\nc");
  expect(sb.lines.length == 3);
  expect(sb.lines[0] == "a");
  expect(sb.lines[1] == "b");
  expect(sb.lines[2] == "c");
});

test("clear resets to a single empty line", () => {
  let sb = new Scrollback();
  sb.append("a\nb\nc");
  sb.clear();
  expect(sb.lines.length == 1);
  expect(sb.lines[0] == "");
});

test("tail returns the last n lines", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  let t = sb.tail(2);
  expect(t.length == 2);
  expect(t[0] == "4");
  expect(t[1] == "5");
});

test("tail with n larger than the buffer returns everything", () => {
  let sb = new Scrollback();
  sb.append("1\n2");
  let t = sb.tail(50);
  expect(t.length == 2);
});

test("InputLine push and backspace edit the buffer", () => {
  let line = new InputLine();
  line.push("a");
  line.push("b");
  line.push("c");
  expect(line.buf == "abc");
  line.backspace();
  expect(line.buf == "ab");
});

test("InputLine backspace on empty buffer is a no-op", () => {
  let line = new InputLine();
  line.backspace();
  expect(line.buf == "");
});

test("InputLine takeAndClear returns the text and empties the buffer", () => {
  let line = new InputLine();
  line.push("hi");
  let taken = line.takeAndClear();
  expect(taken == "hi");
  expect(line.buf == "");
});

test("PendingApproval tracks and clears a call id", () => {
  let p = new PendingApproval();
  expect(!p.isPending());
  p.set("c1");
  expect(p.isPending());
  expect(p.callId == "c1");
  p.clearIfMatches("c2");
  expect(p.isPending());
  p.clearIfMatches("c1");
  expect(!p.isPending());
});

test("clip truncates a line to the given width", () => {
  expect(clip("hello world", 5) == "hello");
  expect(clip("hi", 5) == "hi");
  expect(clip("hello", 0) == "hello");
});
