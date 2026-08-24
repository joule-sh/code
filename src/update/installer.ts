import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { DEV_VERSION, isNewerVersion, stripLeadingV } from "./version_compare.ts";
import { releasePlatform, releaseAssetName, releaseDirName, releaseDownloadUrl, unsupportedPlatformError, isMacosPlatform, RELEASE_REPO } from "./platform.ts";
import { isRunnableBinaryForPlatform, readMagic4, fileSize } from "./archive.ts";
import { isUpdateTmpName, UPDATE_TMP_PREFIX } from "./install_detect.ts";

export const LATEST_RELEASE_URL: string = "https://api.github.com/repos/" + RELEASE_REPO + "/releases/latest";

export const RESULT_INSTALLED: string = "installed";
export const RESULT_UP_TO_DATE: string = "up_to_date";
export const RESULT_ERROR: string = "error";

export const COMPANION_BINARIES: string[] = ["relay", "joule-daemon"];

const SMOKE_SHELL: string = "/bin/sh";
const SMOKE_SCRIPT: string = "exec \"$0\" --version";
const REASON_MAX_CHARS: int = 160;
const LINK_STAGING_SUFFIX: string = ".update-staging";
export const CODESIGN: string = "/usr/bin/codesign";

export type InstallResult = { kind: string, fromVersion: string, toVersion: string, error: string };
export type FetchTagResult = { ok: bool, tag: string, error: string };
export type ShellResult = { status: int, stdout: string, stderr: string };
export type VerifyResult = { ok: bool, error: string };

function installedResult(from: string, to: string): InstallResult {
  let r: InstallResult = { kind: RESULT_INSTALLED, fromVersion: from, toVersion: to, error: "" };
  return r;
}

function upToDateResult(current: string): InstallResult {
  let r: InstallResult = { kind: RESULT_UP_TO_DATE, fromVersion: current, toVersion: current, error: "" };
  return r;
}

function errorResult(msg: string): InstallResult {
  let r: InstallResult = { kind: RESULT_ERROR, fromVersion: "", toVersion: "", error: msg };
  return r;
}

export function versionDirPath(installRoot: string, versionTag: string): string {
  return installRoot + "/" + versionTag;
}

export function tmpRootPath(installRoot: string, nonce: string): string {
  return installRoot + "/" + UPDATE_TMP_PREFIX + nonce;
}

export function binLinkPath(binDir: string, name: string): string {
  return binDir + "/" + name;
}

export function parseLatestTag(body: string): string {
  return jsonStringMemberAt(body, 0, "tag_name");
}

export function fetchLatestTag(url: string): FetchTagResult {
  let headers = new Map<string, string>();
  headers.set("Accept", "application/vnd.github+json");
  headers.set("User-Agent", "joule-code-update-install");
  let resp = http.request(url, "GET", "", headers);
  if (!resp.ok) {
    let r: FetchTagResult = { ok: false, tag: "", error: "GitHub returned status " + `${resp.status}` + " while checking the latest release" };
    return r;
  }
  let tag = parseLatestTag(resp.body);
  if (tag == "") {
    let r: FetchTagResult = { ok: false, tag: "", error: "could not read a release tag from GitHub's response" };
    return r;
  }
  let r: FetchTagResult = { ok: true, tag: tag, error: "" };
  return r;
}

function firstLine(s: string): string {
  let t = s.trim();
  let nl = t.indexOf("\n");
  if (nl >= 0) { t = t.slice(0, nl).trim(); }
  return t;
}

function withoutShellNoise(binPath: string, words: string): string {
  let marker = "exec: ";
  let at = words.lastIndexOf(marker);
  let t = at >= 0 ? words.slice(at + marker.length, words.length) : words;
  let prefix = binPath + ": ";
  if (t.startsWith(prefix)) { t = t.slice(prefix.length, t.length); }
  if (t.length > REASON_MAX_CHARS) { t = t.slice(0, REASON_MAX_CHARS) + "..."; }
  return t.trim();
}

export function refusalReason(binPath: string, status: int, stderr: string, stdout: string): string {
  let words = firstLine(stderr);
  if (words == "") { words = firstLine(stdout); }
  let tidy = withoutShellNoise(binPath, words);
  if (tidy == "") { return "exit " + `${status}`; }
  return "exit " + `${status}` + ": " + tidy;
}

export function wontRunError(name: string, binPath: string, r: ShellResult): string {
  return "the downloaded " + name + " would not run on this machine (" + refusalReason(binPath, r.status, r.stderr, r.stdout) + ") - nothing was relinked, so your existing install still works";
}

