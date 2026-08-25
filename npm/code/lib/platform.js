"use strict";

const REPO = "https://github.com/joule-sh/code";
const SCOPE = "@joule-sh";
const WRAPPER = SCOPE + "/code";
const NPM_BUG = "https://github.com/npm/cli/issues/4828";
const OVERRIDE = "JOULE_BINARY_PATH";

const BUILT = {
  "linux-x64": SCOPE + "/code-linux-x64",
  "darwin-x64": SCOPE + "/code-darwin-x64",
  "darwin-arm64": SCOPE + "/code-darwin-arm64",
  "win32-x64": SCOPE + "/code-win32-x64",
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

function exeSuffix(id) {
  return isWindows(id) ? ".exe" : "";
}

function binaryFile(name, id) {
  return name + exeSuffix(id);
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
  if (packageFor(id) === "") { return unsupportedNotice(id); }
  return missingNotice(id, version);
}

module.exports = {
  REPO,
  SCOPE,
  WRAPPER,
  OVERRIDE,
  BINARIES,
  COMMANDS,
  current,
  packageFor,
  supported,
  isWindows,
  exeSuffix,
  binaryFile,
  unsupportedNotice,
  missingNotice,
  notice,
};
