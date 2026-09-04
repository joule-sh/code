import { PendingSessionPick } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { REVERSE, DIM, BOLD, RESET, wrap } from "./style.ts";
import { ensureAttached, runningSessionsFor } from "../daemon/attach_lifecycle.ts";

const OPTION_INDENT: string = "    ";
const MARKER_ON: string = "> ";
const MARKER_OFF: string = "  ";
const PICKER_TITLE: string = "switch session";
const PICKER_HINT: string = "  (up/down to move, enter to switch - enter on the current one stays here)";
const DEFAULT_LABEL: string = "default";

export function sessionDisplayName(name: string): string {
  if (name == "") { return DEFAULT_LABEL; }
  return name;
}

function sessionEntryLabel(name: string, isCurrent: bool): string {
  let label = sessionDisplayName(name);
  if (isCurrent) { label = label + "  (current)"; }
  return label;
}

export function sessionEntryRow(name: string, isCurrent: bool, isSelected: bool): string {
  let label = sessionEntryLabel(name, isCurrent);
  if (isSelected) { return OPTION_INDENT + REVERSE + MARKER_ON + label + RESET; }
  return OPTION_INDENT + DIM + MARKER_OFF + label + RESET;
}

function pickerBody(entries: string[], selected: int, currentSession: string): string {
  let out = "";
  let i = 0;
  while (i < entries.length) {
    if (i > 0) { out = out + "\n"; }
    out = out + sessionEntryRow(entries[i], entries[i] == currentSession, i == selected);
    i = i + 1;
  }
  return out;
}

function indexOfSession(entries: string[], name: string): int {
  let i = 0;
  while (i < entries.length) {
    if (entries[i] == name) { return i; }
    i = i + 1;
  }
  return 0;
}

export function openSessionPick(pending: PendingSessionPick, sb: Scrollback, entries: string[], currentSession: string): void {
  pending.open(entries, indexOfSession(entries, currentSession));
  sb.append("\n" + wrap(BOLD, PICKER_TITLE) + wrap(DIM, PICKER_HINT) + "\n" + pickerBody(entries, pending.selected, currentSession));
  pending.setOptionRows(sb.lineCount() - entries.length);
}

export function repaintSessionPick(sb: Scrollback, pending: PendingSessionPick, currentSession: string): void {
  if (!pending.hasOptionRows()) { return; }
  let i = 0;
  while (i < pending.entries.length) {
    sb.setLine(pending.firstOptionRow + i, sessionEntryRow(pending.entries[i], pending.entries[i] == currentSession, i == pending.selected));
    i = i + 1;
  }
}

export function tryHandleSessionPickArrow(pending: PendingSessionPick, sb: Scrollback, inputEmpty: bool, delta: int, currentSession: string): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  if (pending.moveSelection(delta)) { repaintSessionPick(sb, pending, currentSession); }
  return true;
}

export function tryHandleSessionPickChar(pending: PendingSessionPick, inputEmpty: bool): bool {
  if (!pending.isPending() || !inputEmpty) { return false; }
  return true;
}

export function currentSessionLine(sessionName: string): string {
  return "\nsession: " + sessionDisplayName(sessionName);
}

export function stayingNote(sessionName: string): string {
  return "\n" + wrap(DIM, "staying in the " + sessionDisplayName(sessionName) + " session");
}

export function joulePlusSession(base: string, sessionName: string): string {
  if (sessionName == "") { return base; }
  return base + " --session " + sessionName;
}

export function warmSessionNotes(workspaceRoot: string, toSession: string): string[] {
  let result = ensureAttached(workspaceRoot, toSession, true);
  let lines: string[] = [];
  for (const n of result.notes) { lines.push(n); }
  if (result.client.socketReady) {
    lines.push("joule: the " + sessionDisplayName(toSession) + " session is ready - run " + joulePlusSession("joule", toSession) + " here to enter it.");
  } else {
    lines.push("joule: could not warm up the " + sessionDisplayName(toSession) + " session in the background, but running " + joulePlusSession("joule", toSession) + " here will start or attach to it directly.");
  }
  result.client.detach();
  return lines;
}

export function pickableSessions(workspaceRoot: string, currentSession: string): string[] {
  let running = runningSessionsFor(workspaceRoot);
  let out: string[] = [currentSession];
  for (const name of running) {
    if (name == currentSession) { continue; }
    out.push(name);
  }
  return out;
}
