import { buildWelcomeBox, buildStatusLine, statusText, idleStatus, visualWidth, formatElapsed, formatTokens, formatRunningTasks, StatusInfo, NO_TURN } from "./layout.ts";
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

function busy(): StatusInfo {
  return { mode: "auto-edit", elapsedMs: 592000, tokens: 18432, runningTasks: 2, turnLive: true };
}

function settled(): StatusInfo {
  return { mode: "auto-edit", elapsedMs: 592000, tokens: 18432, runningTasks: 2, turnLive: false };
}

test("the welcome box is nine rows: top border, title, blank, three fields, blank, tagline, bottom border", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit", "");
  let lines = box.split("\n");
  expect(lines.length == 9);
});

test("every row of the welcome box is styled violet and reset on its own row, with no bleed to the next", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit", "");
  let raw = box.split("\n");
  let i = 0;
  while (i < raw.length) {
    expect(raw[i].indexOf(VIOLET) == 0);
    expect(raw[i].slice(raw[i].length - RESET.length, raw[i].length) == RESET);
    i = i + 1;
  }
});

test("every row of the welcome box has the same true visible width", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit", "");
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
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit", "");
  let lines = plainLines(box);
  let top = lines[0];
  let bottom = lines[lines.length - 1];
  expect(top.slice(0, 3) == "┌");
  expect(top.slice(top.length - 3, top.length) == "┐");
  expect(bottom.slice(0, 3) == "└");
  expect(bottom.slice(bottom.length - 3, bottom.length) == "┘");
});

test("every content row is bordered by single vertical bars", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit", "");
  let lines = plainLines(box);
  let i = 1;
  while (i < lines.length - 1) {
    expect(lines[i].slice(0, 3) == "│");
    expect(lines[i].slice(lines[i].length - 3, lines[i].length) == "│");
    i = i + 1;
  }
});

test("the welcome box shows the model, workspace and mode it was given", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit", "");
  expect(box.indexOf("gpt-4") >= 0);
  expect(box.indexOf("/home/aymen/project") >= 0);
  expect(box.indexOf("auto-edit") >= 0);
});

test("a workspace path too long for the box is truncated rather than breaking row width", () => {
  let longPath = "/home/aymen/some/really/long/path/that/does/not/fit/in/the/box/at/all/seriously";
  let box = buildWelcomeBox("gpt-4", longPath, "auto-edit", "");
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
  let line = buildStatusLine(idleStatus("read-only"), 80);
  expect(line.indexOf(DIM) == 0);
  expect(line.slice(line.length - RESET.length, line.length) == RESET);
  expect(line.indexOf("read-only") >= 0);
  expect(line.indexOf("/help") >= 0);
  expect(line.indexOf("PageUp") >= 0);
  expect(line.indexOf("PageDown") >= 0);
});

test("the status line reflects a different mode when given one", () => {
  let line = buildStatusLine(idleStatus("full-auto"), 80);
  expect(line.indexOf("full-auto") >= 0);
});

test("elapsed and tokens render unstyled while the turn is live, standing out from the dim bar around them", () => {
  let line = buildStatusLine(busy(), 120);
  expect(line.indexOf(DIM + "9m 52s") < 0);
  expect(line.indexOf(DIM + "18k tokens") < 0);
  expect(line.indexOf(RESET + "9m 52s") >= 0);
  expect(line.indexOf("9m 52s" + DIM) >= 0);
  expect(line.indexOf(RESET + "18k tokens") >= 0);
  expect(line.indexOf("18k tokens" + DIM) >= 0);
});

test("elapsed and tokens fall back to the same dim style as the rest of the bar once the turn is settled", () => {
  let line = buildStatusLine(settled(), 120);
  expect(line.indexOf(DIM + "9m 52s") >= 0);
  expect(line.indexOf(DIM + "18k tokens") >= 0);
});

test("settling a turn changes only the styling, not the words or order of the status line", () => {
  expect(statusText(busy(), 120) == statusText(settled(), 120));
});

test("the running task count is always dim, live or settled, since it does not belong to the turn totals", () => {
  let live = buildStatusLine(busy(), 120);
  let done = buildStatusLine(settled(), 120);
  expect(live.indexOf(DIM + "2 running tasks") >= 0);
  expect(done.indexOf(DIM + "2 running tasks") >= 0);
});

test("the welcome box shows the running version, so a released build is distinguishable from a source build", () => {
  let box = buildWelcomeBox("m", "/w", "auto-edit", "");
  expect(box.indexOf(" joule " + VERSION) >= 0);
});

test("an idle status line carries neither an elapsed clock nor a token or task count", () => {
  let line = statusText(idleStatus("auto-edit"), 80);
  expect(line == "mode: auto-edit · /help for commands · PageUp/PageDown to scroll");
});

test("elapsed time reads as seconds, then padded minutes, then padded hours", () => {
  expect(formatElapsed(0) == "0s");
  expect(formatElapsed(900) == "0s");
  expect(formatElapsed(9000) == "9s");
  expect(formatElapsed(59000) == "59s");
  expect(formatElapsed(60000) == "1m 00s");
  expect(formatElapsed(64000) == "1m 04s");
  expect(formatElapsed(592000) == "9m 52s");
  expect(formatElapsed(3599000) == "59m 59s");
  expect(formatElapsed(3600000) == "1h 00m");
  expect(formatElapsed(7860000) == "2h 11m");
});

test("a negative elapsed value clamps to zero rather than printing a minus sign", () => {
  expect(formatElapsed(NO_TURN) == "0s");
});