export function signingFailedError(name: string, binPath: string, r: ShellResult): string {
  return "the downloaded " + name + " carries no code signature this machine accepts, and signing it here failed (" + refusalReason(binPath, r.status, r.stderr, r.stdout) + ") - nothing was relinked, so your existing install still works";
}

export function ensureCodeSignature(binPath: string, name: string, releaseTarget: string, runCmd: (cmd: string, args: string[]) => ShellResult): VerifyResult {
  if (!isMacosPlatform(releaseTarget)) {
    let elsewhere: VerifyResult = { ok: true, error: "" };
    return elsewhere;
  }
  let checked = runCmd(CODESIGN, ["--verify", "--strict", binPath]);
  if (checked.status == 0) {
    let already: VerifyResult = { ok: true, error: "" };
    return already;
  }
  let signed = runCmd(CODESIGN, ["--sign", "-", "--force", binPath]);
  if (signed.status != 0) {
    let failed: VerifyResult = { ok: false, error: signingFailedError(name, binPath, signed) };
    return failed;
  }
  let ok: VerifyResult = { ok: true, error: "" };
  return ok;
}

export function smokeRunBinary(binPath: string, runCmd: (cmd: string, args: string[]) => ShellResult): ShellResult {
  return runCmd(SMOKE_SHELL, ["-c", SMOKE_SCRIPT, binPath]);
}

export function verifyDownloadedJoule(newJoule: string, releaseTarget: string, versionTag: string, runCmd: (cmd: string, args: string[]) => ShellResult): VerifyResult {
  if (!fs.existsSync(newJoule)) {
    let r: VerifyResult = { ok: false, error: "the archive did not contain a joule binary for " + releaseTarget };
    return r;
  }
  fs.chmodSync(newJoule, 0o755);
  let magic = readMagic4(newJoule);
  let size = fileSize(newJoule);
  if (!isRunnableBinaryForPlatform(releaseTarget, magic, size)) {
    let r: VerifyResult = { ok: false, error: "the downloaded joule binary does not look like a valid " + releaseTarget + " executable (refusing to install it)" };
    return r;
  }
  let signature = ensureCodeSignature(newJoule, "joule", releaseTarget, runCmd);
  if (!signature.ok) { return signature; }
  let smoke = smokeRunBinary(newJoule, runCmd);
  if (smoke.status != 0) {
    let r: VerifyResult = { ok: false, error: wontRunError("joule", newJoule, smoke) };
    return r;
  }
  let stdout = smoke.stdout.trim();
  let versionPart = stdout.startsWith("joule ") ? stdout.slice(6, stdout.length) : stdout;
  let reported = stripLeadingV(versionPart.trim());
  if (reported != versionTag) {
    let r: VerifyResult = { ok: false, error: "the downloaded binary reports version " + reported + ", expected " + versionTag + " - refusing to install a mismatched build" };
    return r;
  }
  let r: VerifyResult = { ok: true, error: "" };
  return r;
}

export function verifyDownloadedCompanion(path: string, name: string, releaseTarget: string, runCmd: (cmd: string, args: string[]) => ShellResult): VerifyResult {
  if (!fs.existsSync(path)) {
    let r: VerifyResult = { ok: false, error: "the archive did not contain a " + name + " binary for " + releaseTarget };
    return r;
  }
  fs.chmodSync(path, 0o755);
  let signature = ensureCodeSignature(path, name, releaseTarget, runCmd);
  if (!signature.ok) { return signature; }
  let smoke = smokeRunBinary(path, runCmd);
  if (smoke.status != 0) {
    let r: VerifyResult = { ok: false, error: wontRunError(name, path, smoke) };
    return r;
  }
  let r: VerifyResult = { ok: true, error: "" };
  return r;
}

export function verifyDownloadedRelease(innerDir: string, releaseTarget: string, versionTag: string, runCmd: (cmd: string, args: string[]) => ShellResult): VerifyResult {
  let joule = verifyDownloadedJoule(innerDir + "/joule", releaseTarget, versionTag, runCmd);
  if (!joule.ok) { return joule; }
  let i = 0;
  while (i < COMPANION_BINARIES.length) {
    let name = COMPANION_BINARIES[i];
    let checked = verifyDownloadedCompanion(innerDir + "/" + name, name, releaseTarget, runCmd);
    if (!checked.ok) { return checked; }
    i = i + 1;
  }
  let r: VerifyResult = { ok: true, error: "" };
  return r;
}

