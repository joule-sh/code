import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = path.join(ROOT, "scripts", "package_npm.mjs");
const WRAPPER_SRC = path.join(ROOT, "npm", "code");
const VERSION = "9.9.9";
const BINARIES = ["joule", "relay", "joule-daemon"];
const TARGETS = [
  { target: "x86_64-linux", id: "linux-x64" },
  { target: "x86_64-macos", id: "darwin-x64" },
  { target: "aarch64-macos", id: "darwin-arm64" },
];

if (process.platform === "win32") {
  console.log("skipped: these checks build tarballs and install them through a POSIX shell");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const platform = require(path.join(WRAPPER_SRC, "lib", "platform.js"));
const shim = require(path.join(WRAPPER_SRC, "lib", "shim.js"));
const download = require(path.join(WRAPPER_SRC, "lib", "download.js"));

let failures = 0;

function ok(condition, label) {
  if (condition) {
    console.log("ok: " + label);
    return;
  }
  console.error("FAIL: " + label);
  failures += 1;
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return {
    status: result.status,
    output: ((result.stdout || "") + (result.stderr || "")).trim(),
    stdout: (result.stdout || "").trim(),
  };
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "joule-npm-wrapper-"));

function fakeArchives() {
  for (const entry of TARGETS) {
    const dir = path.join(work, "code-" + entry.target);
    fs.mkdirSync(dir, { recursive: true });
    for (const name of BINARIES) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, [
        "#!/bin/sh",
        `echo "${name} ${VERSION} on ${entry.id}"`,
        'for a in "$@"; do echo "arg:$a"; done',
        'if [ "$1" = "--boom" ]; then exit 3; fi',
        "exit 0",
        "",
      ].join("\n"));
      fs.chmodSync(file, 0o644);
    }
    fs.writeFileSync(path.join(dir, "README.md"), "the archive readme");
    const packed = run("tar", ["-czf", `code-${entry.target}.tar.gz`, `code-${entry.target}`], { cwd: work });
    if (packed.status !== 0) { throw new Error("could not build the fixture archive: " + packed.output); }
  }
}

fakeArchives();

const dist = path.join(work, "dist");
const packaged = run(process.execPath, [PACKAGE, "--version", "v" + VERSION, "--artifacts", work, "--out", dist], { cwd: ROOT });
ok(packaged.status === 0, "package_npm.mjs builds every package from the archives the release already carries");
if (packaged.status !== 0) { console.error(packaged.output); }

const listing = JSON.parse(fs.readFileSync(path.join(dist, "packages.json"), "utf8"));
ok(listing.version === VERSION, "the version in the listing is the one the tag carried, with no v");
ok(listing.packages.filter((p) => p.kind === "platform").length === 3, "one package per built platform");
ok(listing.packages[listing.packages.length - 1].kind === "wrapper", "the wrapper is last in publish order");

const wrapperManifest = JSON.parse(fs.readFileSync(path.join(dist, "code", "package.json"), "utf8"));
ok(wrapperManifest.name === "@joule-sh/code", "the wrapper is @joule-sh/code");
ok(Object.keys(wrapperManifest.bin).join(",") === "joule,relay", "the commands are joule and relay, never code, which is VS Code's CLI");
ok(wrapperManifest.publishConfig.access === "public", "the wrapper declares public access, without which a scoped package publishes privately");
ok(wrapperManifest.scripts.postinstall === "node lib/postinstall.js", "the wrapper runs its install step");
ok(Object.values(wrapperManifest.optionalDependencies).every((v) => v === VERSION),
  "every optional dependency is pinned to the exact version, so a wrapper never resolves a binary from another release");
ok(Object.keys(wrapperManifest.optionalDependencies).length === 3, "all three platform packages are optional dependencies");
ok(wrapperManifest.version === VERSION, "the wrapper version comes from the tag");

for (const entry of TARGETS) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, "code-" + entry.id, "package.json"), "utf8"));
  const [expectedOs, expectedCpu] = entry.id.split("-");
  ok(manifest.os[0] === expectedOs && manifest.cpu[0] === expectedCpu,
    `${manifest.name} carries os and cpu, so npm silently skips it everywhere it does not apply`);
  ok(manifest.version === VERSION, `${manifest.name} is the same version as the wrapper`);
  ok(manifest.publishConfig.access === "public", `${manifest.name} publishes publicly`);
}

ok(fs.readFileSync(path.join(WRAPPER_SRC, "bin", "joule"), "utf8") === shim.source("joule")
  && fs.readFileSync(path.join(WRAPPER_SRC, "bin", "relay"), "utf8") === shim.source("relay"),
  "the committed command stubs are exactly what the install step writes back when it cannot link a binary");

