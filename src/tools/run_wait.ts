import { MailboxReader } from "../tasks/mailbox.ts";
import { readKeyTimeout, KEY_CTRL_C } from "../vendor/tty/tty.ts";

const POLL_MS: int = 50;
const MAX_OUTPUT_BYTES: int = 100000;

export type ForegroundResult = {
  ok: bool,
  status: int,
  output: string,
  truncated: bool,
  abandoned: bool,
  reason: string,
  mailboxPath: string,
  elapsedMs: i64,
};

export type ForegroundRunner = { run: (root: string, command: string, timeoutMs: int, stdinFd: int) => ForegroundResult };

type FgCapResult = { text: string, truncated: bool };

function capText(s: string): FgCapResult {
  if (s.length <= MAX_OUTPUT_BYTES) {
    let r: FgCapResult = { text: s, truncated: false };
    return r;
  }
  let r: FgCapResult = { text: s.slice(0, MAX_OUTPUT_BYTES), truncated: true };
  return r;
}

export function waitForForegroundRun(mailboxPath: string, timeoutMs: int, stdinFd: int): ForegroundResult {
  let reader = new MailboxReader(mailboxPath);
  let output = "";
  let status: int = -1;
  let startedAt = time.monotonic();
  let done = false;
  let abandoned = false;
  let reason = "";

  while (!done) {
    let entries = reader.drainNew();
    for (const e of entries) {
      if (e.tag == "LINE") {
        output = output + e.payload + "\n";
      } else if (e.tag == "EXIT") {
        status = Number.parseInt(e.payload, 10) ?? -1;
      } else if (e.tag == "DONE") {
        done = true;
      }
    }
    if (done) {
      continue;
    }

    let elapsed = time.monotonic() - startedAt;
    if (timeoutMs > 0 && elapsed >= timeoutMs) {
      abandoned = true;
      reason = "timeout";
      done = true;
      continue;
    }
    if (readKeyTimeout(stdinFd, 0).kind == KEY_CTRL_C) {
      abandoned = true;
      reason = "ctrl-c";
      done = true;
      continue;
    }

    process.sleep(POLL_MS);
  }

  let elapsedMs = time.monotonic() - startedAt;
  let capped = capText(output);
  let result: ForegroundResult = {
    ok: !abandoned,
    status: status,
    output: capped.text,
    truncated: capped.truncated,
    abandoned: abandoned,
    reason: reason,
    mailboxPath: mailboxPath,
    elapsedMs: elapsedMs,
  };
  return result;
}

export function formatForegroundResult(r: ForegroundResult, timeoutMs: int): string {
  if (r.abandoned && r.reason == "ctrl-c") {
    return "abandoned (ctrl-c after " + `${r.elapsedMs}` + "ms) - control is back with you now; the command may still be running in the background and cannot be forcibly stopped (lumen-lang-org/lumen#6).\npartial output before abandoning:\n" + r.output;
  }
  if (r.abandoned && r.reason == "timeout") {
    return "abandoned (exceeded the " + `${timeoutMs}` + "ms budget after " + `${r.elapsedMs}` + "ms) - the wait was stopped, not the command; it may still be running in the background and cannot be forcibly stopped (lumen-lang-org/lumen#6).\npartial output before abandoning:\n" + r.output;
  }
  return "exit " + `${r.status}` + "\n" + r.output;
}
