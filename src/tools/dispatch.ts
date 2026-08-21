import { jsonStringMemberAt, jsonIntMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { ToolResult } from "../session/types.ts";
import { readFile, writeFile, editFile, listDir, grep } from "./files.ts";
import { run } from "./run.ts";

const DEFAULT_RUN_TIMEOUT_MS: int = 30000;

function joinWith(parts: string[], sep: string): string {
  let out = "";
  let i = 0;
  while (i < parts.length) {
    if (i > 0) { out = out + sep; }
    out = out + parts[i];
    i = i + 1;
  }
  return out;
}

export function ok(output: string, truncated: bool): ToolResult {
  return { ok: true, output: output, truncated: truncated };
}

export function fail(output: string): ToolResult {
  return { ok: false, output: output, truncated: false };
}

function dispatchRead(root: string, args: string): ToolResult {
  let path = jsonStringMemberAt(args, 0, "path");
  let offset = jsonIntMemberAt(args, 0, "offset");
  let limit = jsonIntMemberAt(args, 0, "limit");
  let r = readFile(root, path, offset, limit);
  if (!r.ok) { return fail(r.error); }
  return ok(r.content, r.truncated);
}

function dispatchWrite(root: string, args: string): ToolResult {
  let path = jsonStringMemberAt(args, 0, "path");
  let content = jsonStringMemberAt(args, 0, "content");
  let r = writeFile(root, path, content);
  if (!r.ok) { return fail(r.error); }
  return ok("wrote " + `${content.length}` + " bytes to " + path, false);
}

function dispatchEdit(root: string, args: string): ToolResult {
  let path = jsonStringMemberAt(args, 0, "path");
  let oldText = jsonStringMemberAt(args, 0, "old_text");
  let newText = jsonStringMemberAt(args, 0, "new_text");
  let r = editFile(root, path, oldText, newText);
  if (!r.ok) { return fail(r.error); }
  return ok("edited " + path, false);
}

function dispatchList(root: string, args: string): ToolResult {
  let path = jsonStringMemberAt(args, 0, "path");
  let r = listDir(root, path);
  if (!r.ok) { return fail(r.error); }
  if (r.entries.length == 0) { return ok("(empty)", false); }
  return ok(joinWith(r.entries, "\n"), false);
}

function dispatchGrep(root: string, args: string): ToolResult {
  let pattern = jsonStringMemberAt(args, 0, "pattern");
  let glob = jsonStringMemberAt(args, 0, "glob");
  let r = grep(root, pattern, glob);
  if (!r.ok) { return fail(r.error); }
  if (r.matches.length == 0) { return ok("no matches", r.truncated); }
  let lines: string[] = [];
  for (const m of r.matches) {
    lines.push(m.file + ":" + `${m.line}` + ": " + m.text);
  }
  return ok(joinWith(lines, "\n"), r.truncated);
}

function dispatchRun(root: string, args: string): ToolResult {
  let command = jsonStringMemberAt(args, 0, "command");
  let timeoutMs = jsonIntMemberAt(args, 0, "timeout_ms");
  if (timeoutMs <= 0) { timeoutMs = DEFAULT_RUN_TIMEOUT_MS; }
  let r = run(root, command, timeoutMs);
  if (!r.ok) { return fail(r.error); }
  let statusLine = "exit " + `${r.status}`;
  if (r.killed) { statusLine = statusLine + " (over budget: " + r.error + ")"; }
  let body = statusLine + "\n" + r.stdout;
  if (r.stderr != "") { body = body + "\nstderr:\n" + r.stderr; }
  return ok(body, r.truncated);
}

export function dispatchCoreTool(root: string, tool: string, args: string): ToolResult {
  if (tool == "read") { return dispatchRead(root, args); }
  if (tool == "write") { return dispatchWrite(root, args); }
  if (tool == "edit") { return dispatchEdit(root, args); }
  if (tool == "list") { return dispatchList(root, args); }
  if (tool == "grep") { return dispatchGrep(root, args); }
  if (tool == "run") { return dispatchRun(root, args); }
  return fail("unknown tool: " + tool);
}