const scratch = path.join(work, "scratch");
fs.mkdirSync(scratch);
const overrides = {};
for (const entry of TARGETS) {
  const file = listing.packages.find((p) => p.name.endsWith("code-" + entry.id)).file;
  overrides["@joule-sh/code-" + entry.id] = "file:" + path.join(dist, file);
}
const wrapperTarball = path.join(dist, listing.packages[listing.packages.length - 1].file);
fs.writeFileSync(path.join(scratch, "package.json"), JSON.stringify({
  name: "joule-npm-scratch",
  version: "1.0.0",
  private: true,
  dependencies: { "@joule-sh/code": "file:" + wrapperTarball },
  overrides,
}, null, 2));

const installed = run("npm", ["install", "--no-audit", "--no-fund", "--prefix", scratch], { cwd: scratch });
ok(installed.status === 0, "the tarballs install into a scratch prefix the way npm installs them for a user");
if (installed.status !== 0) { console.error(installed.output); }

const wrapperDir = path.join(scratch, "node_modules", "@joule-sh", "code");
const platformDir = path.join(scratch, "node_modules", "@joule-sh", "code-linux-x64");
ok(fs.existsSync(platformDir), "npm installed the platform package that matches this machine");
ok(fs.existsSync(path.join(scratch, "node_modules", "@joule-sh", "code-darwin-arm64")) === false,
  "npm skipped the platform packages that do not match, because of the os and cpu fields");

for (const name of BINARIES) {
  const mode = fs.statSync(path.join(platformDir, "bin", name)).mode & 0o111;
  ok(mode !== 0, `${name} is executable after the round trip through npm pack and npm install`);
}

const linked = fs.lstatSync(path.join(wrapperDir, "bin", "joule"));
ok(linked.isSymbolicLink(), "the install step points the command straight at the binary, so no node process sits in front of the terminal");
ok(fs.realpathSync(path.join(wrapperDir, "bin", "joule")) === fs.realpathSync(path.join(platformDir, "bin", "joule")),
  "and it points at the binary in the platform package, so joule-daemon is still beside joule's real path");

const invoked = run(path.join(scratch, "node_modules", ".bin", "joule"), ["--version", "hello"], {});
ok(invoked.status === 0, "the installed command runs");
ok(invoked.stdout.includes("joule " + VERSION + " on linux-x64"), "it runs the binary from the platform package");
ok(invoked.stdout.includes("arg:--version") && invoked.stdout.includes("arg:hello"), "every argument reaches the binary");

const relayed = run(path.join(scratch, "node_modules", ".bin", "relay"), [], {});
ok(relayed.stdout.includes("relay " + VERSION), "relay is installed alongside joule, the pair install.sh also puts on your PATH");

const postinstall = path.join(wrapperDir, "lib", "postinstall.js");

fs.chmodSync(path.join(platformDir, "bin", "joule"), 0o644);
const restored = run(process.execPath, [postinstall], { cwd: wrapperDir });
ok(restored.status === 0 && (fs.statSync(path.join(platformDir, "bin", "joule")).mode & 0o111) !== 0,
  "an install whose tarball lost the execute bit gets it back, which npm tarballs do not carry reliably");
ok(restored.output.includes("execute bit"), "and it says so rather than fixing it silently");

const dead = "http://127.0.0.1:9/";
const skipped = path.join(work, "skipped");
fs.mkdirSync(skipped);
fs.writeFileSync(path.join(skipped, "package.json"), JSON.stringify({
  name: "joule-npm-skipped",
  version: "1.0.0",
  private: true,
  dependencies: { "@joule-sh/code": "file:" + wrapperTarball },
}, null, 2));
const omitted = run("npm", [
  "install", "--no-audit", "--no-fund", "--omit=optional",
  "--offline", "--fetch-retries=0", "--registry", dead,
], { cwd: skipped });
ok(omitted.status !== 0,
  "an install npm skipped the binary for fails, because npm hides an install step that exits 0 and a command that cannot run must not look installed");
ok(omitted.output.includes("npm/cli/issues/4828"),
  "and npm shows every line of the message, so the diagnosis reaches the person installing rather than the debug log");
ok(omitted.output.includes("    at ") === false, "with no stack trace in what npm prints");

fs.rmSync(platformDir, { recursive: true, force: true });
const withoutBinary = run(process.execPath, [postinstall], {
  cwd: wrapperDir,
  env: { ...process.env, npm_config_registry: dead },
});
ok(withoutBinary.status === 1, "the install step exits non-zero when it could obtain no binary at all");
ok(withoutBinary.output.includes("@joule-sh/code-linux-x64"), "it names the package that should have been there");
ok(withoutBinary.output.includes("npm/cli/issues/4828"), "it names npm's bug, so nobody has to guess whose fault it is");
ok(withoutBinary.output.includes("JOULE_BINARY_PATH"), "and it offers the environment override as a way out");
ok(fs.lstatSync(path.join(wrapperDir, "bin", "joule")).isSymbolicLink() === false,
  "the command goes back to being a shim rather than a symlink left dangling at a binary that is gone");

