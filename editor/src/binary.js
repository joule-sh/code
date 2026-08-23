const { execFile } = require("node:child_process");

const MINIMUM_BINARY_VERSION = "0.13.0";
const INSTALL_URL = "https://github.com/joule-sh/code#install";
const WINDOWS_ISSUE_URL = "https://github.com/joule-sh/code/issues/173";
const VERSION_TIMEOUT_MS = 10000;

function parseVersionOutput(text) {
  const match = /(^|\n)\s*joule\s+(\S+)/.exec(String(text || ""));
  return match === null ? "" : match[2];
}

function releaseParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version || ""));
  if (match === null) { return null; }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareReleases(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) { return a[i] < b[i] ? -1 : 1; }
  }
  return 0;
}

function isBelowMinimum(version) {
  const parts = releaseParts(version);
  if (parts === null) { return false; }
  return compareReleases(parts, releaseParts(MINIMUM_BINARY_VERSION)) < 0;
}

function missingMessage(bin) {
  return "joule is not installed, or this window cannot see it on PATH. Looked for \"" + bin
    + "\". Install it with the one-liner at " + INSTALL_URL
    + ", or point the joule.path setting at the binary you already have.";
}

function windowsMessage() {
  return "There is no Windows joule binary yet (joule-sh/code#173), so this extension has nothing to drive here."
    + " Open the folder through WSL or Remote-SSH: the extension runs on the remote side and drives the joule there.";
}

function outdatedMessage(version) {
  return "joule " + version + " is older than the " + MINIMUM_BINARY_VERSION
    + " this extension needs, so the daemon it starts does not speak the frames this panel reads."
    + " Update it with the one-liner at " + INSTALL_URL + ".";
}

function unusableMessage(bin, detail) {
  return "\"" + bin + "\" did not answer --version, so it is not a joule this extension can drive: " + detail;
}

function unsupportedPlatform(platform) {
  const on = platform || process.platform;
  if (on === "win32") { return windowsMessage(); }
  return "";
}

function runVersion(bin, options) {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], {
      cwd: options.cwd,
      env: options.env || process.env,
      timeout: options.timeoutMs || VERSION_TIMEOUT_MS,
      maxBuffer: 256 * 1024,
    }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function checkBinary(options) {
  const opts = options || {};
  const bin = opts.jouleBin || "joule";
  const blocked = unsupportedPlatform(opts.platform);
  if (blocked !== "") {
    return { ok: false, problem: "platform", version: "", message: blocked, helpUrl: WINDOWS_ISSUE_URL, helpLabel: "Read #173" };
  }
  const run = await runVersion(bin, opts);
  const version = parseVersionOutput(run.stdout);
  if (run.err && (run.err.code === "ENOENT" || run.err.code === "EACCES")) {
    return { ok: false, problem: "missing", version: "", message: missingMessage(bin), helpUrl: INSTALL_URL, helpLabel: "How to install joule" };
  }
  if (version === "") {
    const detail = String(run.stderr || run.stdout).trim() || (run.err ? run.err.message : "no output");
    return { ok: false, problem: "unusable", version: "", message: unusableMessage(bin, detail), helpUrl: INSTALL_URL, helpLabel: "How to install joule" };
  }
  if (isBelowMinimum(version)) {
    return { ok: false, problem: "outdated", version, message: outdatedMessage(version), helpUrl: INSTALL_URL, helpLabel: "How to install joule" };
  }
  return { ok: true, problem: "", version, message: "", helpUrl: "", helpLabel: "" };
}

module.exports = {
  checkBinary,
  unsupportedPlatform,
  parseVersionOutput,
  releaseParts,
  compareReleases,
  isBelowMinimum,
  MINIMUM_BINARY_VERSION,
  INSTALL_URL,
  WINDOWS_ISSUE_URL,
};
