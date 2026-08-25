import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISH = path.join(ROOT, "scripts", "publish_editor.mjs");
const VSCE = "@vscode/vsce@3.6.0";
const OVSX = "ovsx@1.1.1";
const MARKETPLACE_PAT = "marketplace-pat-do-not-leak-this-one";
const OPEN_VSX_PAT = "open-vsx-pat-do-not-leak-this-one";

if (process.platform === "win32") {
  console.log("skipped: the publish checks drive a stub npx through PATH, which needs a POSIX shell");
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

const work = scratchDir("joule-editor-publish-");
const stubDir = path.join(work, "bin");
fs.mkdirSync(stubDir);
fs.writeFileSync(path.join(stubDir, "npx"), [
  "#!/bin/sh",
  'line="tool=$2 args=$*"',
  '[ -n "${VSCE_PAT:-}" ] && line="$line vsce_pat=set"',
  '[ -n "${OVSX_PAT:-}" ] && line="$line ovsx_pat=set"',
  "printf '%s\\n' \"$line\" >> \"$STUB_LOG\"",
  'case "$2" in',
  '  $STUB_FAIL) exit 1 ;;',
  "esac",
  "exit 0",
  "",
].join("\n"));
fs.chmodSync(path.join(stubDir, "npx"), 0o755);

const vsix = path.join(work, "joule-editor-9.9.9.vsix");
fs.writeFileSync(vsix, "not a real archive");

let run = 0;

function publish(env, args) {
  run += 1;
  const log = path.join(work, `npx-${run}.log`);
  fs.writeFileSync(log, "");
  const result = spawnSync(process.execPath, [PUBLISH, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      PATH: stubDir + path.delimiter + process.env.PATH,
      HOME: work,
      STUB_LOG: log,
      STUB_FAIL: "",
      ...env,
    },
  });
  const output = (result.stdout || "") + (result.stderr || "");
  const calls = fs.readFileSync(log, "utf8").split("\n").filter((l) => l !== "");
  const leaked = output.includes(MARKETPLACE_PAT) || output.includes(OPEN_VSX_PAT)
    || calls.some((c) => c.includes(MARKETPLACE_PAT) || c.includes(OPEN_VSX_PAT));
  ok(leaked === false, `run ${run} put neither token in a log line nor on a command line`);
  return { status: result.status, output, calls };
}

const release = ["--vsix", vsix, "--tag", "v9.9.9"];

const unconfigured = publish({}, release);
ok(unconfigured.status === 0, "a release with no secrets set exits 0, so publishing cannot fail a release that is not configured for it");
ok(unconfigured.calls.length === 0, "with no secrets set no publisher is fetched or run at all");
ok(unconfigured.output.includes("no VSCE_PAT secret is set"), "the run says plainly that the marketplace was skipped, and why");
ok(unconfigured.output.includes("no OVSX_PAT secret is set"), "the run says plainly that Open VSX was skipped, and why");
ok(unconfigured.output.includes("GitHub only"), "a release nobody has configured a registry for says where it did land");

const both = publish({ VSCE_PAT: MARKETPLACE_PAT, OVSX_PAT: OPEN_VSX_PAT }, release);
ok(both.status === 0, "with both tokens present both publishers run and the job passes");
ok(both.calls.length === 2, "both registries are attempted, once each");
ok(both.calls[0].includes(`tool=${VSCE}`) && both.calls[1].includes(`tool=${OVSX}`),
  "the marketplace goes first, then Open VSX, each through its own pinned publisher");
ok(both.calls.every((c) => c.includes(`--packagePath ${vsix}`)),
  "both publish the vsix they were handed, so the bytes on the release are the bytes on the registries");
ok(both.calls.every((c) => c.includes("--skip-duplicate")),
  "a version already on a registry is not an error, so a re-run of a release job is safe");
ok(both.calls[0].includes("vsce_pat=set") && both.calls[0].includes("ovsx_pat=set") === false,
  "the marketplace publisher is handed its own token and not the Open VSX one");
ok(both.calls[1].includes("ovsx_pat=set") && both.calls[1].includes("vsce_pat=set") === false,
  "the Open VSX publisher is handed its own token and not the marketplace one");

const half = publish({ VSCE_PAT: MARKETPLACE_PAT }, release);
ok(half.status === 0, "one token configured and the other not is a complete run, not a failure");
ok(half.calls.length === 1 && half.calls[0].includes(`tool=${VSCE}`), "only the registry with a token is published to");
ok(half.output.includes("no OVSX_PAT secret is set"), "the registry without a token still says it was skipped");

const marketplaceDown = publish(
  { VSCE_PAT: MARKETPLACE_PAT, OVSX_PAT: OPEN_VSX_PAT, STUB_FAIL: VSCE },
  release,
);
ok(marketplaceDown.status !== 0, "a registry that rejects the extension fails the job rather than passing quietly");
ok(marketplaceDown.calls.length === 2, "a failure at the first registry does not stop the second from being tried");
ok(marketplaceDown.output.includes("half published"), "a partial publication says so, naming which registry has the version and which does not");

const openVsxDown = publish(
  { VSCE_PAT: MARKETPLACE_PAT, OVSX_PAT: OPEN_VSX_PAT, STUB_FAIL: OVSX },
  release,
);
ok(openVsxDown.status !== 0, "the same holds when it is Open VSX that fails");
ok(openVsxDown.output.includes("Open VSX"), "the failing registry is named");

const prerelease = publish({ VSCE_PAT: MARKETPLACE_PAT, OVSX_PAT: OPEN_VSX_PAT }, ["--vsix", vsix, "--tag", "v9.9.9-rc.1"]);
ok(prerelease.status === 0, "a pre-release tag is not a failure");
ok(prerelease.calls.length === 0, "a pre-release tag publishes nowhere, since neither registry serves one as an ordinary version");

const branch = publish({ VSCE_PAT: MARKETPLACE_PAT }, ["--vsix", vsix, "--tag", "231/merge"]);
ok(branch.status === 0 && branch.calls.length === 0, "a ref that is not a tag at all publishes nothing");

const missing = publish({ VSCE_PAT: MARKETPLACE_PAT }, ["--vsix", path.join(work, "gone.vsix"), "--tag", "v9.9.9"]);
ok(missing.status !== 0, "a missing artifact fails loudly, since the alternative is publishing something this run built itself");
ok(missing.calls.length === 0, "nothing is published when the artifact the release carries cannot be found");

const derived = publish({}, ["--tag", "v9.9.9"]);
ok(derived.status !== 0 && derived.output.includes("dist"), "with no --vsix the path is derived from the tag, and its absence is still a failure");

fs.rmSync(work, { recursive: true, force: true });

if (failures > 0) {
  console.error("FAIL: " + failures + " check(s) failed");
  process.exit(1);
}
console.log("PASS: publishing is inert without tokens, exact with them, and loud when it half works");
