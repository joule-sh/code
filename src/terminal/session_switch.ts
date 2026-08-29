// The /session picker (#331): list the sessions currently running on this
// workspace and switch to one by name. Mirrors model_picker.ts for the list
// itself, and quit_decision.ts for the part that actually leaves - switching
// sessions means leaving this terminal, the same way keeping a session in
// the background does, because there is no in-place handoff of a real
// terminal from one process to another that this codebase has ever done or
// verified; printing the exact command to run is honest about that rather
// than pretending to teleport.
import { Message } from "../session/types.ts";
import { PendingSessionPick } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { REVERSE, DIM, BOLD, RESET, wrap } from "./style.ts";
import { persistTurnEnd } from "./resume.ts";
import { ensureAttached, runningSessionsFor } from "../daemon/attach_lifecycle.ts";

const OPTION_INDENT: string = "    ";
const MARKER_ON: string = "> ";
const MARKER_OFF: string = "  ";
const PICKER_TITLE: string = "switch session";
const PICKER_HINT: string = "  (up/down to move, enter to switch - enter on the current one stays here)";
const DEFAULT_LABEL: string = "default";

// What a session name reads as in the picker and in prose - "default" for
// the unnamed one, so nothing in the UI ever shows a blank row or an empty
// command.
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

// What /session with no argument shows: the current session name (like
// /model and /mode already do with nothing to pick between) when it is the
// only one running, or the picker above when there is a real choice.
export function currentSessionLine(sessionName: string): string {
  return "\nsession: " + sessionDisplayName(sessionName);
}

export function stayingNote(sessionName: string): string {
  return "\n" + wrap(DIM, "staying in the " + sessionDisplayName(sessionName) + " session");
}

// A runnable command for this exact workspace and session - "joule" or
// "joule --session review" - so a note names the command that actually gets
// someone there, the same helper quit_decision.ts uses for the same reason.
export function joulePlusSession(base: string, sessionName: string): string {
  if (sessionName == "") { return base; }
  return base + " --session " + sessionName;
}

// Make sure the target session has a daemon up and warm (resuming its own
// saved history if it has any), without attaching to it, and hand back the
// lines to print once the terminal has actually left - the command that
// gets someone into the session they just chose. Shared by both terminals
// this codebase has: the standalone one (which also owns history to flush
// first, see switchSessionNotes below) and the daemon-attached one (which
// owns none - the daemon it was already talking to keeps it).
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

// The standalone terminal's version: it owns `history` directly (there is no
// daemon holding it yet), so leaving for another session means flushing this
// one first - the same persistTurnEnd every TURN_END already calls - then
// warming the target, then saying this session is not going anywhere either.
export function switchSessionNotes(workspaceRoot: string, fromSession: string, toSession: string, history: Message[]): string[] {
  persistTurnEnd(workspaceRoot, fromSession, history);
  let lines = warmSessionNotes(workspaceRoot, toSession);
  lines.push("joule: this session" + describeSessionSuffixForSwitch(fromSession) + " keeps running in the background - " + joulePlusSession("joule", fromSession) + " returns to it, " + joulePlusSession("joule --stop", fromSession) + " ends it.");
  return lines;
}

function describeSessionSuffixForSwitch(name: string): string {
  if (name == "") { return ""; }
  return " (" + name + ")";
}

// The sessions /session with no argument offers: every session currently
// running on this workspace, the current one first so Enter on a fresh
// prompt is always "stay here."
export function pickableSessions(workspaceRoot: string, currentSession: string): string[] {
  let running = runningSessionsFor(workspaceRoot);
  let out: string[] = [currentSession];
  for (const name of running) {
    if (name == currentSession) { continue; }
    out.push(name);
  }
  return out;
}
