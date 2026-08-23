import { welcomeBlock, welcomeRows, hintLines, hints, permissionText, buildWelcomeBox, WelcomeFacts } from "./welcome.ts";
import { visualWidth, truncateToWidth } from "./text.ts";
import { VIOLET, DIM, RESET } from "./style.ts";
import { parseCommand, CMD_UNKNOWN } from "./commands.ts";
import { VERSION } from "../version.ts";

const ESC: string = String.fromCharCode(27);
const VALUE_COLUMN: int = 13;
const TALL: int = 40;

function stripSgr(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line.charAt(i) == ESC) {
      while (i < line.length && line.charAt(i) != "m") {
        i = i + 1;
      }
      i = i + 1;
      continue;
    }
    out = out + line.charAt(i);
    i = i + 1;
  }
  return out;
}

function countOf(text: string, needle: string): int {
  let n = 0;
  let from = 0;
  while (true) {
    let at = text.indexOf(needle, from);
    if (at < 0) { return n; }
    n = n + 1;
    from = at + needle.length;
  }
  return n;
}

function columnOf(line: string, needle: string): int {
  let at = line.indexOf(needle);
  if (at < 0) { return -1; }
  return visualWidth(line.slice(0, at));
}

function columnAt(line: string, col: int): string {
  let head = truncateToWidth(line, col + 1);
  let prev = truncateToWidth(line, col);
  return head.slice(prev.length, head.length);
}

function facts(): WelcomeFacts {
  let f: WelcomeFacts = { model: "gpt-4", workspace: "/home/aymen/project", repo: "joule-sh/code on main", mode: "auto-edit", server: "" };
  return f;
}

function factsWith(mode: string, server: string, repo: string): WelcomeFacts {
  let f: WelcomeFacts = { model: "gpt-4", workspace: "/home/aymen/project", repo: repo, mode: mode, server: server };
  return f;
}

function plainLines(block: string): string[] {
  let raw = block.split("\n");
  let out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    out.push(stripSgr(raw[i]));
    i = i + 1;
  }
  return out;
}

function factLines(block: string): string[] {
  let all = ruleLines(block);
  let out: string[] = [];
  let i = 0;
  while (i < all.length) {
    if (all[i].slice(3, all[i].length).trim() == "") { return out; }
    out.push(all[i]);
    i = i + 1;
  }
  return out;
}

function ruleLines(block: string): string[] {
  let lines = plainLines(block);
  let out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith("┌") || lines[i].startsWith("│") || lines[i].startsWith("└")) {
      out.push(lines[i]);
    }
    i = i + 1;
  }
  return out;
}

test("no line of the block is wider than the width it was built for, at either harness size", () => {
  let wide = plainLines(welcomeBlock(facts(), 80, TALL));
  let i = 0;
  while (i < wide.length) {
    expect(visualWidth(wide[i]) <= 80);
    i = i + 1;
  }
  let narrow = plainLines(welcomeBlock(facts(), 45, TALL));
  let j = 0;
  while (j < narrow.length) {
    expect(visualWidth(narrow[j]) <= 45);
    j = j + 1;
  }
});

test("every colour opened on a line is closed on that same line, so nothing bleeds into the next row", () => {
  let raw = welcomeBlock(facts(), 80, TALL).split("\n");
  let i = 0;
  while (i < raw.length) {
    let opens = countOf(raw[i], VIOLET) + countOf(raw[i], DIM);
    expect(countOf(raw[i], RESET) == opens);
    i = i + 1;
  }
});

test("the block carries no carriage returns and neither opens nor closes on a blank line", () => {
  let block = welcomeBlock(facts(), 80, TALL);
  expect(block.indexOf("\r") < 0);
  let lines = block.split("\n");
  expect(lines[0] != "");
  expect(lines[lines.length - 1] != "");
});

test("the wordmark sits on the first line with the version beside it, and is not repeated below", () => {
  let lines = plainLines(welcomeBlock(facts(), 80, TALL));
  expect(lines[0] == "joule " + VERSION);
  let i = 1;
  while (i < lines.length) {
    expect(lines[i].indexOf("joule " + VERSION) < 0);
    i = i + 1;
  }
});

test("the wordmark is accented and the version beside it is dim, not the other way round", () => {
  let first = welcomeBlock(facts(), 80, TALL).split("\n")[0];
  expect(first.indexOf(VIOLET + "joule" + RESET) == 0);
  expect(first.indexOf(DIM + VERSION + RESET) > 0);
});

test("every value in the key-value block starts on one left edge", () => {
  let rows = factLines(welcomeBlock(facts(), 80, TALL));
  expect(rows.length >= 4);
  let i = 0;
  while (i < rows.length) {
    expect(columnAt(rows[i], VALUE_COLUMN - 1) == " ");
    expect(columnAt(rows[i], VALUE_COLUMN) != " ");
    i = i + 1;
  }
});

