import { Message, ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL, ROLE_SYSTEM } from "../session/types.ts";
import { loadWorkspaceSession, saveWorkspaceSession } from "../session/persistence.ts";
import { stylePrompt, styleBanner, wrap, DIM } from "./style.ts";

const CONTINUE_FLAG: string = "--continue";
const TOOL_LINE_MAX: int = 200;

export type ResumeOutcome = { history: Message[] | null, note: string };

export function hasContinueFlag(argv: string[]): bool {
  for (const a of argv) {
    if (a == CONTINUE_FLAG) { return true; }
  }
  return false;
}

function firstLine(text: string): string {
  let at = text.indexOf("\n");
  let head = text;
  if (at >= 0) { head = text.slice(0, at); }
  if (head.length > TOOL_LINE_MAX) {
    return head.slice(0, TOOL_LINE_MAX) + "...";
  }
  return head;
}

function nonSystemCount(history: Message[]): int {
  let count = 0;
  for (const m of history) {
    if (m.role != ROLE_SYSTEM) { count = count + 1; }
  }
  return count;
}

function renderResumedMessage(m: Message): string {
  if (m.role == ROLE_USER) {
    return "\n" + stylePrompt("> ") + m.text;
  }
  if (m.role == ROLE_ASSISTANT) {
    if (m.text != "") { return "\n" + m.text; }
    if (m.toolCalls.length > 0) {
      return "\n" + wrap(DIM, "  requested " + `${m.toolCalls.length}` + " tool call(s)");
    }
    return "";
  }
  if (m.role == ROLE_TOOL) {
    return "\n" + wrap(DIM, "  [" + firstLine(m.text) + "]");
  }
  return "";
}

export function renderResumedTranscript(history: Message[]): string {
  let out = "\n" + styleBanner("--- resumed previous session (" + `${nonSystemCount(history)}` + " messages) ---");
  for (const m of history) {
    if (m.role == ROLE_SYSTEM) { continue; }
    out = out + renderResumedMessage(m);
  }
  out = out + "\n" + styleBanner("--- end of resumed history ---");
  return out;
}

export function decideResume(shouldContinue: bool, hasFile: bool, history: Message[]): ResumeOutcome {
  if (!shouldContinue) {
    let none: ResumeOutcome = { history: null, note: "" };
    return none;
  }
  if (!hasFile || history.length == 0) {
    let missing: ResumeOutcome = { history: null, note: "\n" + styleBanner("no previous session found for this workspace, starting fresh") };
    return missing;
  }
  let found: ResumeOutcome = { history: history, note: renderResumedTranscript(history) };
  return found;
}

export function resolveResume(argv: string[], workspaceRoot: string): ResumeOutcome {
  let shouldContinue = hasContinueFlag(argv);
  if (!shouldContinue) {
    let empty: Message[] = [];
    return decideResume(false, false, empty);
  }
  let file = loadWorkspaceSession(workspaceRoot);
  if (file == null) {
    let empty: Message[] = [];
    return decideResume(true, false, empty);
  }
  return decideResume(true, true, file.history);
}

export function persistTurnEnd(workspaceRoot: string, history: Message[]): void {
  saveWorkspaceSession(workspaceRoot, history);
}
