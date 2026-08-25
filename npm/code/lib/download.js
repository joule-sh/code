"use strict";

const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

function registry() {
  const configured = (process.env.npm_config_registry || "").trim();
  const base = configured === "" ? DEFAULT_REGISTRY : configured;
  return base.endsWith("/") ? base : base + "/";
}

function metadataUrl(pkg, version) {
  return registry() + pkg.replace("/", "%2f") + "/" + version;
}

function checkIntegrity(bytes, integrity) {
  if (typeof integrity !== "string" || integrity === "") { return ""; }
  const at = integrity.indexOf("-");
  const algorithm = integrity.slice(0, at);
  const expected = integrity.slice(at + 1);
  if (["sha512", "sha384", "sha256", "sha1"].indexOf(algorithm) < 0) {
    return "the registry gave an integrity hash this cannot check: " + integrity;
  }
  const actual = crypto.createHash(algorithm).update(bytes).digest("base64");
  if (actual !== expected) {
    return "the downloaded tarball does not match the integrity hash the registry published for it";
  }
  return "";
}

function untar(tarball, into) {
  const result = spawnSync("tar", ["--force-local", "-xzf", tarball, "-C", into], { encoding: "utf8" });
  if (result.error) { return "could not run tar: " + result.error.message; }
  if (result.status !== 0) { return "tar exited " + result.status + ": " + (result.stderr || "").trim(); }
  return "";
}

async function fetchPackage(pkg, version, into) {
  const url = metadataUrl(pkg, version);
  let meta = null;
  try {
    const response = await fetch(url);
    if (!response.ok) { return "the registry answered " + response.status + " for " + url; }
    meta = await response.json();
  } catch (e) {
    return "could not reach " + url + ": " + e.message;
  }
  const tarball = meta && meta.dist && meta.dist.tarball;
  if (typeof tarball !== "string" || tarball === "") {
    return "the registry entry for " + pkg + "@" + version + " names no tarball";
  }
  let bytes = null;
  try {
    const response = await fetch(tarball);
    if (!response.ok) { return "the registry answered " + response.status + " for " + tarball; }
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (e) {
    return "could not download " + tarball + ": " + e.message;
  }
  const mismatch = checkIntegrity(bytes, meta.dist.integrity);
  if (mismatch !== "") { return mismatch; }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "joule-npm-"));
  try {
    const file = path.join(work, "package.tgz");
    fs.writeFileSync(file, bytes);
    const failure = untar(file, work);
    if (failure !== "") { return failure; }
    const unpacked = path.join(work, "package", "bin");
    if (!fs.existsSync(unpacked)) { return "the tarball for " + pkg + "@" + version + " carries no bin directory"; }
    fs.rmSync(into, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(into), { recursive: true });
    fs.cpSync(unpacked, into, { recursive: true });
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return "";
}

module.exports = { registry, metadataUrl, checkIntegrity, fetchPackage, DEFAULT_REGISTRY };