test("the vertical rule opens once, closes once, and is plain in between", () => {
  let rows = ruleLines(welcomeBlock(facts(), 80, TALL));
  expect(rows[0].startsWith("┌"));
  expect(rows[rows.length - 1].startsWith("└"));
  let i = 1;
  while (i < rows.length - 1) {
    expect(rows[i].startsWith("│"));
    i = i + 1;
  }
});

test("the rule and the labels are dim, so they read as chrome rather than as content", () => {
  let raw = welcomeBlock(facts(), 80, TALL).split("\n");
  let i = 0;
  while (i < raw.length) {
    if (stripSgr(raw[i]).startsWith("┌")) {
      expect(raw[i].indexOf(DIM + "┌ " + RESET) == 0);
      expect(raw[i].indexOf(DIM + "workspace") > 0);
      expect(raw[i].indexOf("/home/aymen/project") > raw[i].indexOf(DIM + "workspace"));
    }
    i = i + 1;
  }
});

test("the block names the workspace, the repo, the agent and what may run without asking", () => {
  let block = stripSgr(welcomeBlock(facts(), 80, TALL));
  expect(block.indexOf("workspace") >= 0);
  expect(block.indexOf("/home/aymen/project") >= 0);
  expect(block.indexOf("repo") >= 0);
  expect(block.indexOf("joule-sh/code on main") >= 0);
  expect(block.indexOf("agent") >= 0);
  expect(block.indexOf("gpt-4") >= 0);
  expect(block.indexOf("may run") >= 0);
  expect(block.indexOf("auto-edit") >= 0);
});

test("a workspace with no git repository leaves the repo row out rather than showing an empty one", () => {
  let block = welcomeBlock(factsWith("auto-edit", "", ""), 80, TALL);
  expect(stripSgr(block).indexOf("repo") < 0);
  expect(factLines(block).length == 3);
});

test("the server is named only when it is not the default one", () => {
  expect(stripSgr(welcomeBlock(factsWith("auto-edit", "https://joule.sh", ""), 80, TALL)).indexOf("server") < 0);
  let staging = stripSgr(welcomeBlock(factsWith("auto-edit", "http://100.89.7.80:8090", ""), 80, TALL));
  expect(staging.indexOf("server") >= 0);
  expect(staging.indexOf("100.89.7.80:8090") >= 0);
});

test("safe-auto states plainly on the may-run row that commands run unattended", () => {
  let block = stripSgr(welcomeBlock(factsWith("safe-auto", "", ""), 80, TALL));
  expect(block.indexOf("safe-auto") >= 0);
  expect(block.indexOf("commands run unattended") >= 0);
});

test("an explanation that will not fit beside the mode moves to a continuation row instead of being dropped", () => {
  let block = welcomeBlock(factsWith("safe-auto", "", ""), 45, TALL);
  expect(stripSgr(block).indexOf("safe-auto") >= 0);
  expect(stripSgr(block).indexOf("commands run unattended") >= 0);
  expect(factLines(block).length == 4);
});

test("every mode has something to say about what it lets the agent do", () => {
  expect(permissionText("read-only") != "");
  expect(permissionText("auto-edit") != "");
  expect(permissionText("safe-auto") != "");
  expect(permissionText("full-auto") != "");
  expect(permissionText("plan") != "");
});

test("a workspace path too long for the column keeps its tail, which is the part that identifies it", () => {
  let long = "/home/aymen/some/really/long/path/that/does/not/fit/anywhere/at/all/checkout";
  let f: WelcomeFacts = { model: "m", workspace: long, repo: "", mode: "auto-edit", server: "" };
  let block = stripSgr(welcomeBlock(f, 45, TALL));
  expect(block.indexOf("checkout") >= 0);
  expect(block.indexOf(long) < 0);
  expect(block.indexOf("...") >= 0);
});

test("an eighty column terminal lays the command hints out in two columns", () => {
  let lines = hintLines(80);
  expect(lines.length == 3);
  let i = 0;
  while (i < lines.length) {
    expect(visualWidth(stripSgr(lines[i])) <= 80);
    expect(countOf(stripSgr(lines[i]), "/") == 2);
    i = i + 1;
  }
});

test("a forty-five column terminal falls back to one column rather than clipping both", () => {
  let lines = hintLines(45);
  expect(lines.length == hints().length);
  let i = 0;
  while (i < lines.length) {
    expect(visualWidth(stripSgr(lines[i])) <= 45);
    expect(countOf(stripSgr(lines[i]), "/") == 1);
    i = i + 1;
  }
});

test("the second column of hints starts on one left edge, not wherever the first description ended", () => {
  let lines = hintLines(80);
  let first = columnOf(stripSgr(lines[0]), "/login");
  expect(first > 0);
  expect(columnOf(stripSgr(lines[1]), "/share") == first);
  expect(columnOf(stripSgr(lines[2]), "/memory") == first);
});

