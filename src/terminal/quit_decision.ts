import { Scrollback } from "./scrollback.ts";
import { Message } from "../session/types.ts";
import { PendingQuitDecision, QUIT_DECISION_OPTION_COUNT } from "./input_state.ts";
import { quitDecisionOptionsBlock, quitDecisionOptionRow } from "./renderer.ts";
import { styleBanner } from "./style.ts";
import { persistTurnEnd } from "./resume.ts";
import { ensureAttached } from "../daemon/attach_lifecycle.ts";

const QUIT_PROMPT_BANNER: string = "leaving joule - what should happen to this session?";

export function openQuitDecision(pending: PendingQuitDecision, sb: Scrollback): void {
  sb.append("\n" + styleBanner(QUIT_PROMPT_BANNER) + quitDecisionOptionsBlock(0));
  pending.open();
  pending.setOptionRows(sb.lineCount() - QUIT_DECISION_OPTION_COUNT);
}

export function repaintQuitDecision(sb: Scrollback, pending: PendingQuitDecision): void {
  if (!pending.hasOptionRows()) { return; }
  let i = 0;
  while (i < QUIT_DECISION_OPTION_COUNT) {
    sb.setLine(pending.firstOptionRow + i, quitDecisionOptionRow(i, pending.selected));
    i = i + 1;
  }
}

// Hand the current session off to a background daemon: flush its history to the
// workspace store, then spawn (or reuse) a daemon that resumes exactly that -
// so `joule` here reattaches to the same conversation. Returns the lines to
// print once the terminal has left the alt screen. Never throws: if the daemon
// will not come up, the history is still saved, and the note says how to resume.
export function detachToBackground(workspaceRoot: string, history: Message[]): string[] {
  persistTurnEnd(workspaceRoot, history);
  let result = ensureAttached(workspaceRoot, true);
  let lines: string[] = [];
  for (const n of result.notes) { lines.push(n); }
  if (result.client.socketReady) {
    lines.push("joule: this session is now running in the background (daemon on 127.0.0.1:" + `${result.client.port}` + ").");
    lines.push("joule: run joule here to reattach, or joule --stop to end it.");
  } else {
    lines.push("joule: could not start a background daemon, but the session is saved - run joule --continue here to resume it.");
  }
  result.client.detach();
  return lines;
}
