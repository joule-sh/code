import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SHARE, CMD_CAT, CMD_CLEAR, CMD_EXIT, CMD_UNKNOWN, CMD_NONE } from "./commands.ts";

test("plain text is not a command", () => {
  let p = parseCommand("add a health endpoint");
  expect(p.kind == CMD_NONE);
});

test("/help parses with no arg", () => {
  let p = parseCommand("/help");
  expect(p.kind == CMD_HELP);
  expect(p.arg == "");
});

test("/model with an argument", () => {
  let p = parseCommand("/model gpt-4o");
  expect(p.kind == CMD_MODEL);
  expect(p.arg == "gpt-4o");
});

test("/mode with an argument", () => {
  let p = parseCommand("/mode full-auto");
  expect(p.kind == CMD_MODE);
  expect(p.arg == "full-auto");
});

test("/share /clear /exit all parse", () => {
  expect(parseCommand("/share").kind == CMD_SHARE);
  expect(parseCommand("/clear").kind == CMD_CLEAR);
  expect(parseCommand("/exit").kind == CMD_EXIT);
});

test("/cat with a path argument", () => {
  let p = parseCommand("/cat src/main.ts");
  expect(p.kind == CMD_CAT);
  expect(p.arg == "src/main.ts");
});

test("/cat with no argument parses with an empty arg", () => {
  let p = parseCommand("/cat");
  expect(p.kind == CMD_CAT);
  expect(p.arg == "");
});

test("an unknown slash command is flagged, not silently ignored", () => {
  let p = parseCommand("/frobnicate");
  expect(p.kind == CMD_UNKNOWN);
  expect(p.arg == "frobnicate");
});

test("leading/trailing whitespace does not confuse parsing", () => {
  let p = parseCommand("   /model   claude-opus   ");
  expect(p.kind == CMD_MODEL);
  expect(p.arg == "claude-opus");
});

test("helpText lists every command", () => {
  let h = helpText();
  expect(h.indexOf("/help") >= 0);
  expect(h.indexOf("/model") >= 0);
  expect(h.indexOf("/mode") >= 0);
  expect(h.indexOf("/share") >= 0);
  expect(h.indexOf("/cat") >= 0);
  expect(h.indexOf("/clear") >= 0);
  expect(h.indexOf("/exit") >= 0);
});
