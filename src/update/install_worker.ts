import { appendMailbox } from "../tasks/mailbox.ts";
import { runInstallOnce, RESULT_INSTALLED, RESULT_UP_TO_DATE } from "./installer.ts";

export const TAG_INSTALLED: string = "INSTALLED";
export const TAG_UP_TO_DATE: string = "UP_TO_DATE";
export const TAG_ERR: string = "ERR";

let g_current_version: string = "";
let g_install_root: string = "";
let g_bin_dir: string = "";
let g_mailbox: string = "";

export function configureInstallWorker(currentVersion: string, installRoot: string, binDir: string, mailboxPath: string): void {
  g_current_version = currentVersion;
  g_install_root = installRoot;
  g_bin_dir = binDir;
  g_mailbox = mailboxPath;
}

export function installWorkerLoop(): int {
  let result = runInstallOnce(g_current_version, g_install_root, g_bin_dir);
  if (result.kind == RESULT_INSTALLED) {
    appendMailbox(g_mailbox, TAG_INSTALLED, result.fromVersion + "|" + result.toVersion);
    return 0;
  }
  if (result.kind == RESULT_UP_TO_DATE) {
    appendMailbox(g_mailbox, TAG_UP_TO_DATE, result.fromVersion);
    return 0;
  }
  appendMailbox(g_mailbox, TAG_ERR, result.error);
  return 1;
}

export function spawnInstallWorker(): Promise<int> {
  return Worker.run(() => { return installWorkerLoop(); });
}
