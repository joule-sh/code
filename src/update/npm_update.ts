import { DEV_VERSION, isNewerVersion, stripLeadingV } from "./version_compare.ts";
import { InstallResult, ShellResult, installedResult, upToDateResult, errorResult } from "./installer.ts";

export const NPM_PROGRAM: string = "npm";
export const NPM_PACKAGE: string = "@joule-sh/code";
export const NPM_MANUAL_COMMAND: string = "npm install -g @joule-sh/code@latest";

export function npmViewArgs(): string[] {
  return ["view", NPM_PACKAGE, "version"];
}

export function npmInstallArgs(version: string): string[] {
  return ["install", "--global", NPM_PACKAGE + "@" + version, "--no-audit", "--no-fund"];
}

export function npmCommandText(args: string[]): string {
  let out = NPM_PROGRAM;
  let i = 0;
  while (i < args.length) {
    out = out + " " + args[i];
    i = i + 1;
  }
  return out;
}

export function npmErrorCode(stderr: string): string {
  let lines = stderr.split("\n");
  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trim();
    if (line.startsWith("npm error code ")) { return line.slice(15, line.length).trim(); }
    if (line.startsWith("npm ERR! code ")) { return line.slice(14, line.length).trim(); }
    i = i + 1;
  }
  return "";
}

export function isPermissionCode(code: string): bool {
  return code == "EACCES" || code == "EPERM" || code == "EROFS";
}

export function isNetworkCode(code: string): bool {
  if (code == "ENOTFOUND" || code == "ECONNREFUSED" || code == "ECONNRESET") { return true; }
  if (code == "ETIMEDOUT" || code == "ENETUNREACH" || code == "EAI_AGAIN") { return true; }
  return code == "ERR_SOCKET_TIMEOUT" || code == "FETCH_ERROR";
}

export function firstNpmErrorLine(stderr: string): string {
  let lines = stderr.split("\n");
  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trim();
    let warned = line.startsWith("npm warn") || line.startsWith("npm WARN");
    if (line != "" && !warned) { return line; }
    i = i + 1;
  }
  return "";
}

export function npmMissingText(): string {
  return "npm is not on PATH, so joule cannot update the npm install it is running from - put npm on PATH, or run \"" + NPM_MANUAL_COMMAND + "\" yourself";
}

export function permissionFailureText(action: string, code: string, ran: string): string {
  return "npm could not " + action + ": its global prefix needs rights this user does not have (" + code + "). Run \"" + ran + "\" yourself with those rights, or move npm somewhere you own with \"npm config set prefix ~/.npm-global\" and put its bin directory on PATH";
}

export function networkFailureText(action: string, code: string): string {
  return "npm could not " + action + ": it could not reach the npm registry (" + code + "). Check the network, or a proxy or registry setting, and try again";
}

export function npmFailureText(action: string, args: string[], status: int, stderr: string): string {
  let code = npmErrorCode(stderr);
  let ran = npmCommandText(args);
  if (isPermissionCode(code)) { return permissionFailureText(action, code, ran); }
  if (isNetworkCode(code)) { return networkFailureText(action, code); }
  let detail = firstNpmErrorLine(stderr);
  let tail = detail == "" ? "" : " - " + detail;
  return "npm could not " + action + " (\"" + ran + "\" exited " + `${status}` + ")" + tail;
}

export function reportedVersion(stdout: string): string {
  let text = stdout.trim();
  let cut = text.startsWith("joule ") ? text.slice(6, text.length) : text;
  return stripLeadingV(cut.trim());
}

export function notInPlaceText(exePath: string, reported: string, expected: string): string {
  return "npm reported success but " + exePath + " still reports version " + reported + ", not " + expected + " - the new package did not land where the running joule came from";
}

export function wontRunText(exePath: string, status: int, stderr: string): string {
  return "npm reported success but the binary at " + exePath + " will not run (--version exited " + `${status}` + "): " + stderr.trim();
}

export function runNpmUpdateWith(currentVersion: string, exePath: string, runCmd: (cmd: string, args: string[]) => ShellResult): InstallResult {
  if (currentVersion.trim() == DEV_VERSION) {
    return errorResult("this is a source build (version \"dev\"); joule can only update a release install");
  }

  let probe = runCmd(NPM_PROGRAM, ["--version"]);
  if (probe.status != 0) {
    return errorResult(npmMissingText());
  }

  let viewArgs = npmViewArgs();
  let view = runCmd(NPM_PROGRAM, viewArgs);
  if (view.status != 0) {
    return errorResult(npmFailureText("check the latest published version", viewArgs, view.status, view.stderr));
  }

  let latest = stripLeadingV(view.stdout.trim());
  if (latest == "") {
    return errorResult("npm answered without a version for " + NPM_PACKAGE + ", so joule does not know what to install");
  }

  if (!isNewerVersion(currentVersion, latest)) {
    return upToDateResult(currentVersion);
  }

  let installArgs = npmInstallArgs(latest);
  let installed = runCmd(NPM_PROGRAM, installArgs);
  if (installed.status != 0) {
    return errorResult(npmFailureText("install " + NPM_PACKAGE + "@" + latest, installArgs, installed.status, installed.stderr));
  }

  if (exePath == "") {
    return installedResult(currentVersion, latest);
  }

  let smoke = runCmd(exePath, ["--version"]);
  if (smoke.status != 0) {
    return errorResult(wontRunText(exePath, smoke.status, smoke.stderr));
  }

  let reported = reportedVersion(smoke.stdout);
  if (reported != latest) {
    return errorResult(notInPlaceText(exePath, reported, latest));
  }

  return installedResult(currentVersion, latest);
}

function realRun(cmd: string, args: string[]): ShellResult {
  let r = child_process.spawnSync(cmd, args);
  let out: ShellResult = { status: r.status, stdout: r.stdout, stderr: r.stderr };
  return out;
}

export function runNpmUpdate(currentVersion: string, exePath: string): InstallResult {
  return runNpmUpdateWith(currentVersion, exePath, realRun);
}
