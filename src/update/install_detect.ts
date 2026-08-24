import { envOr } from "../vendor/platform/platform.ts";
export const INSTALL_ROOT_ENV: string = "CODE_INSTALL_ROOT";
export const BIN_DIR_ENV: string = "CODE_BIN_DIR";
export const DEFAULT_INSTALL_ROOT: string = ".joule-code";
export const DEFAULT_BIN_DIR: string = ".local/bin";
export const SELF_EXE_LINK: string = "/proc/self/exe";
export const PATH_ENV_SEP: string = ":";
export const UPDATE_TMP_PREFIX: string = ".update-tmp-";

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

function joinRelative(base: string, rel: string): string {
  if (base.endsWith("/")) { return base + rel; }
  return base + "/" + rel;
}

export function resolveArgv0Path(argv0: string, pathEnv: string, cwd: string, exists: (path: string) => bool): string {
  if (argv0.trim() == "") { return ""; }

  if (argv0.indexOf("/") >= 0) {
    let candidate = argv0.startsWith("/") ? argv0 : joinRelative(cwd, argv0);
    if (exists(candidate)) { return candidate; }
    return "";
  }

  let dirs = pathEnv.split(PATH_ENV_SEP);
  let i = 0;
  while (i < dirs.length) {
    if (dirs[i].trim() != "") {
      let candidate = joinRelative(dirs[i], argv0);
      if (exists(candidate)) { return candidate; }
    }
    i = i + 1;
  }
  return "";
}

function existsOnDisk(path: string): bool {
  return fs.existsSync(path);
}

function detectViaProcSelfExe(): string {
  if (!fs.existsSync(SELF_EXE_LINK)) { return ""; }
  let real = fs.realpathSync(SELF_EXE_LINK);
  if (real == "" || real == SELF_EXE_LINK) { return ""; }
  return real;
}

function detectViaArgv0(): string {
  let argv = process.argv();
  if (argv.length == 0) { return ""; }
  let pathEnv = envOr("PATH", "");
  let cwd = process.cwd();
  let resolved = resolveArgv0Path(argv[0], pathEnv, cwd, existsOnDisk);
  if (resolved == "") { return ""; }
  let real = fs.realpathSync(resolved);
  if (real == "") { return ""; }
  return real;
}

export function detectRunningExePath(): string {
  let viaProc = detectViaProcSelfExe();
  if (viaProc != "") { return viaProc; }
  return detectViaArgv0();
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

export function isUpdateTmpName(name: string): bool {
  return name.startsWith(UPDATE_TMP_PREFIX);
}
