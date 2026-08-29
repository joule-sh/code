// Two flags for a `joule` launched by something other than a person at a
// keyboard - a script, a cron job, another program shelling out (#344, #345).
// Both read argv directly rather than through a Session/Gate, so the same
// two functions serve the daemon-attached path (attach.ts) and the
// standalone fallback (terminal.ts) identically.
import { isValidMode } from "./slots.ts";
import { MODE_PLAN } from "../approval/gate.ts";

export const MODE_FLAG: string = "--mode";
export const PROMPT_FLAG: string = "--prompt";

function flagValue(argv: string[], name: string): string {
  let i = 0;
  while (i < argv.length) {
    if (argv[i] == name && i + 1 < argv.length) { return argv[i + 1]; }
    i = i + 1;
  }
  return "";
}

export type ModeFlagResult = { mode: string, error: string };

// "" mode with "" error means the flag was not given at all - callers should
// leave the default mode alone. Plan is refused rather than silently
// downgraded: entering it for real means the same ceremony /mode plan runs
// (enterPlanMode), which a bare mode assignment at startup does not do, so
// accepting it here would silently produce a session that only looks like
// it is in plan mode.
export function modeFlagResult(argv: string[]): ModeFlagResult {
  let raw = flagValue(argv, MODE_FLAG);
  if (raw == "") { return { mode: "", error: "" }; }
  if (raw == MODE_PLAN) {
    return { mode: "", error: "joule: --mode plan is not supported yet - entering plan mode needs its own startup ceremony that this flag does not run. Use /mode plan once the session is up." };
  }
  if (!isValidMode(raw)) {
    return { mode: "", error: "joule: unknown --mode " + raw + " (expected read-only, auto-edit, safe-auto, or full-auto)" };
  }
  return { mode: raw, error: "" };
}

export function promptFlag(argv: string[]): string {
  return flagValue(argv, PROMPT_FLAG);
}

test("modeFlagResult is empty when the flag is absent, so a caller knows to leave the default alone", () => {
  let r = modeFlagResult(["joule"]);
  expect(r.mode == "");
  expect(r.error == "");
});

test("modeFlagResult accepts a real non-plan mode", () => {
  let r = modeFlagResult(["joule", "--mode", "full-auto"]);
  expect(r.mode == "full-auto");
  expect(r.error == "");
});

test("modeFlagResult refuses plan with an explanation, not a silent downgrade", () => {
  let r = modeFlagResult(["joule", "--mode", "plan"]);
  expect(r.mode == "");
  expect(r.error.indexOf("plan") >= 0);
});

test("modeFlagResult refuses an unknown mode name and names the valid ones", () => {
  let r = modeFlagResult(["joule", "--mode", "yolo"]);
  expect(r.mode == "");
  expect(r.error.indexOf("unknown --mode yolo") >= 0);
});

test("modeFlagResult ignores a trailing --mode with nothing after it", () => {
  let r = modeFlagResult(["joule", "--mode"]);
  expect(r.mode == "");
  expect(r.error == "");
});

test("promptFlag reads the value right after --prompt", () => {
  expect(promptFlag(["joule", "--prompt", "fix the bug"]) == "fix the bug");
});

test("promptFlag is empty when the flag is absent", () => {
  expect(promptFlag(["joule"]) == "");
});
