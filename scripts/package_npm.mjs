import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readZip } from "./lib/zip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRAPPER_SRC = path.join(ROOT, "npm", "code");
const SCOPE = "@joule-sh";
const WRAPPER = SCOPE + "/code";
const DEV_VERSION = "0.0.0";
const RELEASE = /^\d+\.\d+\.\d+$/;
const BINARIES = ["joule", "relay", "joule-daemon"];

const TARGETS = [
  { target: "x86_64-linux", id: "linux-x64", os: "linux", cpu: "x64" },
  { target: "x86_64-macos", id: "darwin-x64", os: "darwin", cpu: "x64" },
  { target: "aarch64-macos", id: "darwin-arm64", os: "darwin", cpu: "arm64" },
  { target: "x86_64-windows", id: "win32-x64", os: "win32", cpu: "x64", archiveExt: "zip", exe: ".exe" },
];

function fail(message) {
  console.error("package-npm: " + message);
  process.exit(1);
}

function say(message) {
  console.log("package-npm: " + message);
}

function option(argv, name) {
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  if (inline !== undefined) { return inline.slice(name.length + 3); }
  const flag = argv.indexOf(`--${name}`);
  if (flag < 0) { return ""; }
  if (flag + 1 >= argv.length) { fail(`--${name} needs a value`); }
  return argv[flag + 1];
}

function withoutTagPrefix(raw) {
  return raw.startsWith("v") ? raw.slice(1) : raw;
}

function resolveVersion(argv) {
  const asked = option(argv, "version").trim();
  if (asked === "") {
    const ref = withoutTagPrefix((process.env.GITHUB_REF_NAME || "").trim());
    return RELEASE.test(ref) ? ref : DEV_VERSION;
  }
  const version = withoutTagPrefix(asked);
  if (!RELEASE.test(version)) {
    fail(`"${asked}" is not an npm version. It must be major.minor.patch, the shape the release tags already use.`);
  }
  return version;
}

function shared(version) {
  return {
    version,
    license: "MIT",
    repository: { type: "git", url: "https://github.com/joule-sh/code.git" },
    homepage: "https://github.com/joule-sh/code#readme",
    bugs: { url: "https://github.com/joule-sh/code/issues" },
    publishConfig: { access: "public" },
  };
}

function platformManifest(entry, version) {
  return {
    name: SCOPE + "/code-" + entry.id,
    ...shared(version),
    description: `The ${entry.id} binaries for ${WRAPPER}. Installed for you as an optional dependency; do not depend on it directly.`,
    os: [entry.os],
    cpu: [entry.cpu],
    files: ["bin"],
    preferUnplugged: true,
  };
}

function wrapperManifest(version) {
  const optional = {};
  for (const entry of TARGETS) { optional[SCOPE + "/code-" + entry.id] = version; }
  return {
    name: WRAPPER,
    ...shared(version),
    description: "An agentic coding terminal you can also drive from a web page.",
    keywords: ["agent", "cli", "coding", "terminal", "joule"],
    bin: { joule: "bin/joule", relay: "bin/relay" },
    files: ["bin", "lib", "README.md"],
    engines: { node: ">=18" },
    scripts: { postinstall: "node lib/postinstall.js" },
    optionalDependencies: optional,
  };
}

function write(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
}

function untar(archive, into) {
  fs.mkdirSync(into, { recursive: true });
  const result = spawnSync("tar", ["--force-local", "-xzf", archive, "-C", into], { encoding: "utf8" });
  if (result.error) { fail("could not run tar: " + result.error.message); }
  if (result.status !== 0) { fail(`tar exited ${result.status} on ${archive}: ${(result.stderr || "").trim()}`); }
}

function unzip(archive, into) {
  fs.mkdirSync(into, { recursive: true });
  let entries;
  try {
    entries = readZip(fs.readFileSync(archive));
  } catch (e) {
    fail(`could not read ${archive} as a zip: ${e.message}`);
  }
  for (const entry of entries) {
    if (entry.name.endsWith("/")) { continue; }
    const dest = path.join(into, entry.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.data);
  }
}

