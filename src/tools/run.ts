import { powershellQuoteSingle, shellQuoteSingle } from "./shell_quote.ts";
import { isWindows, shellArgs, shellProgram } from "../vendor/platform/platform.ts";

const MAX_OUTPUT_BYTES: int = 100000;

export type RunResult = { ok: bool, status: int, stdout: string, stderr: string, truncated: bool, killed: bool, error: string };

type CapResult = { text: string, truncated: bool };

function capOutput(s: string): CapResult {
  if (s.length <= MAX_OUTPUT_BYTES) {
    let r: CapResult = { text: s, truncated: false };
    return r;
  }
  let r: CapResult = { text: s.slice(0, MAX_OUTPUT_BYTES), truncated: true };
  return r;
}

// The prefix that puts the command in the workspace is spelled per shell; what
// follows it is the model's command verbatim. On Windows that means the model
// is talking to PowerShell, and a POSIX idiom with no PowerShell alias - a
// pipeline into sed, a heredoc, $(...) - fails there as a syntax error rather
// than being translated (#173).
export function inWorkspace(root: string, command: string): string {
  if (isWindows()) {
    return "Set-Location -LiteralPath " + powershellQuoteSingle(root) + "; " + command;
  }
  return "cd " + shellQuoteSingle(root) + " && " + command;
}

export function run(root: string, command: string, timeoutMs: int): RunResult {
  let args: string[] = shellArgs(inWorkspace(root, command));
  let startedAt = time.monotonic();
  let r = child_process.spawnSync(shellProgram(), args);
  let elapsedMs = time.monotonic() - startedAt;

  if (r.status < 0) {
    let failResult: RunResult = { ok: false, status: r.status, stdout: "", stderr: "", truncated: false, killed: false, error: "failed to spawn the command" };
    return failResult;
  }

  let cappedOut = capOutput(r.stdout);
  let cappedErr = capOutput(r.stderr);
  let overBudget = timeoutMs > 0 && elapsedMs > timeoutMs;

  let result: RunResult = {
    ok: true,
    status: r.status,
    stdout: cappedOut.text,
    stderr: cappedErr.text,
    truncated: cappedOut.truncated || cappedErr.truncated,
    killed: overBudget,
    error: overBudget ? "exceeded the " + `${timeoutMs}` + "ms budget (ran " + `${elapsedMs}` + "ms) - see the tools own docs, Lumen cannot interrupt a running child yet" : "",
  };
  return result;
}
