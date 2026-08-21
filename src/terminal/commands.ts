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

export function helpText(): string {
  let lines: string[] = [
    "/help          show this help",
    "/model [name]  show or set the model",
    "/mode [mode]   show or set the approval mode (read-only, auto-edit, full-auto)",
    "/share         print the pairing URL for this session",
    "/cat <path>    show a file's contents without asking the model",
    "/tasks         list running and finished background tasks and subagents",
    "/tasks cancel <id>  ask a subagent to stop, or detach from a background task",
    "/clear         clear the scrollback",
    "PageUp/PageDown  scroll the transcript",
    "/exit          quit",
  ];
  let out = "";
  let i = 0;
  while (i < lines.length) {
    if (i > 0) { out = out + "\n"; }
    out = out + lines[i];
    i = i + 1;
  }
  return out;
}
