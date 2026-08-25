import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISH = path.join(ROOT, "scripts", "publish_npm.mjs");
const TOKEN = "npm-token-do-not-leak-this-one";
const VERSION = "9.9.9";
const WRAPPER = "@joule-sh/code";
const PLATFORMS = ["@joule-sh/code-linux-x64", "@joule-sh/code-darwin-x64", "@joule-sh/code-darwin-arm64", "@joule-sh/code-win32-x64"];

if (process.platform === "win32") {
  console.log("skipped: the publish checks drive a stub npm through PATH, which needs a POSIX shell");
  process.exit(0);
}

let failures = 0;

function ok(condition, label) {
  if (condition) {
    console.log("ok: " + label);
    return;
  }
  console.error("FAIL: " + label);
  failures += 1;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "joule-npm-publish-"));
const stubDir = path.join(work, "bin");
fs.mkdirSync(stubDir);
fs.writeFileSync(path.join(stubDir, "npm"), [
  "#!/bin/sh",
  'line="cmd=$1 args=$*"',
  '[ -n "${NPM_TOKEN:-}" ] && line="$line npm_token=set"',
  'if [ -n "${npm_config_userconfig:-}" ] && [ -f "$npm_config_userconfig" ]; then',
  '  line="$line userconfig=$(tr -d "\\n" < "$npm_config_userconfig")"',
  '  printf "%s\\n" "$npm_config_userconfig" > "$STUB_NPMRC_PATH"',
  "fi",
  'printf \'%s\\n\' "$line" >> "$STUB_LOG"',
  'case "$1" in',
  "  view)",
  '    for p in $STUB_PRESENT; do',
  '      if [ "$p" = "$2" ]; then echo "${2##*@}"; exit 0; fi',
  "    done",
  '    echo "npm error code E404" >&2',
  "    exit 1",
  "    ;;",
  "  publish)",
  '    if [ -n "${STUB_FAIL:-}" ]; then',
  '      case "$*" in *"$STUB_FAIL"*) echo "the registry said no" >&2; exit 1 ;; esac',
  "    fi",
  "    exit 0",
  "    ;;",
  "esac",
  "exit 0",
  "",
].join("\n"));
fs.chmodSync(path.join(stubDir, "npm"), 0o755);

function fixture(version) {
  const dir = fs.mkdtempSync(path.join(work, "dist-"));
  const packages = [];
  for (const name of PLATFORMS) {
    const file = name.replace("@", "").replace("/", "-") + "-" + version + ".tgz";
    fs.writeFileSync(path.join(dir, file), "not a real tarball");
    packages.push({ name, kind: "platform", file });
  }
  const wrapperFile = "joule-sh-code-" + version + ".tgz";
  fs.writeFileSync(path.join(dir, wrapperFile), "not a real tarball");
  packages.push({ name: WRAPPER, kind: "wrapper", file: wrapperFile });
  fs.writeFileSync(path.join(dir, "packages.json"), JSON.stringify({ version, packages }, null, 2));
  return dir;
}

let run = 0;

function publish(env, args) {
  run += 1;
  const log = path.join(work, `npm-${run}.log`);
  const npmrcPath = path.join(work, `npmrc-path-${run}`);
  fs.writeFileSync(log, "");
  fs.writeFileSync(npmrcPath, "");
  const result = spawnSync(process.execPath, [PUBLISH, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: stubDir + path.delimiter + process.env.PATH,
      HOME: work,
      STUB_LOG: log,
      STUB_NPMRC_PATH: npmrcPath,
      STUB_PRESENT: "",
      STUB_FAIL: "",
      ...env,
    },
  });
  const output = (result.stdout || "") + (result.stderr || "");
  const calls = fs.readFileSync(log, "utf8").split("\n").filter((l) => l !== "");
  const leaked = output.includes(TOKEN) || calls.some((c) => c.includes(TOKEN));
  ok(leaked === false, `run ${run} put the token in neither a log line, a command line, nor an npmrc`);
  return { status: result.status, output, calls, npmrc: fs.readFileSync(npmrcPath, "utf8").trim() };
}

const dist = fixture(VERSION);
const release = ["--tag", "v" + VERSION, "--dir", dist];

const unconfigured = publish({}, release);
ok(unconfigured.status === 0, "a release with no NPM_TOKEN exits 0, so publishing cannot fail a release that is not configured for it");
ok(unconfigured.calls.length === 0, "with no token set npm is never invoked at all");
ok(unconfigured.output.includes("no NPM_TOKEN secret is set"), "the run says plainly that npm was skipped, and which secret was missing");
ok(unconfigured.output.includes("GitHub only"), "a release nobody has configured npm for says where it did land");
ok(unconfigured.output.includes("docs/05-publishing.md"), "the skip points at the runbook that says how to configure it");