function buildPlatform(entry, version, artifacts, out) {
  const ext = entry.archiveExt || "tar.gz";
  const exe = entry.exe || "";
  const archive = path.join(artifacts, `code-${entry.target}.${ext}`);
  if (!fs.existsSync(archive)) {
    fail(`${archive} does not exist. Packaging takes the archives the release already built, and never builds its own.`);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "joule-npm-pack-"));
  const dir = path.join(out, "code-" + entry.id);
  try {
    if (ext === "zip") { unzip(archive, work); } else { untar(archive, work); }
    const unpacked = path.join(work, `code-${entry.target}`);
    const bin = path.join(dir, "bin");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(bin, { recursive: true });
    for (const name of BINARIES) {
      const file = name + exe;
      const from = path.join(unpacked, file);
      if (!fs.existsSync(from)) { fail(`${archive} carries no ${file}`); }
      fs.copyFileSync(from, path.join(bin, file));
      fs.chmodSync(path.join(bin, file), 0o755);
    }
    const readme = path.join(unpacked, "README.md");
    if (fs.existsSync(readme)) { fs.copyFileSync(readme, path.join(dir, "README.md")); }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  write(dir, platformManifest(entry, version));
  return dir;
}

function buildWrapper(version, out) {
  const dir = path.join(out, "code");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(WRAPPER_SRC, "lib"), path.join(dir, "lib"), { recursive: true });
  fs.cpSync(path.join(WRAPPER_SRC, "bin"), path.join(dir, "bin"), { recursive: true });
  fs.copyFileSync(path.join(WRAPPER_SRC, "README.md"), path.join(dir, "README.md"));
  for (const command of ["joule", "relay"]) { fs.chmodSync(path.join(dir, "bin", command), 0o755); }
  write(dir, wrapperManifest(version));
  return dir;
}

function pack(dir, out) {
  const result = spawnSync("npm", ["pack", "--silent", "--pack-destination", out], {
    cwd: dir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.error) { fail("could not run npm pack: " + result.error.message); }
  if (result.status !== 0) { fail(`npm pack exited ${result.status} in ${dir}: ${(result.stdout || "") + (result.stderr || "")}`); }
  const named = (result.stdout || "").trim().split("\n").filter((l) => l.endsWith(".tgz")).pop();
  if (!named) { fail(`npm pack printed no tarball name for ${dir}`); }
  return named.trim();
}

function main() {
  const argv = process.argv.slice(2);
  const version = resolveVersion(argv);
  const artifacts = path.resolve(ROOT, option(argv, "artifacts") || ".");
  const out = path.resolve(ROOT, option(argv, "out") || path.join("dist", "npm"));
  fs.mkdirSync(out, { recursive: true });
  const packages = [];
  for (const entry of TARGETS) {
    const dir = buildPlatform(entry, version, artifacts, out);
    packages.push({ name: SCOPE + "/code-" + entry.id, kind: "platform", file: pack(dir, out) });
  }
  const wrapper = buildWrapper(version, out);
  packages.push({ name: WRAPPER, kind: "wrapper", file: pack(wrapper, out) });
  fs.writeFileSync(path.join(out, "packages.json"), JSON.stringify({ version, packages }, null, 2) + "\n");
  for (const entry of packages) {
    const size = fs.statSync(path.join(out, entry.file)).size;
    say(`${entry.name} ${version} -> ${entry.file} (${size} bytes)`);
  }
  say(`${path.relative(ROOT, path.join(out, "packages.json"))} lists them in the order they must be published: every platform package, then the wrapper.`);
  if (version === DEV_VERSION) {
    say("no tag given, so this is the in-tree placeholder version. A release passes --version, or runs under GITHUB_REF_NAME.");
  }
}

main();
