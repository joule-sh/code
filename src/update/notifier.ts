import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { MailboxReader } from "../tasks/mailbox.ts";
import { isNewerVersion, stripLeadingV, DEV_VERSION } from "./version_compare.ts";
import { UpdateCache, isCacheFresh, markChecked, CHECK_INTERVAL_MS } from "./cache.ts";
import { configureUpdateWorker, spawnUpdateCheck, TAG_OK, RELEASES_URL } from "./worker.ts";
import { INSTALL_METHOD_NPM, canSelfUpdate } from "./install_detect.ts";

export const SCRIPT_INSTALL_COMMAND: string = "curl -fsSL https://raw.githubusercontent.com/joule-sh/code/main/install.sh | sh";
export const NPM_INSTALL_COMMAND: string = "npm install -g @joule-sh/code@latest";

export function updateCommandFor(method: string): string {
  if (method == INSTALL_METHOD_NPM) { return NPM_INSTALL_COMMAND; }
  return SCRIPT_INSTALL_COMMAND;
}

export function noticeText(current: string, latest: string, method: string): string {
  return "joule: a newer release is available (" + stripLeadingV(latest) + ", you have " + current + ") - update with: " + updateCommandFor(method);
}

export function shouldCheck(currentVersion: string, disabled: bool, method: string, cache: UpdateCache, nowMs: i64): bool {
  if (currentVersion.trim() == DEV_VERSION) { return false; }
  if (disabled) { return false; }
  if (!canSelfUpdate(method)) { return false; }
  if (isCacheFresh(cache, nowMs, CHECK_INTERVAL_MS)) { return false; }
  return true;
}

export class UpdateNotifier {
  mailboxPath: string;
  reader: MailboxReader;
  active: bool;
  currentVersion: string;
  latestVersion: string;
  method: string;

  constructor() {
    this.mailboxPath = "";
    this.reader = new MailboxReader("");
    this.active = false;
    this.currentVersion = "";
    this.latestVersion = "";
    this.method = "";
  }

  start(nonce: string, currentVersion: string, method: string, cachePath: string): void {
    this.mailboxPath = "/tmp/joule-update-" + nonce + ".log";
    fs.writeFileSync(this.mailboxPath, "");
    this.reader = new MailboxReader(this.mailboxPath);
    this.currentVersion = currentVersion;
    this.method = method;
    this.active = true;
    configureUpdateWorker(RELEASES_URL, this.mailboxPath);
    spawnUpdateCheck();
    markChecked(cachePath, Date.now(), "");
  }

  poll(): string {
    if (!this.active) { return ""; }
    let entries = this.reader.drainNew();
    if (entries.length == 0) { return ""; }
    this.active = false;
    for (const e of entries) {
      if (e.tag == TAG_OK) {
        return this.handleBody(e.payload);
      }
    }
    return "";
  }

  handleBody(body: string): string {
    let tag = jsonStringMemberAt(body, 0, "tag_name");
    if (tag == "") { return ""; }
    if (!isNewerVersion(this.currentVersion, tag)) { return ""; }
    this.latestVersion = stripLeadingV(tag);
    return noticeText(this.currentVersion, tag, this.method);
  }
}
