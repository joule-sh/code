// What a daemon reads off its own command line and environment before it has
// a session: the approval mode it comes up in, an optional first task, and
// where its runtime directory lives.
//
// A daemon started for an unattended environment has nobody to answer an
// approval.request, so it burns the gate's timeout on every gated tool call
// and then denies it. Until now the only way out was a mode.set frame from an
// attached client, which is exactly what an unattended daemon does not have
// (#348). The mode has to be answerable at startup.
//
// The parsing is modeFlagResult/promptFlag from the terminal's startup flags,
// unchanged and unwrapped: one parser, so `joule` and `joule-daemon` refuse
// the same input the same way and cannot drift. The error strings are those
// functions' own, printed verbatim, for the same reason.
import { modeFlagResult, promptFlag } from "../terminal/startup_flags.ts";
import { MODE_SAFE_AUTO } from "../approval/gate.ts";
import { daemonRuntimeDir } from "./paths.ts";
import { isAbsolutePath } from "../update/install_detect.ts";

export const RUNTIME_DIR_ENV: string = "JOULE_DAEMON_RUNTIME_DIR";

export type DaemonStartup = { mode: string, prompt: string, error: string };

// An absent --mode means safe-auto, which is what the daemon hardcoded before
// this existed: a daemon nobody passes a flag to comes up exactly as it did.
export function daemonStartup(argv: string[]): DaemonStartup {
  let choice = modeFlagResult(argv);
  if (choice.error != "") {
    return { mode: MODE_SAFE_AUTO, prompt: "", error: choice.error };
  }
  let mode = MODE_SAFE_AUTO;
  if (choice.mode != "") { mode = choice.mode; }
  return { mode: mode, prompt: promptFlag(argv), error: "" };
}

export type RuntimeDirChoice = { dir: string, error: string };

// Where the inbox and the broadcast log go. Derived from the workspace and
// session name as it always was, unless something outside names it outright.
//
// The override exists because the daemon's frame plumbing is file-backed, and
// a program driving a daemon it did not start - the agents engine, reaching
// into a container with `docker exec` - has to name that directory to write
// an inbox line or tail the broadcast log. Deriving it there instead would
// mean a second implementation of sessionKeyFor's hash in another language in
// another repository, which is a drift bug waiting to happen; being told the
// directory removes the derivation from the caller entirely (#348).
//
// A relative path is refused rather than resolved. The whole point is that two
// processes name one directory, and two processes with different working
// directories resolve one relative path to two different places - the failure
// that produces is a daemon that reads an inbox nobody writes, which is
// silence rather than an error. A path that does not exist yet is fine and is
// created by the caller, the same as the derived one always has been.
export function runtimeDirChoice(override: string, workspaceRoot: string, sessionName: string): RuntimeDirChoice {
  let named = override.trim();
  if (named == "") {
    return { dir: daemonRuntimeDir(workspaceRoot, sessionName), error: "" };
  }
  if (!isAbsolutePath(named)) {
    return { dir: "", error: "joule-daemon: " + RUNTIME_DIR_ENV + " must be an absolute path, got " + named + " - a relative one names a different directory to every process that resolves it, which is what this variable exists to avoid" };
  }
  return { dir: named, error: "" };
}
