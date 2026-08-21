import { planToolOutputCollapse, collapsedMarker, expandedMarker, COLLAPSE_HEAD_LINES, COLLAPSE_MIN_LINES } from "./collapse.ts";

function output(n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    out = out + "\nline " + `${i}`;
    i = i + 1;
  }
  return out;
}

function countLines(text: string): int {
  return text.split("\n").length - 1;
}

test("output at the threshold is left whole", () => {
  let plan = planToolOutputCollapse(output(COLLAPSE_MIN_LINES));
  expect(plan.hidden == 0);
  expect(plan.body == "");
  expect(plan.head == output(COLLAPSE_MIN_LINES));
});

test("output one line past the threshold splits into a head and a hidden body", () => {
  let plan = planToolOutputCollapse(output(COLLAPSE_MIN_LINES + 1));
  expect(plan.hidden == COLLAPSE_MIN_LINES + 1 - COLLAPSE_HEAD_LINES);
  expect(countLines(plan.head) == COLLAPSE_HEAD_LINES);
  expect(plan.body.split("\n").length == plan.hidden);
});

test("the head keeps the leading newline so it appends as new rows", () => {
  let plan = planToolOutputCollapse(output(40));
  expect(plan.head.charAt(0) == "\n");
  expect(plan.head.indexOf("line 0") >= 0);
  expect(plan.head.indexOf("line 5") >= 0);
  expect(plan.head.indexOf("line 6") < 0);
});

test("the body starts at the first hidden line and runs to the end", () => {
  let plan = planToolOutputCollapse(output(40));
  expect(plan.body.charAt(0) != "\n");
  expect(plan.hidden == 34);
  let rows = plan.body.split("\n");
  expect(rows[0] == "line 6");
  expect(rows[rows.length - 1] == "line 39");
});

test("head plus body reconstructs the original output exactly", () => {
  let text = output(25);
  let plan = planToolOutputCollapse(text);
  expect(plan.head + "\n" + plan.body == text);
});

test("output that does not start on a fresh row is never collapsed", () => {
  let plan = planToolOutputCollapse("trailing text" + output(40));
  expect(plan.hidden == 0);
  expect(plan.body == "");
});

test("empty output is never collapsed", () => {
  let plan = planToolOutputCollapse("");
  expect(plan.hidden == 0);
  expect(plan.head == "");
});

test("a colored block keeps its opening sequence in the head and its reset in the body", () => {
  let esc = String.fromCharCode(27);
  let text = output(20);
  let plan = planToolOutputCollapse("\n" + esc + "[32m" + text.slice(1, text.length) + esc + "[0m");
  expect(plan.hidden == 14);
  expect(plan.head.indexOf(esc + "[32m") >= 0);
  expect(plan.body.indexOf(esc + "[0m") >= 0);
});

test("the collapsed marker names the hidden count and the key that expands it", () => {
  let marker = collapsedMarker(47);
  expect(marker.indexOf("+47 lines") >= 0);
  expect(marker.indexOf("ctrl-o") >= 0);
  expect(marker.indexOf("expand") >= 0);
});

test("the expanded marker names the same count and offers to collapse again", () => {
  let marker = expandedMarker(47);
  expect(marker.indexOf("47 more lines") >= 0);
  expect(marker.indexOf("ctrl-o") >= 0);
  expect(marker.indexOf("collapse") >= 0);
});

test("the head fits inside the transcript area of the smallest supported terminal", () => {
  expect(COLLAPSE_HEAD_LINES + 1 <= 10 - 2);
  expect(COLLAPSE_HEAD_LINES < COLLAPSE_MIN_LINES);
});
