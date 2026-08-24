import { powershellQuoteSingle, shellQuoteSingle } from "./shell_quote.ts";
import { isWindows, shellArgs, shellProgram, tempDir } from "../vendor/platform/platform.ts";
import { appendMailbox } from "../tasks/mailbox.ts";
import { ForegroundResult, ForegroundRunner, waitForForegroundRun } from "./run_wait.ts";
import { ToolsRegistry } from "./registry.ts";

export const FG_EXIT_MARK: string = "__JOULE_FG_EXIT__";

let g_fg_command: string = "";
let g_fg_root: string = "";
let g_fg_mailbox: string = "";

export function configureForegroundRun(command: string, root: string, mailboxPath: string): void {
  g_fg_command = command;
  g_fg_root = root;
  g_fg_mailbox = mailboxPath;
}

// The interactive run tool streams, so it needs the same three things from a
// shell on either platform: start in the workspace, merge stderr into stdout
// so one stream carries both in order, and print the status behind a marker
// the reader can recognise.
//
// PowerShell's $LASTEXITCODE is the closest thing it has to $?, and it is not
// the same thing: it is set by native commands, so a cmdlet that fails leaves
// the previous value behind. Clearing it first at least makes the marker a
// number every time rather than sometimes empty (#173).
export function foregroundScript(root: string, command: string): string {
  if (isWindows()) {
    return "$LASTEXITCODE = 0; Set-Location -LiteralPath " + powershellQuoteSingle(root)
      + "; & { " + command + " } 2>&1; Write-Output \"" + FG_EXIT_MARK + "$LASTEXITCODE\"";
  }
  return "cd " + shellQuoteSingle(root) + " && { " + command + " ; } 2>&1; echo " + FG_EXIT_MARK + "$?";
}

export function foregroundRunLoop(): int {
  let args: string[] = shellArgs(foregroundScript(g_fg_root, g_fg_command));
  let cp = child_process.spawn(shellProgram(), args);
  let count: int = 0;
  while (true) {
    let line = cp.readLine();
    if (line == "") { break; }
    let trimmed = line.trim();
    if (trimmed.length >= FG_EXIT_MARK.length && trimmed.slice(0, FG_EXIT_MARK.length) == FG_EXIT_MARK) {
      appendMailbox(g_fg_mailbox, "EXIT", trimmed.slice(FG_EXIT_MARK.length, trimmed.length));
    } else {
      appendMailbox(g_fg_mailbox, "LINE", line);
      count = count + 1;
    }
  }
  cp.close();
  appendMailbox(g_fg_mailbox, "DONE", "lines=" + `${count}`);
  return count;
}

export function spawnForegroundRun(): Promise<int> {
  return Worker.run(() => { return foregroundRunLoop(); });
}

export function runForeground(root: string, command: string, timeoutMs: int, stdinFd: int): ForegroundResult {
  let mailboxPath = tempDir() + "/joule-fg-" + crypto.randomUUID() + ".log";
  fs.writeFileSync(mailboxPath, "");
  configureForegroundRun(command, root, mailboxPath);
  spawnForegroundRun();
  return waitForForegroundRun(mailboxPath, timeoutMs, stdinFd);
}

export function wireForegroundRunner(registry: ToolsRegistry): void {
  let runner: ForegroundRunner = { run: (root: string, command: string, timeoutMs: int, stdinFd: int) => runForeground(root, command, timeoutMs, stdinFd) };
  registry.setForegroundRunner(runner);
}
