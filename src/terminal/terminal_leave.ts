import { Message } from "../session/types.ts";
import { detachToBackground } from "./quit_decision.ts";
import { renameNotes } from "./session_rename.ts";
import { persistTurnEnd } from "./resume.ts";

export function printLeaveNotes(workspaceRoot: string, sessionName: string, history: Message[], detachRequested: bool, switchTarget: string, renameTarget: string): void {
  if (detachRequested) {
    for (const line of detachToBackground(workspaceRoot, sessionName, history)) { console.log(line); }
  }
  if (switchTarget != "") {
    persistTurnEnd(workspaceRoot, sessionName, history);
    for (const line of detachToBackground(workspaceRoot, sessionName, history)) { console.log(line); }
  }
  if (renameTarget != "") {
    for (const line of renameNotes(workspaceRoot, sessionName, renameTarget, history)) { console.log(line); }
  }
}
