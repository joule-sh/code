import { buildWelcomeBox, buildStatusLine } from "./layout.ts";
import { VIOLET, DIM, RESET } from "./style.ts";
import { VERSION } from "../version.ts";

function stripColor(line: string, color: string): string {
  let out = line;
  if (out.indexOf(color) == 0) {
    out = out.slice(color.length, out.length);
  }
  if (out.slice(out.length - RESET.length, out.length) == RESET) {
    out = out.slice(0, out.length - RESET.length);
  }
  return out;
}

function utf8ByteCount(first: int): int {
  if (first >= 240) { return 4; }
  if (first >= 224) { return 3; }
  if (first >= 192) { return 2; }
  return 1;
}

function visualWidth(plain: string): int {
  let count = 0;
  let i = 0;
  while (i < plain.length) {
    i = i + utf8ByteCount(plain.charCodeAt(i));
    count = count + 1;
  }
  return count;
}

function allEqual(widths: int[]): bool {
  let i = 0;
  while (i < widths.length) {
    if (widths[i] != widths[0]) {
      return false;
    }
    i = i + 1;
  }
  return true;
}

function plainLines(box: string): string[] {
  let raw = box.split("\n");
  let out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    out.push(stripColor(raw[i], VIOLET));
    i = i + 1;
  }
  return out;
}

test("the welcome box is nine rows: top border, title, blank, three fields, blank, tagline, bottom border", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit");
  let lines = box.split("\n");
  expect(lines.length == 9);
});

test("every row of the welcome box is styled violet and reset on its own row, with no bleed to the next", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit");
  let raw = box.split("\n");
  let i = 0;
  while (i < raw.length) {
    expect(raw[i].indexOf(VIOLET) == 0);
    expect(raw[i].slice(raw[i].length - RESET.length, raw[i].length) == RESET);
    i = i + 1;
  }
});

test("every row of the welcome box has the same true visible width", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit");
  let lines = plainLines(box);
  let widths: int[] = [];
  let j = 0;
  while (j < lines.length) {
    widths.push(visualWidth(lines[j]));
    j = j + 1;
  }
  expect(allEqual(widths));
});

test("the welcome box has square single-line corners", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit");
  let lines = plainLines(box);
  let top = lines[0];
  let bottom = lines[lines.length - 1];
  expect(top.slice(0, 3) == "┌");
  expect(top.slice(top.length - 3, top.length) == "┐");
  expect(bottom.slice(0, 3) == "└");
  expect(bottom.slice(bottom.length - 3, bottom.length) == "┘");
});

test("every content row is bordered by single vertical bars", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit");
  let lines = plainLines(box);
  let i = 1;
  while (i < lines.length - 1) {
    expect(lines[i].slice(0, 3) == "│");
    expect(lines[i].slice(lines[i].length - 3, lines[i].length) == "│");
    i = i + 1;
  }
});

test("the welcome box shows the model, workspace and mode it was given", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit");
  expect(box.indexOf("gpt-4") >= 0);
  expect(box.indexOf("/home/aymen/project") >= 0);
  expect(box.indexOf("auto-edit") >= 0);
});

test("a workspace path too long for the box is truncated rather than breaking row width", () => {
  let longPath = "/home/aymen/some/really/long/path/that/does/not/fit/in/the/box/at/all/seriously";
  let box = buildWelcomeBox("gpt-4", longPath, "auto-edit");
  let lines = plainLines(box);
  let widths: int[] = [];
  let i = 0;
  while (i < lines.length) {
    widths.push(visualWidth(lines[i]));
    i = i + 1;
  }
  expect(allEqual(widths));
  expect(box.indexOf(longPath) < 0);
});

test("the status line names the current mode and the key hints, dim and reset", () => {
  let line = buildStatusLine("read-only");
  expect(line.indexOf(DIM) == 0);
  expect(line.slice(line.length - RESET.length, line.length) == RESET);
  expect(line.indexOf("read-only") >= 0);
  expect(line.indexOf("/help") >= 0);
  expect(line.indexOf("PageUp") >= 0);
  expect(line.indexOf("PageDown") >= 0);
});

test("the status line reflects a different mode when given one", () => {
  let line = buildStatusLine("full-auto");
  expect(line.indexOf("full-auto") >= 0);
});

test("the welcome box shows the running version, so a released build is distinguishable from a source build", () => {
  let box = buildWelcomeBox("m", "/w", "auto-edit");
  expect(box.indexOf(" joule " + VERSION) >= 0);
});
