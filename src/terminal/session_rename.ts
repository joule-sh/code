// /rename (#339): move this session's saved history to a new name and warm a
// session there, the same "leave, never force a stop" stance /session
// switching already takes (session_switch.ts) - this codebase has no
// verified way to relocate a *live* daemon's identity out from under it, so
// a rename does not try to. What makes it a rename rather than a copy is
// that it refuses a target that already means something (a running session,
// or one with saved history of its own) and says plainly, in its own notes,
// that the old name is still around until the person stops it themselves.
import { Message } from "../session/types.ts";
import { loadWorkspaceSession, saveWorkspaceSession } from "../session/persistence.ts";
import { warmSessionNotes, sessionDisplayName, joulePlusSession } from "./session_switch.ts";

export type RenameCheck = { ok: bool, error: string };

export function renameTargetCheck(workspaceRoot: string, newName: string, currentName: string, otherRunning: string[]): RenameCheck {
  let name = newName.trim();
  if (name == "") { return { ok: false, error: "\nusage: /rename <new-name>" }; }
  if (name == currentName) { return { ok: false, error: "\nalready named " + sessionDisplayName(currentName) + "." }; }
  for (const n of otherRunning) {
    if (n == name) { return { ok: false, error: "\na session named " + sessionDisplayName(name) + " is already running on this workspace - switch to it with /session instead of renaming into it." }; }
  }
  if (loadWorkspaceSession(workspaceRoot, name) != null) {
    return { ok: false, error: "\na session named " + sessionDisplayName(name) + " already has saved history on this workspace - renaming into it would overwrite that, so pick another name." };
  }
  return { ok: true, error: "" };
}

// The teardown-time work, mirroring switchSessionNotes's shape: a standalone
// terminal owns its history directly and passes it as `freshHistory` so this
// flushes it to the old name first, the same way switchSessionNotes does -
// the daemon-attached terminal owns none (the daemon does), passes null, and
// relies on the daemon's own every-TURN_END save already being on disk.
// Either way, what gets copied to the new name is read back off disk right
// after, so both callers end up at the exact same next step: warm it, then
// say where the old name went rather than pretending it is gone.
export function renameNotes(workspaceRoot: string, fromSession: string, toSession: string, freshHistory: Message[] | null): string[] {
  if (freshHistory != null) { saveWorkspaceSession(workspaceRoot, fromSession, freshHistory); }
  let prior = loadWorkspaceSession(workspaceRoot, fromSession);
  if (prior != null) { saveWorkspaceSession(workspaceRoot, toSession, prior.history); }
  let lines = warmSessionNotes(workspaceRoot, toSession);
  lines.push("joule: the " + sessionDisplayName(fromSession) + " session this came from is still running under its old name - " + joulePlusSession("joule --stop", fromSession) + " ends it once you have moved over.");
  return lines;
}

test("renameTargetCheck refuses an empty name with usage, not a confusing 'already named' message", () => {
  let r = renameTargetCheck("/repo", "", "review", []);
  expect(!r.ok);
  expect(r.error.indexOf("usage: /rename") >= 0);
});

test("renameTargetCheck refuses renaming a session to its own current name", () => {
  let r = renameTargetCheck("/repo", "review", "review", []);
  expect(!r.ok);
  expect(r.error.indexOf("already named") >= 0);
});

test("renameTargetCheck refuses a name already running on this workspace", () => {
  let r = renameTargetCheck("/repo", "release", "review", ["release"]);
  expect(!r.ok);
  expect(r.error.indexOf("already running") >= 0);
});

test("renameTargetCheck trims the new name before comparing it", () => {
  let r = renameTargetCheck("/repo", "  review  ", "review", []);
  expect(!r.ok);
});

test("renameTargetCheck accepts a genuinely free name", () => {
  let r = renameTargetCheck("/repo-does-not-exist-anywhere", "brand-new", "review", ["release"]);
  expect(r.ok);
  expect(r.error == "");
});
