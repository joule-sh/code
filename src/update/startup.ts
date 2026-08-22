import { VERSION } from "../version.ts";
import { loadConfigFile, configFilePath } from "../providers/config.ts";
import { updateCheckDisabled, UPDATE_CHECK_ENV } from "./settings.ts";
import { resolveInstallRoot, detectRunningExePath, isManagedInstall, INSTALL_ROOT_ENV } from "./install_detect.ts";
import { loadUpdateCache, updateCachePath } from "./cache.ts";
import { shouldCheck, UpdateNotifier } from "./notifier.ts";

export function maybeStartUpdateCheck(nonce: string): UpdateNotifier {
  let notifier = new UpdateNotifier();
  let home = process.env("HOME") ?? "";
  let envDisable = process.env(UPDATE_CHECK_ENV) ?? "";
  let file = loadConfigFile(configFilePath());
  let disabled = updateCheckDisabled(envDisable, file.updateCheck);
  let installRoot = resolveInstallRoot(process.env(INSTALL_ROOT_ENV) ?? "", home);
  let exePath = detectRunningExePath();
  let managed = isManagedInstall(exePath, installRoot);
  let cachePath = updateCachePath();
  let cache = loadUpdateCache(cachePath);
  if (shouldCheck(VERSION, disabled, managed, cache, Date.now())) {
    notifier.start(nonce, VERSION, cachePath);
  }
  return notifier;
}
