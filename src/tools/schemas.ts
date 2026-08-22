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
  description: "Run a shell command in the workspace root and capture its output (stdout and stderr merged into one stream). A non-zero exit is a normal result, not an error - read the output to see what happened. Output is capped; check truncated. The command's stdin is not connected to anything, so an interactive prompt fails fast rather than hanging. Runs under a default 30000ms budget when timeout_ms is not given; if that budget (or a given one) is exceeded, the tool stops waiting and reports the run as abandoned rather than killed - the process itself may still be running, since it cannot be forcibly stopped (lumen-lang-org/lumen#6). In the interactive session, ctrl-c does the same thing on demand: it hands control back immediately instead of waiting out the budget, and marks the run abandoned rather than leaving it looking finished. Set background to true for a command expected to take a while (a build, a test suite, a dev server) - it starts under approval exactly like any other run call, then keeps running while you keep working; check /tasks or wait for its output to stream into the scrollback. A backgrounded command's stderr is not captured (only stdout streams back) and, like the foreground case, it cannot be forcibly killed once started - only let it finish or let the whole session end with it.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"command\":{\"type\":\"string\"},\"timeout_ms\":{\"type\":\"integer\",\"description\":\"budget in milliseconds; a command that overruns it is abandoned - the wait stops, the process itself is not forcibly stopped\"},\"background\":{\"type\":\"boolean\",\"description\":\"run without blocking the session; output streams into the scrollback and /tasks as it happens instead of being returned all at once\"}},\"required\":[\"command\"]}",
};

export const SPAWN_AGENT_SCHEMA: ToolSchema = {
  name: "spawn_agent",
  description: "Spawn an independent subagent to work a scoped sub-problem on its own turn loop, using the same read/write/edit/list/grep/run tools, while this session keeps going. It runs under the same approval mode this session is in right now - anything it needs to ask about shows up as a normal approval card here. It cannot spawn further subagents, and it cannot be forcibly killed once started, only asked to stop between its own steps (see /tasks). Its result is appended to this conversation's history automatically once it finishes, so a later message can refer to what it found or did.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"task\":{\"type\":\"string\",\"description\":\"a self-contained description of the sub-problem - the subagent starts with no other context\"}},\"required\":[\"task\"]}",
};

export const TASK_STATUS_SCHEMA: ToolSchema = {
  name: "task_status",
  description: "Check a task started by run with background:true or by spawn_agent: still running, exit status if finished, and recent output (tail only, bounded to 100 lines / 4000 bytes). Cannot stop or restart it. Omit id to list every task's id and short status.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\",\"description\":\"task id such as bgrun-1 or agent-2, from the call that started it; omit to list all tasks\"}},\"required\":[]}",
};

export function allFileToolSchemas(): ToolSchema[] {
  return [READ_SCHEMA, WRITE_SCHEMA, EDIT_SCHEMA, LIST_SCHEMA, GREP_SCHEMA];
}

export function allToolSchemas(): ToolSchema[] {
  return [READ_SCHEMA, WRITE_SCHEMA, EDIT_SCHEMA, LIST_SCHEMA, GREP_SCHEMA, RUN_SCHEMA, SPAWN_AGENT_SCHEMA, TASK_STATUS_SCHEMA];
}

export function subagentToolSchemas(): ToolSchema[] {
  return [READ_SCHEMA, WRITE_SCHEMA, EDIT_SCHEMA, LIST_SCHEMA, GREP_SCHEMA, RUN_SCHEMA];
}
