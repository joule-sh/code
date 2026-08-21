import { Scrollback } from "./scrollback.ts";
import { planToolOutputCollapse } from "./collapse.ts";

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

test("Scrollback starts at the bottom with offset 0", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  expect(sb.offset == 0);
  expect(sb.isAtBottom());
});

test("tailFrom with offset 0 matches tail", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  let t = sb.tailFrom(2, 0);
  expect(t.length == 2);
  expect(t[0] == "4");
  expect(t[1] == "5");
});

test("tailFrom with a positive offset shows older lines", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  let t = sb.tailFrom(2, 2);
  expect(t.length == 2);
  expect(t[0] == "2");
  expect(t[1] == "3");
});

test("tailFrom clamps an offset past the top of history", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  let t = sb.tailFrom(2, 100);
  expect(t.length == 2);
  expect(t[0] == "1");
  expect(t[1] == "2");
});

test("maxOffset is 0 when everything fits on screen", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3");
  expect(sb.maxOffset(10) == 0);
});

test("maxOffset grows with history past the visible height", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  expect(sb.maxOffset(2) == 3);
});

test("scrollUp moves the offset up and clamps at the top", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  sb.scrollUp(2, 1);
  expect(sb.offset == 1);
  sb.scrollUp(2, 50);
  expect(sb.offset == sb.maxOffset(2));
  expect(sb.offset == 3);
});

test("scrollDown moves the offset back toward the bottom and clamps at 0", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  sb.scrollUp(2, 3);
  sb.scrollDown(2, 1);
  expect(sb.offset == 2);
  sb.scrollDown(2, 50);
  expect(sb.offset == 0);
  expect(sb.isAtBottom());
});

test("resetToBottom snaps straight back to offset 0", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  sb.scrollUp(2, 3);
  expect(!sb.isAtBottom());
  sb.resetToBottom();
  expect(sb.isAtBottom());
  expect(sb.offset == 0);
});

test("append auto-follows the bottom when offset is 0", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  expect(sb.isAtBottom());
  sb.append("\n6");
  expect(sb.isAtBottom());
  let t = sb.tailFrom(2, sb.offset);
  expect(t[0] == "5");
  expect(t[1] == "6");
});

test("append does not yank a scrolled up view back to the bottom", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  sb.scrollUp(2, 3);
  let before = sb.tailFrom(2, sb.offset);
  expect(before[0] == "1");
  expect(before[1] == "2");
  sb.append("\n6\n7");
  expect(!sb.isAtBottom());
  let after = sb.tailFrom(2, sb.offset);
  expect(after[0] == "1");
  expect(after[1] == "2");
});

test("clear resets the scroll offset back to the bottom", () => {
  let sb = new Scrollback();
  sb.append("1\n2\n3\n4\n5");
  sb.scrollUp(2, 3);
  sb.clear();
  expect(sb.isAtBottom());
  expect(sb.offset == 0);
});

test("tail with n larger than the buffer returns everything", () => {
  let sb = new Scrollback();
  sb.append("1\n2");
  let t = sb.tail(50);
  expect(t.length == 2);
});

test("setLine repaints one line without changing the line count or the lines around it", () => {
  let sb = new Scrollback();
  sb.append("one\ntwo\nthree");
  let before = sb.lineCount();
  sb.setLine(1, "TWO");
  expect(sb.lineCount() == before);
  expect(sb.lines[0] == "one");
  expect(sb.lines[1] == "TWO");
  expect(sb.lines[2] == "three");
});

test("setLine outside the buffer is a no-op rather than a crash", () => {
  let sb = new Scrollback();
  sb.append("one\ntwo");
  let before = sb.lineCount();
  sb.setLine(-1, "nope");
  sb.setLine(before, "nope");
  expect(sb.lineCount() == before);
  expect(sb.lines[before - 1] == "two");
});

test("setLine does not move a scrolled up view", () => {
  let sb = new Scrollback();
  sb.append("a\nb\nc\nd\ne\nf");
  sb.scrollUp(3, 2);
  let offsetBefore = sb.offset;
  sb.setLine(sb.lineCount() - 1, "F");
  expect(sb.offset == offsetBefore);
  expect(sb.lines[sb.lineCount() - 1] == "F");
});

function toolOutput(prefix: string, n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    out = out + "\n" + prefix + " " + `${i}`;
    i = i + 1;
  }
  return out;
}

function appendCollapsedOutput(sb: Scrollback, prefix: string, n: int): int {
  let plan = planToolOutputCollapse(toolOutput(prefix, n));
  sb.appendCollapsible(plan.head, plan.body, plan.hidden);
  return plan.hidden;
}

function viewHas(view: string[], needle: string): bool {
  for (const line of view) {
    if (line.indexOf(needle) >= 0) { return true; }
  }
  return false;
}

test("a collapsed group keeps every line in the buffer but hides its body from the view", () => {
  let sb = new Scrollback();
  sb.append("intro");
  let hidden = appendCollapsedOutput(sb, "line", 20);
  expect(hidden == 14);
  expect(sb.lineCount() == 22);
  expect(sb.visibleCount() == 8);
  expect(sb.collapsedCount() == 1);
});

test("the visible tail of a collapsed group ends on a marker with an accurate count", () => {
  let sb = new Scrollback();
  sb.append("intro");
  appendCollapsedOutput(sb, "line", 20);
  let view = sb.tail(100);
  expect(view.length == 8);
  expect(view[0] == "intro");
  expect(view[1] == "line 0");
  expect(view[6] == "line 5");
  expect(view[7].indexOf("+14 lines") >= 0);
  expect(view[7].indexOf("ctrl-o") >= 0);
});

