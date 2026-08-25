import { Scrollback } from "./scrollback.ts";
import { PendingUpdateOffer, UPDATE_OFFER_OPTION_COUNT, UPDATE_OFFER_ACCEPT, UPDATE_OFFER_ACCEPT_AND_STOP_CHECKING, updateOfferOptionForChar } from "./input_state.ts";
import { updateOfferOptionRow } from "./renderer.ts";
import { MailboxReader } from "../tasks/mailbox.ts";
import { DEV_VERSION } from "../update/version_compare.ts";
import { resolveInstallRoot, resolveBinDir, detectRunningExePath, isManagedInstall, INSTALL_ROOT_ENV, BIN_DIR_ENV } from "../update/install_detect.ts";
import { configureInstallWorker, spawnInstallWorker, TAG_INSTALLED, TAG_UP_TO_DATE, TAG_ERR } from "../update/install_worker.ts";
import { loadConfigFile, saveConfigFile, configFilePath, ConfigFile } from "../providers/config.ts";
import { envOr, homeDir } from "../vendor/platform/platform.ts";

export class PendingUpdateInstall {
  running: bool;
  mailboxPath: string;
  reader: MailboxReader;

  constructor() {
    this.running = false;
    this.mailboxPath = "";
    this.reader = new MailboxReader("");
  }

  start(nonce: string, currentVersion: string, installRoot: string, binDir: string): void {
    this.mailboxPath = "/tmp/joule-update-install-" + nonce + ".log";
    fs.writeFileSync(this.mailboxPath, "");
    this.reader = new MailboxReader(this.mailboxPath);
    this.running = true;
    configureInstallWorker(currentVersion, installRoot, binDir, this.mailboxPath);
    spawnInstallWorker();
  }

  poll(): string {
    if (!this.running) { return ""; }
    let entries = this.reader.drainNew();
    if (entries.length == 0) { return ""; }
    this.running = false;
    for (const e of entries) {
      if (e.tag == TAG_INSTALLED) { return installedMessage(e.payload); }
      if (e.tag == TAG_UP_TO_DATE) { return "joule: already on the latest release (" + e.payload + ")"; }
      if (e.tag == TAG_ERR) { return "joule: update failed - " + e.payload; }
    }
    return "";
  }
}

export function installedMessage(payload: string): string {
  let bar = payload.indexOf("|");
  if (bar < 0) { return "joule: update installed"; }
  let from = payload.slice(0, bar);
  let to = payload.slice(bar + 1, payload.length);
  return "joule: updated from " + from + " to " + to + " - restart joule to use it";
}

function disableUpdateChecks(): void {
  let file = loadConfigFile(configFilePath());
  let updated: ConfigFile = { baseUrl: file.baseUrl, model: file.model, apiKey: file.apiKey, server: file.server, updateCheck: "off", mouse: file.mouse };
  saveConfigFile(configFilePath(), updated);
}

export function updateInstallDecision(running: bool, currentVersion: string, exePath: string, installRoot: string): string {
  if (running) { return "joule: an update is already in progress"; }
  if (currentVersion.trim() == DEV_VERSION) { return "joule: this is a source build (version \"dev\") and cannot self-update"; }
  if (!isManagedInstall(exePath, installRoot)) { return "joule: this binary wasn't installed by install.sh, so /update can't safely replace it - reinstall with install.sh to enable self-update"; }
  return "";
}

export function beginUpdateInstall(install: PendingUpdateInstall, currentVersion: string, sb: Scrollback): void {
  let home = homeDir();
  let installRoot = resolveInstallRoot(envOr(INSTALL_ROOT_ENV, ""), home);
  let binDir = resolveBinDir(envOr(BIN_DIR_ENV, ""), home);
  let exePath = detectRunningExePath();
  let decline = updateInstallDecision(install.running, currentVersion, exePath, installRoot);
  if (decline != "") {
    sb.append("\n" + decline);
    return;
  }
  sb.append("\njoule: checking for updates...");
  install.start(`${Date.now()}`, currentVersion, installRoot, binDir);
}

export function repaintUpdateOfferOptions(sb: Scrollback, offer: PendingUpdateOffer): void {
  if (!offer.hasOptionRows()) { return; }
  let i = 0;
  while (i < UPDATE_OFFER_OPTION_COUNT) {
    sb.setLine(offer.firstOptionRow + i, updateOfferOptionRow(i, offer.selected));
    i = i + 1;
  }
}

function answerUpdateOffer(offer: PendingUpdateOffer, install: PendingUpdateInstall, currentVersion: string, sb: Scrollback, index: int): void {
  offer.select(index);
  repaintUpdateOfferOptions(sb, offer);
  offer.close();
  if (index == UPDATE_OFFER_ACCEPT_AND_STOP_CHECKING) {
    disableUpdateChecks();
    beginUpdateInstall(install, currentVersion, sb);
    return;
  }
  if (index == UPDATE_OFFER_ACCEPT) {
    beginUpdateInstall(install, currentVersion, sb);
  }
}

export function tryHandleUpdateOfferArrow(offer: PendingUpdateOffer, sb: Scrollback, inputEmpty: bool, delta: int): bool {
  if (!offer.isPending() || !inputEmpty) { return false; }
  if (offer.moveSelection(delta)) {
    repaintUpdateOfferOptions(sb, offer);
  }
  return true;
}

export function tryHandleUpdateOfferEnter(offer: PendingUpdateOffer, install: PendingUpdateInstall, currentVersion: string, sb: Scrollback, inputEmpty: bool): bool {
  if (!offer.isPending() || !inputEmpty) { return false; }
  answerUpdateOffer(offer, install, currentVersion, sb, offer.selected);
  return true;
}

export function tryHandleUpdateOfferChar(offer: PendingUpdateOffer, install: PendingUpdateInstall, currentVersion: string, sb: Scrollback, inputEmpty: bool, ch: string): bool {
  if (!offer.isPending() || !inputEmpty) { return false; }
  let index = updateOfferOptionForChar(ch);
  if (index < 0) { return false; }
  answerUpdateOffer(offer, install, currentVersion, sb, index);
  return true;
}
