export const CMD_HELP: string = "help";
export const CMD_MODEL: string = "model";
export const CMD_MODE: string = "mode";
export const CMD_SHARE: string = "share";
export const CMD_CAT: string = "cat";
export const CMD_TASKS: string = "tasks";
export const CMD_CLEAR: string = "clear";
export const CMD_EXIT: string = "exit";
export const CMD_UNKNOWN: string = "unknown";
export const CMD_NONE: string = "none";

export type ParsedCommand = { kind: string, arg: string };

export type CommandInfo = { name: string, args: string, description: string };

const HELP_COLUMN: int = 15;

function withKind(kind: string, arg: string): ParsedCommand {
  let p: ParsedCommand = { kind: kind, arg: arg };
  return p;
}

export function parseCommand(line: string): ParsedCommand {
  let trimmed = line.trim();
  if (!trimmed.startsWith("/")) {
    return withKind(CMD_NONE, "");
  }

  let rest = trimmed.slice(1);
  let spaceAt = rest.indexOf(" ");
  let name = rest;
  let arg = "";
  if (spaceAt >= 0) {
    name = rest.slice(0, spaceAt);
    arg = rest.slice(spaceAt + 1).trim();
  }

  if (name == "help") { return withKind(CMD_HELP, arg); }
  if (name == "model") { return withKind(CMD_MODEL, arg); }
  if (name == "mode") { return withKind(CMD_MODE, arg); }
  if (name == "share") { return withKind(CMD_SHARE, arg); }
  if (name == "cat") { return withKind(CMD_CAT, arg); }
  if (name == "tasks") { return withKind(CMD_TASKS, arg); }
  if (name == "clear") { return withKind(CMD_CLEAR, arg); }
  if (name == "exit") { return withKind(CMD_EXIT, arg); }
  return withKind(CMD_UNKNOWN, name);
}

export function commandList(): CommandInfo[] {
  let out: CommandInfo[] = [
    { name: "/help", args: "", description: "show this help" },
    { name: "/model", args: "[name]", description: "show or set the model" },
    { name: "/mode", args: "[mode]", description: "show or set the approval mode (read-only, auto-edit, full-auto)" },
    { name: "/share", args: "", description: "print the pairing URL for this session" },
    { name: "/cat", args: "<path>", description: "show a file's contents without asking the model" },
    { name: "/tasks", args: "[cancel <id>]", description: "list background tasks and subagents, or cancel one" },
    { name: "/clear", args: "", description: "clear the scrollback" },
    { name: "/exit", args: "", description: "quit" },
  ];
  return out;
}

function padColumn(text: string, width: int): string {
  let out = text + " ";
  while (out.length < width) {
    out = out + " ";
  }
  return out;
}

function helpLabel(cmd: CommandInfo): string {
  if (cmd.args == "") { return cmd.name; }
  return cmd.name + " " + cmd.args;
}

export function helpText(): string {
  let cmds = commandList();
  let out = "";
  let i = 0;
  while (i < cmds.length) {
    if (i > 0) { out = out + "\n"; }
    out = out + padColumn(helpLabel(cmds[i]), HELP_COLUMN) + cmds[i].description;
    i = i + 1;
  }
  out = out + "\n" + padColumn("PageUp/PageDown", HELP_COLUMN) + "scroll the transcript";
  out = out + "\n" + padColumn("ctrl-o", HELP_COLUMN) + "expand or collapse the last long tool output";
  return out;
}
