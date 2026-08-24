import { WINDOWS_DAEMON_NOTE } from "../daemon/attach_lifecycle.ts";

export type DaemonAttempt = { attached: bool, notes: string[] };

export function attached(): DaemonAttempt {
  let r: DaemonAttempt = { attached: true, notes: [] };
  return r;
}

export function declined(notes: string[]): DaemonAttempt {
  let r: DaemonAttempt = { attached: false, notes: notes };
  return r;
}

export function declineNotes(reasons: string[], workspaceRoot: string): string[] {
  let out: string[] = [];
  let sawPlatformDecline = false;
  for (const n of reasons) {
    if (n == WINDOWS_DAEMON_NOTE) { sawPlatformDecline = true; }
    out.push(n);
  }
  if (!sawPlatformDecline) {
    out.push("joule: could not reach or start a daemon for " + workspaceRoot + " - running in-process instead");
  }
  return out;
}

test("a declined attempt hands its notes back, because a callee cannot fill an array its caller passed", () => {
  let a = declined(declineNotes(["joule: nothing answered"], "/tmp/ws"));
  expect(!a.attached);
  expect(a.notes.length == 2);
  expect(a.notes[0] == "joule: nothing answered");
  expect(a.notes[1].indexOf("/tmp/ws") > 0);
});

test("the Windows decline is not followed by a second line saying the same thing", () => {
  let notes = declineNotes([WINDOWS_DAEMON_NOTE], "C:\\ws");
  expect(notes.length == 1);
  expect(notes[0] == WINDOWS_DAEMON_NOTE);
});

test("an attached attempt carries no notes for the terminal to print", () => {
  let a = attached();
  expect(a.attached);
  expect(a.notes.length == 0);
});