test("expanding the last group reveals every hidden line and rewrites its marker in place", () => {
  let sb = new Scrollback();
  sb.append("intro");
  appendCollapsedOutput(sb, "line", 20);
  let count = sb.lineCount();
  expect(sb.toggleLastGroup());
  expect(sb.lineCount() == count);
  expect(sb.visibleCount() == count);
  expect(sb.collapsedCount() == 0);
  let view = sb.tail(100);
  expect(view.length == 22);
  expect(view[7].indexOf("14 more lines") >= 0);
  expect(view[8] == "line 6");
  expect(view[21] == "line 19");
});

test("collapsing again puts the group back exactly as it was", () => {
  let sb = new Scrollback();
  sb.append("intro");
  appendCollapsedOutput(sb, "line", 20);
  let before = sb.tail(100);
  sb.toggleLastGroup();
  sb.toggleLastGroup();
  let after = sb.tail(100);
  expect(after.length == before.length);
  let i = 0;
  while (i < after.length) {
    expect(after[i] == before[i]);
    i = i + 1;
  }
});

test("toggling with nothing collapsible reports that it did nothing", () => {
  let sb = new Scrollback();
  sb.append("just text\nand more");
  expect(!sb.toggleLastGroup());
  expect(sb.visibleCount() == sb.lineCount());
});

test("a group at the very end of the buffer expands without losing the last line", () => {
  let sb = new Scrollback();
  appendCollapsedOutput(sb, "line", 30);
  expect(sb.tail(4)[3].indexOf("+24 lines") >= 0);
  sb.toggleLastGroup();
  let view = sb.tail(4);
  expect(view[0] == "line 26");
  expect(view[3] == "line 29");
});

test("toggling targets the most recent group and leaves earlier ones alone", () => {
  let sb = new Scrollback();
  appendCollapsedOutput(sb, "older", 20);
  sb.append("\nbetween");
  appendCollapsedOutput(sb, "newer", 30);
  expect(sb.collapsedCount() == 2);
  sb.toggleLastGroup();
  expect(sb.collapsedCount() == 1);
  let view = sb.tail(200);
  expect(!viewHas(view, "older 19"));
  expect(viewHas(view, "older 5"));
  expect(viewHas(view, "newer 29"));
  expect(view[view.length - 1] == "newer 29");
});

test("scrolling past a collapsed group never lands on a hidden line", () => {
  let sb = new Scrollback();
  sb.append("top");
  appendCollapsedOutput(sb, "line", 30);
  sb.append("\nafter one\nafter two");
  expect(sb.visibleCount() == 10);
  expect(sb.maxOffset(4) == 6);
  sb.scrollUp(4, 100);
  expect(sb.offset == 6);
  let view = sb.tailFrom(4, sb.offset);
  expect(view.length == 4);
  expect(view[0] == "top");
  expect(view[3] == "line 2");
});

test("appending a collapsed group while scrolled up moves the view by its visible rows only", () => {
  let sb = new Scrollback();
  sb.append("a\nb\nc\nd\ne\nf\ng\nh");
  sb.scrollUp(4, 3);
  expect(sb.offset == 3);
  let anchored = sb.tailFrom(4, sb.offset);
  appendCollapsedOutput(sb, "line", 30);
  expect(sb.offset == 10);
  let view = sb.tailFrom(4, sb.offset);
  expect(view.length == anchored.length);
  let i = 0;
  while (i < view.length) {
    expect(view[i] == anchored[i]);
    i = i + 1;
  }
});

test("toggling a group returns the view to the live bottom", () => {
  let sb = new Scrollback();
  sb.append("top");
  appendCollapsedOutput(sb, "line", 30);
  sb.scrollUp(4, 3);
  expect(!sb.isAtBottom());
  sb.toggleLastGroup();
  expect(sb.isAtBottom());
  expect(sb.tail(1)[0] == "line 29");
});

test("clear forgets the collapsed groups along with the lines", () => {
  let sb = new Scrollback();
  appendCollapsedOutput(sb, "line", 30);
  sb.clear();
  expect(sb.lineCount() == 1);
  expect(sb.visibleCount() == 1);
  expect(sb.collapsedCount() == 0);
  expect(!sb.toggleLastGroup());
});

test("expanding a group never shifts the absolute row of anything appended after it", () => {
  let sb = new Scrollback();
  appendCollapsedOutput(sb, "line", 30);
  sb.append("\n  ? run npm test [npm test]");
  sb.append("\n    1. Yes\n    2. Yes, and don't ask again\n    3. No");
  let firstOptionRow = sb.lineCount() - 3;
  let count = sb.lineCount();
  expect(sb.lines[firstOptionRow].indexOf("1. Yes") >= 0);

  sb.toggleLastGroup();
  expect(sb.lineCount() == count);
  expect(firstOptionRow == sb.lineCount() - 3);
  expect(sb.lines[firstOptionRow].indexOf("1. Yes") >= 0);
  expect(sb.lines[firstOptionRow + 2].indexOf("3. No") >= 0);
  expect(!sb.isHidden(firstOptionRow));
  expect(!sb.isHidden(firstOptionRow + 2));

  sb.setLine(firstOptionRow + 2, "    > 3. No");
  sb.toggleLastGroup();
  expect(sb.lines[firstOptionRow].indexOf("1. Yes") >= 0);
  expect(sb.lines[firstOptionRow + 2] == "    > 3. No");
  let view = sb.tail(100);
  expect(view[view.length - 1] == "    > 3. No");
});
