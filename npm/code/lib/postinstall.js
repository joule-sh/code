"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const platform = require("./platform.js");
const resolve = require("./resolve.js");
const shim = require("./shim.js");
const download = require("./download.js");

const ROOT = path.join(__dirname, "..");
const BIN = path.join(ROOT, "bin");

function say(message) {
  console.log(message);
}

function warn(message) {
  console.error(message);
}

function makeExecutable(dir) {
  const changed = [];
  for (const name of platform.BINARIES) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { continue; }
    const mode = fs.statSync(file).mode & 0o777;
    const wanted = mode | 0o111;
    if (mode === wanted) { continue; }
    fs.chmodSync(file, wanted);
    changed.push(name);
  }
  return changed;
}

function signed(file) {
  const result = spawnSync("codesign", ["--verify", "--strict", file], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function adHocSign(dir) {
  const failures = [];
  for (const name of platform.BINARIES) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file) || signed(file)) { continue; }
    const result = spawnSync("codesign", ["--sign", "-", "--force", file], { encoding: "utf8" });
    if (result.error) { failures.push(name + ": could not run codesign: " + result.error.message); continue; }
    if (result.status !== 0) { failures.push(name + ": " + ((result.stderr || "").trim() || "codesign exited " + result.status)); }
  }
  return failures;
}

function writeCommand(command, target) {
  const link = path.join(BIN, command);
  let current = "";
  try { current = fs.readlinkSync(link); } catch (e) { current = ""; }
  if (target === "") {
    if (current === "" && fs.existsSync(link) && fs.readFileSync(link, "utf8") === shim.source(command)) { return "shim"; }
    fs.rmSync(link, { force: true });
    fs.writeFileSync(link, shim.source(command));
    fs.chmodSync(link, 0o755);
    return "shim";
  }
  const relative = path.relative(BIN, target);
  if (current === relative) { return "link"; }
  fs.rmSync(link, { force: true });
  fs.symlinkSync(relative, link);
  return "link";
}

function restore() {
  for (const command of platform.COMMANDS) { writeCommand(command, ""); }
}

function smoke(dir) {
  const failures = [];
  for (const name of platform.BINARIES) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) { failures.push(name + " is missing from " + dir); continue; }
    const result = spawnSync(file, ["--version"], { encoding: "utf8" });
    if (result.error) { failures.push(name + " will not run: " + result.error.message); continue; }
    if (result.status === 0) { continue; }
    const output = ((result.stdout || "") + (result.stderr || "")).trim();
    const detail = output === "" ? "it exited " + result.status + " without printing anything" : output;
    failures.push(name + " will not run: " + detail);
    if (result.status === 137) {
      failures.push(name + ": 137 is SIGKILL on exec, which on Apple Silicon means the kernel refused the code signature");
    }
  }
  return failures;
}

async function obtain(id) {
  const found = resolve.binaryDir(id);
  if (found.dir !== "") { return found; }
  const pkg = platform.packageFor(id);
  const version = resolve.selfVersion();
  if (version === "") { return found; }
  say("joule: " + pkg + " was not installed, so it is being fetched from the registry directly.");
  const failure = await download.fetchPackage(pkg, version, path.join(resolve.vendorDir(), "bin"));
  if (failure !== "") {
    warn("joule: fetching " + pkg + "@" + version + " failed: " + failure);
    return { dir: "", source: "" };
  }
  return resolve.binaryDir(id);
}

async function main(id) {
  if (platform.isWindows(id)) {
    warn(platform.windowsNotice());
    return 1;
  }
  if (platform.packageFor(id) === "") {
    warn(platform.unsupportedNotice(id));
    return 1;
  }
  const found = await obtain(id);
  if (found.dir === "") {
    restore();
    warn(platform.notice(id, resolve.selfVersion()));
    return 1;
  }
  const changed = makeExecutable(found.dir);
  if (changed.length > 0) {
    say("joule: restored the execute bit on " + changed.join(", ") + ", which an npm tarball does not carry reliably.");
  }
  // Apple Silicon only. The kernel demands a signature there and demands none
  // on Intel, where signing actively breaks the binary: an x86_64 Mach-O from
  // the backend has no padding between its load commands and __text, so
  // codesign adds LC_CODE_SIGNATURE over the first function in the code
  // section and returns a file that verifies and then faults (#255,
  // lumen-lang-org/lumen#43).
  if (id === "darwin-arm64") {
    const unsigned = adHocSign(found.dir);
    for (const failure of unsigned) { warn("joule: " + failure); }
  }
  const broken = smoke(found.dir);
  if (broken.length > 0) {
    restore();
    for (const failure of broken) { warn("joule: " + failure); }
    warn("joule: the binaries are installed at " + found.dir + " but will not run, so no command was linked.");
    warn("joule: please report this at " + platform.REPO + "/issues with the lines above and the output of 'uname -a'.");
    return 1;
  }
  for (const command of platform.COMMANDS) {
    writeCommand(command, path.join(found.dir, command));
  }
  say("joule: " + found.source + " installed to " + found.dir + ", and " + platform.COMMANDS.join(" and ") + " point at it.");
  return 0;
}

if (require.main === module) {
  main(platform.current()).then((code) => { process.exitCode = code; }).catch((e) => {
    warn("joule: the install step failed: " + e.message);
    warn("joule: please report this at " + platform.REPO + "/issues with the line above.");
    process.exitCode = 1;
  });
}

module.exports = { main, makeExecutable, writeCommand, restore, smoke, signed, adHocSign };