const branch = publish({ NPM_TOKEN: TOKEN }, ["--tag", "231/merge", "--dir", dist]);
ok(branch.status === 0 && branch.calls.length === 0, "a ref that is not a release tag publishes nothing, token or no token");

const prerelease = publish({ NPM_TOKEN: TOKEN }, ["--tag", "v9.9.9-rc.1", "--dir", dist]);
ok(prerelease.status === 0 && prerelease.calls.length === 0, "a pre-release tag publishes nothing");

const full = publish({ NPM_TOKEN: TOKEN }, release);
const published = full.calls.filter((c) => c.startsWith("cmd=publish"));
ok(full.status === 0, "with the token present every package publishes and the job passes");
ok(published.length === PLATFORMS.length + 1, "all four platform packages and the wrapper are published, once each");
ok(published.slice(0, PLATFORMS.length).every((c) => PLATFORMS.some((p) => c.includes(p.replace("@", "").replace("/", "-")))),
  "the platform packages go first");
ok(published[PLATFORMS.length].includes("joule-sh-code-" + VERSION + ".tgz"),
  "the wrapper goes last, so its optional dependencies already exist by the time anyone can install it");
ok(published.every((c) => c.includes("--access public")),
  "every publish passes --access public, without which a scoped package is private and the install line does not work");
ok(published.every((c) => c.includes("npm_token=set")), "npm is handed the token through the environment");
ok(full.calls.filter((c) => c.startsWith("cmd=view")).length === PLATFORMS.length + 1,
  "each package is looked up before it is published, so a re-run does not fail on a version that is already there");
ok(full.calls.every((c) => c.includes("userconfig=//registry.npmjs.org/:_authToken=${NPM_TOKEN}")),
  "the npmrc npm reads holds the literal ${NPM_TOKEN}, so the token itself is never written to disk");
ok(full.npmrc !== "" && fs.existsSync(full.npmrc) === false,
  "the temporary npmrc is removed when the run finishes");

const rerun = publish({ NPM_TOKEN: TOKEN, STUB_PRESENT: [...PLATFORMS, WRAPPER].map((n) => n + "@" + VERSION).join(" ") }, release);
ok(rerun.status === 0, "re-running a release whose packages are all on the registry is a no-op, not a failure");
ok(rerun.calls.filter((c) => c.startsWith("cmd=publish")).length === 0, "nothing is published a second time");
ok(rerun.output.includes("changed nothing"), "a run that published nothing new says so");

const halfDone = publish({ NPM_TOKEN: TOKEN, STUB_PRESENT: PLATFORMS[0] + "@" + VERSION }, release);
ok(halfDone.status === 0, "a run that finds one platform already there publishes the rest and passes");
ok(halfDone.calls.filter((c) => c.startsWith("cmd=publish")).length === PLATFORMS.length, "only the packages that were missing are published");

const platformDown = publish({ NPM_TOKEN: TOKEN, STUB_FAIL: "code-darwin-arm64" }, release);
const attempted = platformDown.calls.filter((c) => c.startsWith("cmd=publish"));
ok(platformDown.status !== 0, "a platform package the registry rejects fails the job rather than passing quietly");
ok(attempted.some((c) => c.includes("joule-sh-code-" + VERSION + ".tgz")) === false,
  "the wrapper is held back when a platform package did not publish, since a wrapper without its binary installs and then cannot run");
ok(platformDown.output.includes("held back"), "the run says the wrapper was held back on purpose");
ok(platformDown.output.includes("72 hours"), "it says why that matters, which is that npm only lets a version be taken back within 72 hours");
ok(platformDown.output.includes("re-run"), "it says what to do next");

const wrapperDown = publish({ NPM_TOKEN: TOKEN, STUB_FAIL: "joule-sh-code-" + VERSION }, release);
ok(wrapperDown.status !== 0, "the wrapper failing is a failed job too");
ok(wrapperDown.output.includes(WRAPPER), "the failing package is named");

const mismatched = fixture("8.8.8");
const wrongVersion = publish({ NPM_TOKEN: TOKEN }, ["--tag", "v" + VERSION, "--dir", mismatched]);
ok(wrongVersion.status !== 0 && wrongVersion.calls.length === 0,
  "tarballs built for a different version than the tag publish nothing, since the tag is the only source of the version");

const empty = publish({ NPM_TOKEN: TOKEN }, ["--tag", "v" + VERSION, "--dir", path.join(work, "nothing-here")]);
ok(empty.status !== 0 && empty.calls.length === 0,
  "a missing packages.json fails loudly, since the alternative is publishing something this run packed itself");

fs.rmSync(work, { recursive: true, force: true });

if (failures > 0) {
  console.error("FAIL: " + failures + " check(s) failed");
  process.exit(1);
}
console.log("PASS: npm publishing is inert without a token, ordered with one, and holds the wrapper back when a platform package is missing");
