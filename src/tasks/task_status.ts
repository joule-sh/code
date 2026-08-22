import { readAllMailboxEntries } from "./mailbox.ts";
import { BackgroundRunTask, SubagentTask } from "./state.ts";

export const MAX_STATUS_OUTPUT_LINES: int = 100;
export const MAX_STATUS_OUTPUT_BYTES: int = 4000;

type TailResult = { text: string, truncated: bool };

function joinNewline(parts: string[]): string {
  let out = "";
  let i = 0;
  while (i < parts.length) {
    if (i > 0) { out = out + "\n"; }
    out = out + parts[i];
    i = i + 1;
  }
  return out;
}

function tailLines(lines: string[], maxLines: int, maxBytes: int): TailResult {
  let start = 0;
  let truncatedByCount = false;
  if (lines.length > maxLines) {
    start = lines.length - maxLines;
    truncatedByCount = true;
  }
  let kept: string[] = [];
  let i = start;
  while (i < lines.length) {
    kept.push(lines[i]);
    i = i + 1;
  }
  let joined = joinNewline(kept);
  if (joined.length <= maxBytes) {
    let r: TailResult = { text: joined, truncated: truncatedByCount };
    return r;
  }
  let cut = joined.slice(joined.length - maxBytes, joined.length);
  let r2: TailResult = { text: cut, truncated: true };
  return r2;
}

function runTaskLines(t: BackgroundRunTask): string[] {
  let entries = readAllMailboxEntries(t.mailboxPath);
  let lines: string[] = [];
  let i = 0;
  while (i < entries.length) {
    if (entries[i].tag == "LINE") { lines.push(entries[i].payload); }
    i = i + 1;
  }
  return lines;
}

function boundNote(): string {
  return "\n[output truncated to the last " + `${MAX_STATUS_OUTPUT_LINES}` + " lines / " + `${MAX_STATUS_OUTPUT_BYTES}` + " bytes]";
}

export function buildRunTaskStatus(t: BackgroundRunTask): string {
  let tail = tailLines(runTaskLines(t), MAX_STATUS_OUTPUT_LINES, MAX_STATUS_OUTPUT_BYTES);
  let statusLine = "running";
  if (t.done) {
    statusLine = "finished, " + (t.lastStatus == "" ? "exit status unknown" : t.lastStatus);
  } else if (t.detached) {
    statusLine = "detached - process may still be running but its output is no longer observed";
  }
  let header = "task " + t.id + " (" + t.command + "): " + statusLine + ", " + `${t.lineCount}` + " output lines seen so far";
  let body = tail.text == "" ? "(no output yet)" : tail.text;
  if (tail.truncated) { body = body + boundNote(); }
  return header + "\n" + body;
}

export function buildAgentTaskStatus(t: SubagentTask): string {
  if (t.done) {
    return "subagent " + t.id + " (" + t.taskText + "): finished - " + t.finalNote;
  }
  let tail = tailLines([t.accumulated], 1, MAX_STATUS_OUTPUT_BYTES);
  let body = tail.text == "" ? "(no output yet)" : tail.text;
  if (tail.truncated) { body = body + boundNote(); }
  return "subagent " + t.id + " (" + t.taskText + "): running\n" + body;
}