const orphaned = run(path.join(scratch, "node_modules", ".bin", "joule"), [], {});
ok(orphaned.status === 1, "running the command with no binary installed exits 1");
ok(orphaned.output.includes("@joule-sh/code-linux-x64") && orphaned.output.includes("npm install"),
  "and prints the same diagnosis with the commands that fix it");
ok(orphaned.output.includes("Error:") === false && orphaned.output.includes("    at ") === false,
  "with no stack trace anywhere in it");

const elsewhere = path.join(work, "elsewhere");
fs.mkdirSync(elsewhere);
for (const name of BINARIES) {
  fs.writeFileSync(path.join(elsewhere, name), `#!/bin/sh\necho "${name} from the override"\n`);
  fs.chmodSync(path.join(elsewhere, name), 0o755);
}
const overridden = run(path.join(scratch, "node_modules", ".bin", "joule"), [], {
  env: { ...process.env, JOULE_BINARY_PATH: elsewhere },
});
ok(overridden.status === 0 && overridden.stdout.includes("joule from the override"),
  "JOULE_BINARY_PATH overrides resolution entirely, which is the way out when npm has installed nothing usable");

const overriddenFile = run(path.join(scratch, "node_modules", ".bin", "joule"), [], {
  env: { ...process.env, JOULE_BINARY_PATH: path.join(elsewhere, "joule") },
});
ok(overriddenFile.status === 0 && overriddenFile.stdout.includes("from the override"),
  "and it takes the path of one binary as readily as the directory holding all three");

const badOverride = run(path.join(scratch, "node_modules", ".bin", "joule"), [], {
  env: { ...process.env, JOULE_BINARY_PATH: path.join(work, "not-a-thing") },
});
ok(badOverride.status === 1 && badOverride.output.includes("does not exist") && badOverride.output.includes("    at ") === false,
  "an override pointing nowhere says so plainly instead of failing later and stranger");

ok(platform.windowsNotice().includes("/issues/173"),
  "the Windows message names the ticket for the Windows binary rather than leaving people to search");
ok(platform.windowsNotice().includes("WSL"), "and says what does work on Windows today");
ok(platform.notice("win32-x64", VERSION) === platform.windowsNotice(), "win32 gets that message and not the missing-binary one");
ok(platform.notice("win32-arm64", VERSION) === platform.windowsNotice(), "on either Windows architecture");

const windowsInstall = run(process.execPath, [
  "-e",
  `require(${JSON.stringify(postinstall)}).main("win32-x64").then((c) => process.exit(c));`,
], { cwd: wrapperDir });
ok(windowsInstall.status === 1,
  "installing on Windows fails the install, which is both true and the only way npm shows the message at all");
ok(windowsInstall.output.includes("no Windows build") && windowsInstall.output.includes("/issues/173"),
  "it prints the message naming the ticket, and nothing else");
ok(windowsInstall.output.includes("    at ") === false, "with no stack trace");

const oddPlatform = run(process.execPath, [
  "-e",
  `require(${JSON.stringify(postinstall)}).main("linux-arm64").then((c) => process.exit(c));`,
], { cwd: wrapperDir });
ok(oddPlatform.status === 1 && oddPlatform.output.includes("build from source"),
  "a platform with no build at all is told what is built and where to build from source, the way install.sh does");

ok(download.checkIntegrity(Buffer.from("hello"), "sha512-" + "x".repeat(88)) !== "",
  "a downloaded tarball whose hash does not match the registry's is refused");
ok(download.checkIntegrity(Buffer.from("hello"), "sha256-LPJNul+wow1BUlR7QUZAgg==") !== "",
  "including when the hash is the right shape but the wrong value");
ok(download.metadataUrl("@joule-sh/code-linux-x64", VERSION)
  === "https://registry.npmjs.org/@joule-sh%2fcode-linux-x64/" + VERSION,
  "the fallback asks the registry for the exact version of the platform package, not the latest one");

fs.rmSync(path.join(work, "code-x86_64-linux.tar.gz"));
const missing = run(process.execPath, [PACKAGE, "--version", "v" + VERSION, "--artifacts", work, "--out", path.join(work, "dist2")], { cwd: ROOT });
ok(missing.status !== 0 && missing.output.includes("never builds its own"),
  "packaging fails when an archive the release built is missing, rather than shipping a package with no binary in it");

const notAVersion = run(process.execPath, [PACKAGE, "--version", "main", "--artifacts", work], { cwd: ROOT });
ok(notAVersion.status !== 0 && notAVersion.output.includes("major.minor.patch"),
  "a ref that is not a release version is refused, so the tag stays the only source of the version");

fs.rmSync(work, { recursive: true, force: true });

if (failures > 0) {
  console.error("FAIL: " + failures + " check(s) failed");
  process.exit(1);
}
console.log("PASS: the npm packages install, run, keep their execute bit, and say something useful on Windows and when npm skips the binary");
