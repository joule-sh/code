import { shellQuoteSingle } from "../tools/shell_quote.ts";
import { appendMailbox } from "./mailbox.ts";

export const EXIT_MARK: string = "__JOULE_BG_EXIT__";

let g_run_command: string = "";
let g_run_root: string = "";
let g_run_mailbox: string = "";

export function configureBackgroundRun(command: string, root: string, mailboxPath: string): void {
  g_run_command = command;
  g_run_root = root;
  g_run_mailbox = mailboxPath;
}

export function backgroundRunLoop(): int {
  let inRoot = "cd " + shellQuoteSingle(g_run_root) + " && " + g_run_command + "; echo " + EXIT_MARK + "$?";
  let args: string[] = ["-c", inRoot];
  let cp = child_process.spawn("/bin/sh", args);
  let count: int = 0;
  while (true) {
    let line = cp.readLine();
    if (line == "") { break; }
    let trimmed = line.trim();
    if (trimmed.length >= EXIT_MARK.length && trimmed.slice(0, EXIT_MARK.length) == EXIT_MARK) {
      appendMailbox(g_run_mailbox, "EXIT", trimmed.slice(EXIT_MARK.length, trimmed.length));
    } else {
      appendMailbox(g_run_mailbox, "LINE", line);
      count = count + 1;
    }
  }
  cp.close();
  appendMailbox(g_run_mailbox, "DONE", "lines=" + `${count}`);
  return count;
}

export function spawnBackgroundRun(): Promise<int> {
  return Worker.run(() => { return backgroundRunLoop(); });
}