function cleanupStaleTmpDirs(installRoot: string): void {
  if (!fs.existsSync(installRoot)) { return; }
  let entries: string[] = [];
  try { entries = fs.readdirSync(installRoot); } catch { return; }
  let i = 0;
  while (i < entries.length) {
    if (isUpdateTmpName(entries[i])) {
      try { fs.rmSync(installRoot + "/" + entries[i], true); } catch {}
    }
    i = i + 1;
  }
}

function relinkBin(binDir: string, name: string, target: string): void {
  if (!fs.existsSync(binDir)) { fs.mkdirSync(binDir, true); }
  let linkPath = binLinkPath(binDir, name);
  let staged = linkPath + LINK_STAGING_SUFFIX;
  try { fs.rmSync(staged, false); } catch {}
  fs.symlinkSync(target, staged);
  fs.renameSync(staged, linkPath);
}

export function runInstallOnceWith(currentVersion: string, installRoot: string, binDir: string, nodePlatform: string, nodeArch: string, fetchTag: () => FetchTagResult, runCmd: (cmd: string, args: string[]) => ShellResult): InstallResult {
  if (currentVersion.trim() == DEV_VERSION) {
    return errorResult("this is a source build (version \"dev\"); joule can only update a release install");
  }

  let releaseTarget = releasePlatform(nodePlatform, nodeArch);
  if (releaseTarget == "") {
    return errorResult(unsupportedPlatformError(nodePlatform, nodeArch));
  }

  let fetched = fetchTag();
  if (!fetched.ok) {
    return errorResult(fetched.error);
  }

  if (!isNewerVersion(currentVersion, fetched.tag)) {
    return upToDateResult(currentVersion);
  }

  let versionTag = stripLeadingV(fetched.tag);
  cleanupStaleTmpDirs(installRoot);
  if (!fs.existsSync(installRoot)) { fs.mkdirSync(installRoot, true); }

  let tmpRoot = tmpRootPath(installRoot, `${Date.now()}`);
  fs.mkdirSync(tmpRoot, true);

  let archivePath = tmpRoot + "/" + releaseAssetName(releaseTarget);
  let url = releaseDownloadUrl(fetched.tag, releaseTarget);
  let dl = runCmd("curl", ["-fsSL", "--connect-timeout", "20", "--max-time", "300", url, "-o", archivePath]);
  if (dl.status != 0 || fileSize(archivePath) <= 0) {
    fs.rmSync(tmpRoot, true);
    return errorResult("download failed (curl exit " + `${dl.status}` + "): " + dl.stderr.trim());
  }

  let listing = runCmd("tar", ["-tzf", archivePath]);
  if (listing.status != 0) {
    fs.rmSync(tmpRoot, true);
    return errorResult("the downloaded archive is corrupt or incomplete and was discarded: " + listing.stderr.trim());
  }

  let extractDir = tmpRoot + "/extracted";
  fs.mkdirSync(extractDir, true);
  let extract = runCmd("tar", ["-xzf", archivePath, "-C", extractDir]);
  if (extract.status != 0) {
    fs.rmSync(tmpRoot, true);
    return errorResult("could not extract the downloaded archive: " + extract.stderr.trim());
  }

  let innerDir = extractDir + "/" + releaseDirName(releaseTarget);
  let verified = verifyDownloadedRelease(innerDir, releaseTarget, versionTag, runCmd);
  if (!verified.ok) {
    fs.rmSync(tmpRoot, true);
    return errorResult(verified.error);
  }

  let versionDir = versionDirPath(installRoot, versionTag);
  if (fs.existsSync(versionDir)) { fs.rmSync(versionDir, true); }
  fs.renameSync(innerDir, versionDir);

  relinkBin(binDir, "joule", versionDir + "/joule");
  relinkBin(binDir, "relay", versionDir + "/relay");

  fs.rmSync(tmpRoot, true);
  return installedResult(currentVersion, versionTag);
}

function realRun(cmd: string, args: string[]): ShellResult {
  let r = child_process.spawnSync(cmd, args);
  let out: ShellResult = { status: r.status, stdout: r.stdout, stderr: r.stderr };
  return out;
}

export function runInstallOnce(currentVersion: string, installRoot: string, binDir: string): InstallResult {
  return runInstallOnceWith(currentVersion, installRoot, binDir, process.platform(), process.arch(), () => fetchLatestTag(LATEST_RELEASE_URL), realRun);
}