test("token counts read exactly below a thousand and rounded to thousands above it", () => {
  expect(formatTokens(1) == "1 token");
  expect(formatTokens(0) == "0 tokens");
  expect(formatTokens(999) == "999 tokens");
  expect(formatTokens(1000) == "1k tokens");
  expect(formatTokens(1499) == "1k tokens");
  expect(formatTokens(1500) == "2k tokens");
  expect(formatTokens(18432) == "18k tokens");
});

test("the running-task count is singular for one task", () => {
  expect(formatRunningTasks(1) == "1 running task");
  expect(formatRunningTasks(2) == "2 running tasks");
});

test("a wide terminal shows every field, in mode, elapsed, tokens, tasks, hints order", () => {
  let line = statusText(busy(), 120);
  expect(line == "mode: auto-edit · 9m 52s · 18k tokens · 2 running tasks · /help for commands · PageUp/PageDown to scroll");
  expect(visualWidth(line) == 104);
});

test("the separator is measured in columns, not in the bytes UTF-8 spends on it", () => {
  let line = statusText(busy(), 120);
  expect(visualWidth(line) == 104);
  expect(line.length > 104);
});

test("narrowing drops fields lowest priority first: scroll hint, help hint, tokens, tasks, elapsed", () => {
  expect(statusText(busy(), 104) == "mode: auto-edit · 9m 52s · 18k tokens · 2 running tasks · /help for commands · PageUp/PageDown to scroll");
  expect(statusText(busy(), 103) == "mode: auto-edit · 9m 52s · 18k tokens · 2 running tasks · /help for commands");
  expect(statusText(busy(), 76) == "mode: auto-edit · 9m 52s · 18k tokens · 2 running tasks · /help for commands");
  expect(statusText(busy(), 75) == "mode: auto-edit · 9m 52s · 18k tokens · 2 running tasks");
  expect(statusText(busy(), 55) == "mode: auto-edit · 9m 52s · 18k tokens · 2 running tasks");
  expect(statusText(busy(), 54) == "mode: auto-edit · 9m 52s · 2 running tasks");
  expect(statusText(busy(), 42) == "mode: auto-edit · 9m 52s · 2 running tasks");
  expect(statusText(busy(), 41) == "mode: auto-edit · 9m 52s");
  expect(statusText(busy(), 24) == "mode: auto-edit · 9m 52s");
  expect(statusText(busy(), 23) == "mode: auto-edit");
});

test("the mode is never dropped, even when it alone overflows the terminal", () => {
  expect(statusText(busy(), 10) == "mode: auto-edit");
  expect(statusText(busy(), 1) == "mode: auto-edit");
});

test("at the harness sizes the line stays on one row, with the mode always readable", () => {
  let at80 = statusText(busy(), 80);
  let at45 = statusText(busy(), 45);
  expect(visualWidth(at80) <= 80);
  expect(visualWidth(at45) <= 45);
  expect(at80.indexOf("mode: auto-edit") == 0);
  expect(at45.indexOf("mode: auto-edit") == 0);
  expect(at80.indexOf("\n") < 0);
  expect(at45.indexOf("\n") < 0);
});

test("an idle 45-column terminal keeps the mode and the help hint the layout harness looks for", () => {
  let line = statusText(idleStatus("auto-edit"), 45);
  expect(visualWidth(line) <= 45);
  expect(line.indexOf("mode:") >= 0);
  expect(line.indexOf("/help") >= 0);
});

test("a field is left out entirely when its source has nothing to report", () => {
  let noTokens: StatusInfo = { mode: "auto-edit", elapsedMs: 5000, tokens: 0, runningTasks: 0, turnLive: true };
  expect(statusText(noTokens, 120) == "mode: auto-edit · 5s · /help for commands · PageUp/PageDown to scroll");
  let tasksOnly: StatusInfo = { mode: "read-only", elapsedMs: NO_TURN, tokens: 0, runningTasks: 1, turnLive: false };
  expect(statusText(tasksOnly, 120) == "mode: read-only · 1 running task · /help for commands · PageUp/PageDown to scroll");
});

test("a width of zero leaves the line uncut, so the caller's own clip stays in charge", () => {
  expect(statusText(busy(), 0) == "mode: auto-edit · 9m 52s · 18k tokens · 2 running tasks · /help for commands · PageUp/PageDown to scroll");
});

test("the welcome box names the server only when it is not the default", () => {
  let hosted = buildWelcomeBox("m", "/w", "auto-edit", "https://joule.sh");
  expect(hosted.indexOf("server") < 0);

  let staging = buildWelcomeBox("m", "/w", "auto-edit", "http://100.89.7.80:8090");
  expect(staging.indexOf("server") >= 0);
  expect(staging.indexOf("100.89.7.80:8090") >= 0);
});

test("safe-auto states plainly in the welcome box that commands run unattended", () => {
  let box = buildWelcomeBox("gpt-4", "/home/aymen/project", "safe-auto", "");
  expect(box.indexOf("safe-auto") >= 0);
  expect(box.indexOf("commands run unattended") >= 0);
});

test("safe-auto states plainly in the status bar that commands run unattended", () => {
  let line = statusText(idleStatus("safe-auto"), 120);
  expect(line.indexOf("safe-auto") >= 0);
  expect(line.indexOf("commands run unattended") >= 0);
});

test("the other three modes show no unattended notice, unchanged from before", () => {
  expect(statusText(idleStatus("read-only"), 120).indexOf("unattended") < 0);
  expect(statusText(idleStatus("auto-edit"), 120).indexOf("unattended") < 0);
  expect(statusText(idleStatus("full-auto"), 120).indexOf("unattended") < 0);
});

test("safe-auto still keeps the mode readable at 45 columns even though its label is longer", () => {
  let line = statusText(idleStatus("safe-auto"), 45);
  expect(visualWidth(line) <= 45);
  expect(line.indexOf("mode:") == 0);
});
