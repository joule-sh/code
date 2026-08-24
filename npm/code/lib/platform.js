"use strict";

const REPO = "https://github.com/joule-sh/code";
const SCOPE = "@joule-sh";
const WRAPPER = SCOPE + "/code";
const WINDOWS_ISSUE = REPO + "/issues/173";
const NPM_BUG = "https://github.com/npm/cli/issues/4828";
const OVERRIDE = "JOULE_BINARY_PATH";

const BUILT = {
  "linux-x64": SCOPE + "/code-linux-x64",
  "darwin-x64": SCOPE + "/code-darwin-x64",
  "darwin-arm64": SCOPE + "/code-darwin-arm64",
};

const BINARIES = ["joule", "relay", "joule-daemon"];
const COMMANDS = ["joule", "relay"];

function current() {
  return process.platform + "-" + process.arch;
}

function packageFor(id) {
  return BUILT[id] || "";
}

function supported() {
  return Object.keys(BUILT);
}

function isWindows(id) {
  return id.startsWith("win32-");
}

function windowsNotice() {
  return [
    "joule: there is no Windows build of joule yet, so there is no binary for this package to install here.",
    "       " + WINDOWS_ISSUE + " is the ticket for the Windows binary; watch that rather than this package.",
    "       Until it lands, joule runs on Windows through WSL: open a WSL shell and install it from inside there.",
  ].join("\n");
}

function unsupportedNotice(id) {
  return [
    "joule: no binary is built for " + id + ".",
    "       built platforms: " + supported().join(", ") + ".",
    "       build from source instead: " + REPO + "#build-from-source",
  ].join("\n");
}

function missingNotice(id, version) {
  const pkg = packageFor(id);
  const pinned = version === "" ? pkg : pkg + "@" + version;
  return [
    "joule: " + WRAPPER + " is installed but the binary for " + id + " is not.",
    "       " + pkg + " should have been installed alongside it as an optional dependency.",
    "       npm has a long-standing bug where it skips one (" + NPM_BUG + ").",
    "       Any one of these fixes it:",
    "         npm install " + pinned,
    "         remove node_modules and the lockfile, then install again",
    "         " + OVERRIDE + "=/path/to/the/binaries " + COMMANDS[0],
  ].join("\n");
}

function notice(id, version) {
  if (isWindows(id)) { return windowsNotice(); }
  if (packageFor(id) === "") { return unsupportedNotice(id); }
  return missingNotice(id, version);
}

module.exports = {
  REPO,
  SCOPE,
  WRAPPER,
  WINDOWS_ISSUE,
  OVERRIDE,
  BINARIES,
  COMMANDS,
  current,
  packageFor,
  supported,
  isWindows,
  windowsNotice,
  unsupportedNotice,
  missingNotice,
  notice,
};
