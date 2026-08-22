import { parseCommand, helpText, commandList, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SHARE, CMD_LOGIN, CMD_LOGOUT, CMD_CAT, CMD_TASKS, CMD_MEMORY, CMD_UPDATE, CMD_CLEAR, CMD_EXIT, CMD_UNKNOWN, CMD_NONE } from "./commands.ts";

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

test("/login and /logout parse with no arg", () => {
  expect(parseCommand("/login").kind == CMD_LOGIN);
  expect(parseCommand("/logout").kind == CMD_LOGOUT);
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

test("helpText documents the ctrl-o expand key", () => {
  let h = helpText();
  expect(h.indexOf("ctrl-o") >= 0);
  expect(h.indexOf("expand or collapse") >= 0);
});

test("helpText documents the PageUp/PageDown scroll keys", () => {
  let h = helpText();
  expect(h.indexOf("PageUp") >= 0);
  expect(h.indexOf("PageDown") >= 0);
  expect(h.indexOf("scroll") >= 0);
});

test("helpText documents the Shift+drag selection workaround", () => {
  let h = helpText();
  expect(h.indexOf("Shift+drag") >= 0);
  expect(h.indexOf("GNOME Terminal") >= 0);
  expect(h.indexOf("iTerm2") >= 0);
  expect(h.indexOf("Terminal.app") >= 0);
});

test("/tasks parses with no arg", () => {
  let p = parseCommand("/tasks");
  expect(p.kind == CMD_TASKS);
  expect(p.arg == "");
});

test("/tasks cancel <id> keeps the whole remainder as one arg", () => {
  let p = parseCommand("/tasks cancel agent-1");
  expect(p.kind == CMD_TASKS);
  expect(p.arg == "cancel agent-1");
});

test("/memory parses with no arg", () => {
  let p = parseCommand("/memory");
  expect(p.kind == CMD_MEMORY);
  expect(p.arg == "");
});

test("/memory add <text> keeps the whole remainder as one arg", () => {
  let p = parseCommand("/memory add prefers tabs over spaces");
  expect(p.kind == CMD_MEMORY);
  expect(p.arg == "add prefers tabs over spaces");
});

test("/memory forget <n> keeps the whole remainder as one arg", () => {
  let p = parseCommand("/memory forget 3");
  expect(p.kind == CMD_MEMORY);
  expect(p.arg == "forget 3");
});

test("/update parses with no arg", () => {
  let p = parseCommand("/update");
  expect(p.kind == CMD_UPDATE);
  expect(p.arg == "");
});

test("helpText renders every entry of the shared command list, so the two cannot drift", () => {
  let cmds = commandList();
  let h = helpText();
  let i = 0;
  while (i < cmds.length) {
    expect(h.indexOf(cmds[i].name) >= 0);
    expect(h.indexOf(cmds[i].description) >= 0);
    i = i + 1;
  }
});

test("the shared command list covers every command parseCommand knows", () => {
  let cmds = commandList();
  let i = 0;
  while (i < cmds.length) {
    expect(parseCommand(cmds[i].name).kind != CMD_UNKNOWN);
    expect(parseCommand(cmds[i].name).kind != CMD_NONE);
    i = i + 1;
  }
});