test("a hint name is accented and its description dim, so the thing you can type stands out", () => {
  let line = hintLines(80)[0];
  expect(line.indexOf(VIOLET + "/model") == 0);
  expect(line.indexOf(DIM + "switch the model" + RESET) >= 0);
});

test("every command the hints advertise is a command the parser actually knows", () => {
  let all = hints();
  let i = 0;
  while (i < all.length) {
    expect(parseCommand(all[i].name).kind != CMD_UNKNOWN);
    i = i + 1;
  }
});

test("the hints are visible on arrival rather than hidden behind slash help", () => {
  let block = stripSgr(welcomeBlock(facts(), 80, TALL));
  expect(block.indexOf("/model") >= 0);
  expect(block.indexOf("/mode") >= 0);
  expect(block.indexOf("/share") >= 0);
});

test("the last line suggests what to type instead of leaving the reader at a bare caret", () => {
  let lines = plainLines(welcomeBlock(facts(), 80, TALL));
  expect(lines[lines.length - 1].indexOf("describe a change, or paste an error") >= 0);
  let narrow = plainLines(welcomeBlock(facts(), 45, TALL));
  expect(narrow[narrow.length - 1] != "");
});

test("stripped of every colour the block still reads as a table, so a no-colour terminal loses only colour", () => {
  let rows = factLines(welcomeBlock(facts(), 80, TALL));
  expect(columnOf(rows[0], "workspace") == 2);
  expect(columnOf(rows[0], "/home/aymen/project") == VALUE_COLUMN);
  expect(columnOf(rows[2], "gpt-4") == VALUE_COLUMN);
});

test("a width narrower than anything we support degrades instead of producing negative padding", () => {
  let lines = plainLines(welcomeBlock(facts(), 10, TALL));
  let i = 0;
  while (i < lines.length) {
    expect(visualWidth(lines[i]) <= 24);
    i = i + 1;
  }
});

test("the caller-facing builder produces the same block, with the repo looked up for it", () => {
  let block = stripSgr(buildWelcomeBox("gpt-4", "/home/aymen/project", "auto-edit", ""));
  expect(block.indexOf("joule " + VERSION) == 0);
  expect(block.indexOf("gpt-4") >= 0);
  expect(block.indexOf("auto-edit") >= 0);
});

test("the row budget leaves the status bar, the prompt and the arrival line their own rows", () => {
  expect(welcomeRows(24) == 18);
  expect(welcomeRows(12) == 6);
  expect(welcomeRows(10) == 6);
  expect(welcomeRows(2) == 1);
});

test("a terminal too short for everything gives up the hints first and the facts last", () => {
  let short = plainLines(welcomeBlock(facts(), 80, welcomeRows(10)));
  expect(short.length <= welcomeRows(10));
  expect(short[0] == "joule " + VERSION);
  let block = stripSgr(welcomeBlock(facts(), 80, welcomeRows(10)));
  expect(block.indexOf("workspace") >= 0);
  expect(block.indexOf("gpt-4") >= 0);
  expect(block.indexOf("auto-edit") >= 0);
  expect(block.indexOf("/model") < 0);
  expect(block.indexOf("describe a change") < 0);
});

test("a short narrow terminal still shows the whole key-value block, rule and all", () => {
  let rowsAt45 = factLines(welcomeBlock(facts(), 45, welcomeRows(12)));
  expect(rowsAt45.length >= 4);
  expect(rowsAt45[0].startsWith("┌"));
  expect(rowsAt45[rowsAt45.length - 1].startsWith("└"));
});

test("no block ever asks for more rows than the budget it was given", () => {
  let heights: int[] = [10, 12, 16, 24, 40];
  let i = 0;
  while (i < heights.length) {
    let budget = welcomeRows(heights[i]);
    expect(welcomeBlock(facts(), 80, budget).split("\n").length <= budget);
    expect(welcomeBlock(facts(), 45, budget).split("\n").length <= budget);
    i = i + 1;
  }
});

test("no line of the block wears the completion panel's shape, so a live menu never reads as this list", () => {
  let widths: int[] = [80, 45];
  let i = 0;
  while (i < widths.length) {
    let lines = plainLines(welcomeBlock(facts(), widths[i], TALL));
    let j = 0;
    while (j < lines.length) {
      expect(!lines[j].startsWith("  /"));
      expect(!lines[j].startsWith("> /"));
      j = j + 1;
    }
    i = i + 1;
  }
});

test("the hints hang off the same rule and the same two columns as the facts above them", () => {
  let all = ruleLines(welcomeBlock(facts(), 80, TALL));
  let facts_ = factLines(welcomeBlock(facts(), 80, TALL));
  expect(all.length > facts_.length + 1);
  expect(all[facts_.length].slice(3, all[facts_.length].length).trim() == "");
  let hintRow = all[all.length - 1];
  expect(columnOf(hintRow, "/tasks") == 2);
  expect(columnOf(hintRow, "background work") == VALUE_COLUMN);
});
