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

export function run(root: string, command: string, timeoutMs: int): RunResult {
  let original = process.cwd();
  process.chdir(root);

  let args: string[] = ["-c", command];
  let startedAt = time.monotonic();
  let r = child_process.spawnSync("/bin/sh", args);
  let elapsedMs = time.monotonic() - startedAt;

  process.chdir(original);

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
