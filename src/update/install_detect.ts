import { envOr, isWindows, pathListSeparator } from "../vendor/platform/platform.ts";

export const INSTALL_ROOT_ENV: string = "CODE_INSTALL_ROOT";
export const BIN_DIR_ENV: string = "CODE_BIN_DIR";
export const DEFAULT_INSTALL_ROOT: string = ".joule-code";
export const DEFAULT_BIN_DIR: string = ".local/bin";
export const SELF_EXE_LINK: string = "/proc/self/exe";
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

// A Windows argv[0] arrives as D:\dir\joule.exe: backslashes, a drive letter
// where a leading slash would be, and a PATH split on semicolons. Reading it
// with the POSIX rules did not merely fail to find the binary - it built names
// like "C/joule.exe" out of the halves of "C:\...", and fs.existsSync on one
// of those raised OBJECT_NAME_INVALID rather than answering false, which is
// what took the whole process down before the first frame was drawn.
export function hasPathSeparator(argv0: string): bool {
  return argv0.indexOf("/") >= 0 || argv0.indexOf("\\") >= 0;
}

export function isAbsolutePath(candidate: string): bool {
  if (candidate.startsWith("/")) { return true; }
  if (candidate.startsWith("\\")) { return true; }
  if (candidate.length >= 3 && candidate.charAt(1) == ":") {
    let third = candidate.charAt(2);
    return third == "\\" || third == "/";
  }
  return false;
}

export function resolveArgv0Path(argv0: string, pathEnv: string, cwd: string, exists: (path: string) => bool): string {
  if (argv0.trim() == "") { return ""; }

  if (hasPathSeparator(argv0)) {
    let candidate = isAbsolutePath(argv0) ? argv0 : joinRelative(cwd, argv0);
    if (exists(candidate)) { return candidate; }
    return "";
  }

  let dirs = pathEnv.split(pathListSeparator());
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

// Answers false for a name the platform will not even parse, rather than
// letting the syscall's error escape as a crash.
function existsOnDisk(path: string): bool {
  try {
    return fs.existsSync(path);
  } catch {
    return false;
  }
}

function detectViaProcSelfExe(): string {
  if (isWindows()) { return ""; }
  if (!existsOnDisk(SELF_EXE_LINK)) { return ""; }
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
  try {
    let real = fs.realpathSync(resolved);
    if (real == "") { return resolved; }
    return real;
  } catch {
    return resolved;
  }
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

export function isUpdateTmpName(name: string): bool {
  return name.startsWith(UPDATE_TMP_PREFIX);
}

export const INSTALL_METHOD_SCRIPT: string = "script";
export const INSTALL_METHOD_NPM: string = "npm";
export const INSTALL_METHOD_UNKNOWN: string = "unknown";

export const NODE_MODULES_DIR: string = "node_modules";
export const NPM_SCOPE_DIR: string = "@joule-sh";
export const NPM_PACKAGE_STEM: string = "code";

export function pathSegments(candidate: string): string[] {
  let out: string[] = [];
  let current = "";
  let i = 0;
  while (i < candidate.length) {
    let c = candidate.charAt(i);
    if (c == "/" || c == "\\") {
      if (current != "") { out.push(current); }
      current = "";
    } else {
      current = current + c;
    }
    i = i + 1;
  }
  if (current != "") { out.push(current); }
  return out;
}

export function isNpmPackageDirName(name: string): bool {
  return name == NPM_PACKAGE_STEM || name.startsWith(NPM_PACKAGE_STEM + "-");
}

export function isUnderNpmPackage(exeRealPath: string): bool {
  if (exeRealPath == "") { return false; }
  let segs = pathSegments(exeRealPath);
  let i = 0;
  while (i + 2 < segs.length) {
    if (segs[i] == NODE_MODULES_DIR && segs[i + 1] == NPM_SCOPE_DIR && isNpmPackageDirName(segs[i + 2])) {
      return true;
    }
    i = i + 1;
  }
  return false;
}

export function detectInstallMethod(exeRealPath: string, installRoot: string): string {
  if (isUnderInstallRoot(exeRealPath, installRoot)) { return INSTALL_METHOD_SCRIPT; }
  if (isUnderNpmPackage(exeRealPath)) { return INSTALL_METHOD_NPM; }
  return INSTALL_METHOD_UNKNOWN;
}

export function canSelfUpdate(method: string): bool {
  return method == INSTALL_METHOD_SCRIPT || method == INSTALL_METHOD_NPM;
}
