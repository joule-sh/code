export const INSTALL_ROOT_ENV: string = "CODE_INSTALL_ROOT";
export const BIN_DIR_ENV: string = "CODE_BIN_DIR";
export const DEFAULT_INSTALL_ROOT: string = ".joule-code";
export const DEFAULT_BIN_DIR: string = ".local/bin";
export const SELF_EXE_LINK: string = "/proc/self/exe";

export function defaultInstallRoot(home: string): string {
  return home + "/" + DEFAULT_INSTALL_ROOT;
}

export function defaultBinDir(home: string): string {
  return home + "/" + DEFAULT_BIN_DIR;
}

export function resolveInstallRoot(envValue: string, home: string): string {
  if (envValue.trim() != "") { return envValue; }
  return defaultInstallRoot(home);
}

export function resolveBinDir(envValue: string, home: string): string {
  if (envValue.trim() != "") { return envValue; }
  return defaultBinDir(home);
}

export function detectRunningExePath(): string {
  if (!fs.existsSync(SELF_EXE_LINK)) { return ""; }
  let real = fs.realpathSync(SELF_EXE_LINK);
  if (real == "" || real == SELF_EXE_LINK) { return ""; }
  return real;
}

export function isUnderInstallRoot(exeRealPath: string, installRoot: string): bool {
  if (exeRealPath == "") { return false; }
  if (!fs.existsSync(installRoot)) { return false; }
  let rootReal = fs.realpathSync(installRoot);
  if (rootReal == "") { return false; }
  let prefix = rootReal.endsWith("/") ? rootReal : rootReal + "/";
  if (exeRealPath.length <= prefix.length) { return false; }
  return exeRealPath.slice(0, prefix.length) == prefix;
}

export function isManagedInstall(exeRealPath: string, installRoot: string): bool {
  return isUnderInstallRoot(exeRealPath, installRoot);
}
