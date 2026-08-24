"use strict";

const fs = require("node:fs");
const path = require("node:path");
const platform = require("./platform.js");

const ROOT = path.join(__dirname, "..");
const VENDOR = path.join(ROOT, "vendor");

function selfVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version || "";
  } catch (e) {
    return "";
  }
}

function overrideDir() {
  const raw = (process.env[platform.OVERRIDE] || "").trim();
  if (raw === "") { return ""; }
  if (!fs.existsSync(raw)) {
    throw new Error("joule: " + platform.OVERRIDE + " is set to " + raw + ", which does not exist.");
  }
  return fs.statSync(raw).isDirectory() ? raw : path.dirname(raw);
}

function packageDir(pkg) {
  try {
    return path.dirname(require.resolve(pkg + "/package.json", { paths: [ROOT] }));
  } catch (e) {
    return "";
  }
}

function holdsBinaries(dir) {
  if (dir === "") { return false; }
  return platform.BINARIES.every((name) => fs.existsSync(path.join(dir, name)));
}

function vendorDir() {
  return VENDOR;
}

function binaryDir(id) {
  if (platform.isWindows(id)) { return { dir: "", source: "" }; }
  const override = overrideDir();
  if (override !== "") { return { dir: override, source: platform.OVERRIDE }; }
  const pkg = platform.packageFor(id);
  if (pkg !== "") {
    const installed = path.join(packageDir(pkg), "bin");
    if (holdsBinaries(installed)) { return { dir: installed, source: pkg }; }
  }
  const vendored = path.join(VENDOR, "bin");
  if (holdsBinaries(vendored)) { return { dir: vendored, source: "vendor" }; }
  return { dir: "", source: "" };
}

function binaryPath(name, id) {
  const found = binaryDir(id);
  if (found.dir === "") {
    throw new Error(platform.notice(id, selfVersion()));
  }
  const file = path.join(found.dir, name);
  if (!fs.existsSync(file)) {
    throw new Error("joule: " + found.source + " has no " + name + " in " + found.dir + ".");
  }
  return file;
}

module.exports = { selfVersion, overrideDir, packageDir, holdsBinaries, vendorDir, binaryDir, binaryPath };
