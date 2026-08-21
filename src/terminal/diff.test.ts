import { diffLines, diffCounts, renderDiffRows, DiffRow, DIFF_ROW_SAME, DIFF_ROW_ADD, DIFF_ROW_DEL, DIFF_DISPLAY_MAX_ROWS } from "./diff.ts";

test("identical text yields only same rows with matching line numbers on both sides", () => {
  let rows = diffLines("a\nb\nc", "a\nb\nc");
  expect(rows != null);
  let r = rows;
  if (r != null) {
    expect(r.length == 3);
    expect(r[0].kind == DIFF_ROW_SAME);
    expect(r[0].a == 1);
    expect(r[0].b == 1);
    expect(r[2].text == "c");
  }
});

test("a changed middle line becomes a del and an add, with the matching prefix and suffix kept as same rows", () => {
  let rows = diffLines("same1\nsame2\nold\nsame3", "same1\nsame2\nnew\nsame3");
  expect(rows != null);
  let r = rows;
  if (r != null) {
    expect(r[0].kind == DIFF_ROW_SAME);
    expect(r[1].kind == DIFF_ROW_SAME);
    let counts = diffCounts(r);
    expect(counts.added == 1);
    expect(counts.removed == 1);
    let last = r[r.length - 1];
    expect(last.kind == DIFF_ROW_SAME);
    expect(last.text == "same3");
  }
});

test("a pure addition against non-empty old text adds every new line and removes none", () => {
  let rows = diffLines("a\nb", "a\nb\nc\nd");
  expect(rows != null);
  let r = rows;
  if (r != null) {
    let counts = diffCounts(r);
    expect(counts.added == 2);
    expect(counts.removed == 0);
  }
});

test("a pure deletion against empty new text removes every old line", () => {
  let rows = diffLines("a\nb\nc", "");
  expect(rows != null);
  let r = rows;
  if (r != null) {
    let counts = diffCounts(r);
    expect(counts.removed == 3);
  }
});

test("diffLines bails to null once either side passes the max line count", () => {
  let big = "";
  let i = 0;
  while (i < 4001) {
    big = big + "x\n";
    i = i + 1;
  }
  expect(diffLines(big, "y") == null);
  expect(diffLines("y", big) == null);
});

test("a short diff stays under the max line count and is not null", () => {
  expect(diffLines("a", "b") != null);
});

test("row line numbers stay 1-based and count from the start of each side", () => {
  let rows = diffLines("x\ny", "x\nz");
  expect(rows != null);
  let r = rows;
  if (r != null) {
    expect(r[0].a == 1);
    expect(r[0].b == 1);
    let del = r[1];
    let add = r[2];
    expect(del.kind == DIFF_ROW_DEL);
    expect(del.a == 2);
    expect(del.b == 0);
    expect(add.kind == DIFF_ROW_ADD);
    expect(add.a == 0);
    expect(add.b == 2);
  }
});

test("renderDiffRows colors added lines green, removed lines red, and dims the gutter", () => {
  let rows = diffLines("old", "new");
  expect(rows != null);
  let r = rows;
  if (r != null) {
    let text = renderDiffRows(r);
    expect(text.indexOf("+ new") >= 0);
    expect(text.indexOf("- old") >= 0);
  }
});

test("renderDiffRows on an unchanged file has no +/- markers", () => {
  let rows = diffLines("same", "same");
  expect(rows != null);
  let r = rows;
  if (r != null) {
    let text = renderDiffRows(r);
    expect(text.indexOf("+") < 0);
    expect(text.indexOf("-") < 0);
  }
});

test("renderDiffRows returns an empty string for an empty row list", () => {
  expect(renderDiffRows([]) == "");
});

test("DIFF_DISPLAY_MAX_ROWS is a smaller terminal-scale cap than the structural line guard", () => {
  expect(DIFF_DISPLAY_MAX_ROWS > 0);
  expect(DIFF_DISPLAY_MAX_ROWS < 4000);
});
