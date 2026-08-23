import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDITOR = path.join(ROOT, "editor");
const MANIFEST = path.join(EDITOR, "package.json");
const OUT_DIR = path.join(ROOT, "dist");
const VSCE = "@vscode/vsce@3.6.0";
const DEV_VERSION = "0.0.0";
const RELEASE = /^\d+\.\d+\.\d+$/;

function fail(message) {
  console.error("package-editor: " + message);
  process.exit(1);
}

function requestedVersion(argv) {
  const inline = argv.find((a) => a.startsWith("--version="));
  if (inline !== undefined) { return inline.slice("--version=".length); }
  const flag = argv.indexOf("--version");
  if (flag >= 0) {
    if (flag + 1 >= argv.length) { fail("--version needs a value"); }
    return argv[flag + 1];
  }
  return "";
}

function withoutTagPrefix(raw) {
  return raw.startsWith("v") ? raw.slice(1) : raw;
}

function resolveVersion(argv) {
  const asked = requestedVersion(argv).trim();
  if (asked === "") {
    const ref = withoutTagPrefix((process.env.GITHUB_REF_NAME || "").trim());
    return RELEASE.test(ref) ? ref : DEV_VERSION;
  }
  const version = withoutTagPrefix(asked);
  if (!RELEASE.test(version)) {
    fail(`"${asked}" is not a marketplace version. It must be major.minor.patch, the shape the release tags already use.`);
  }
  return version;
}

function writeVersion(manifest, version) {
  const parsed = JSON.parse(manifest);
  parsed.version = version;
  return JSON.stringify(parsed, null, 2) + "\n";
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) { fail(`could not run ${command}: ${result.error.message}`); }
  if (result.status !== 0) { fail(`${command} ${args.join(" ")} exited ${result.status}`); }
}

function main() {
  const version = resolveVersion(process.argv.slice(2));
  const original = fs.readFileSync(MANIFEST, "utf8");
  const out = path.join(OUT_DIR, `joule-editor-${version}.vsix`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST, writeVersion(original, version));
  try {
    run("npx", ["--yes", VSCE, "package", "--out", out], EDITOR);
  } finally {
    fs.writeFileSync(MANIFEST, original);
  }
  const size = fs.statSync(out).size;
  console.log(`package-editor: ${path.relative(ROOT, out)} (${size} bytes), version ${version}`);
  if (version === DEV_VERSION) {
    console.log("package-editor: no tag given, so this is the in-tree placeholder version. A release passes --version, or runs under GITHUB_REF_NAME.");
  }
}

main();
