import { ToolSchema } from "../providers/openai.ts";

export const READ_SCHEMA: ToolSchema = {
  name: "read",
  description: "Read a file in the workspace, optionally a line range.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"},\"offset\":{\"type\":\"integer\",\"description\":\"first line to read, 0-based\"},\"limit\":{\"type\":\"integer\",\"description\":\"max lines to read\"}},\"required\":[\"path\"]}",
};

export const WRITE_SCHEMA: ToolSchema = {
  name: "write",
  description: "Write a file in the workspace, creating parent directories as needed. Overwrites any existing content.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"},\"content\":{\"type\":\"string\"}},\"required\":[\"path\",\"content\"]}",
};

export const EDIT_SCHEMA: ToolSchema = {
  name: "edit",
  description: "Replace one exact occurrence of old_text with new_text in a file. Refuses if old_text appears zero times or more than once.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"},\"old_text\":{\"type\":\"string\"},\"new_text\":{\"type\":\"string\"}},\"required\":[\"path\",\"old_text\",\"new_text\"]}",
};

export const LIST_SCHEMA: ToolSchema = {
  name: "list",
  description: "List the entries of a directory in the workspace.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"path\":{\"type\":\"string\"}},\"required\":[\"path\"]}",
};

export const GREP_SCHEMA: ToolSchema = {
  name: "grep",
  description: "Search files in the workspace for a literal substring, optionally limited to files matching a simple glob (one * wildcard, e.g. *.ts). Not a regex search.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"pattern\":{\"type\":\"string\"},\"glob\":{\"type\":\"string\"}},\"required\":[\"pattern\"]}",
};

export const RUN_SCHEMA: ToolSchema = {
  name: "run",
  description: "Run a shell command in the workspace root and capture its output. A non-zero exit is a normal result, not an error - read stdout/stderr to see what happened. Output is capped; check truncated. The command's stdin is not connected to anything, so an interactive prompt fails fast rather than hanging.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"command\":{\"type\":\"string\"},\"timeout_ms\":{\"type\":\"integer\",\"description\":\"best-effort budget in milliseconds; a command that overruns it is flagged but not forcibly stopped\"}},\"required\":[\"command\"]}",
};

export function allFileToolSchemas(): ToolSchema[] {
  return [READ_SCHEMA, WRITE_SCHEMA, EDIT_SCHEMA, LIST_SCHEMA, GREP_SCHEMA];
}

export function allToolSchemas(): ToolSchema[] {
  return [READ_SCHEMA, WRITE_SCHEMA, EDIT_SCHEMA, LIST_SCHEMA, GREP_SCHEMA, RUN_SCHEMA];
}
