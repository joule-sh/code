import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = /^\d+\.\d+\.\d+$/;

const REGISTRIES = [
  { name: "the Visual Studio Marketplace", secret: "VSCE_PAT", tool: "@vscode/vsce@3.6.0" },
  { name: "Open VSX", secret: "OVSX_PAT", tool: "ovsx@1.1.1" },
];

function say(message) {
  console.log("publish-editor: " + message);
}

function fail(message) {
  console.error("publish-editor: " + message);
  process.exit(1);
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

function childEnv(secret) {
  const env = { ...process.env };
  for (const other of REGISTRIES) {
    if (other.secret !== secret) { delete env[other.secret]; }
  }
  return env;
}

function attempt(registry, vsix) {
  const args = ["--yes", registry.tool, "publish", "--packagePath", vsix, "--skip-duplicate"];
  const result = spawnSync("npx", args, {
    cwd: ROOT,
    stdio: "inherit",
    env: childEnv(registry.secret),
    shell: process.platform === "win32",
  });
  if (result.error) { return `could not run npx: ${result.error.message}`; }
  if (result.status !== 0) { return `npx ${registry.tool} publish exited ${result.status}`; }
  return "";
}

function publish(registry, vsix) {
  const token = (process.env[registry.secret] || "").trim();
  if (token === "") {
    say(`no ${registry.secret} secret is set, so nothing was published to ${registry.name}`);
    return { registry, state: "skipped", detail: `no ${registry.secret}` };
  }
  say(`publishing to ${registry.name} through ${registry.tool}`);
  const problem = attempt(registry, vsix);
  if (problem !== "") {
    console.error(`publish-editor: ${registry.name} rejected the extension: ${problem}`);
    return { registry, state: "failed", detail: problem };
  }
  say(`published to ${registry.name}`);
  return { registry, state: "published", detail: "" };
}

function summarise(version, results) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) { return; }
  const rows = results.map((r) => `| ${r.registry.name} | ${r.state} | ${r.detail} |`);
  const lines = [
    `### Editor extension ${version}`,
    "",
    "| registry | result | detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ];
  fs.appendFileSync(file, lines.join("\n") + "\n");
}

function main() {
  const argv = process.argv.slice(2);
  const tag = (option(argv, "tag") || process.env.GITHUB_REF_NAME || "").trim();
  const version = withoutTagPrefix(tag);
  if (!RELEASE.test(version)) {
    say(`"${tag}" is not a release tag, so nothing is published. Only major.minor.patch tags reach a registry.`);
    return;
  }
  const vsix = path.resolve(ROOT, option(argv, "vsix") || path.join("dist", `joule-editor-${version}.vsix`));
  if (!fs.existsSync(vsix)) {
    fail(`${vsix} does not exist. Publishing takes the file the release already carries, and never packages its own.`);
  }
  say(`${path.relative(ROOT, vsix)} is the artifact for ${tag}`);
  const results = REGISTRIES.map((registry) => publish(registry, vsix));
  summarise(version, results);
  const failed = results.filter((r) => r.state === "failed");
  const published = results.filter((r) => r.state === "published");
  if (failed.length > 0 && published.length > 0) {
    fail(`${version} is on ${published.map((r) => r.registry.name).join(", ")} but not on ${failed.map((r) => r.registry.name).join(", ")}. The release is half published; retry the failed registry alone.`);
  }
  if (failed.length > 0) {
    fail(`${version} reached no registry: ${failed.map((r) => `${r.registry.name} (${r.detail})`).join(", ")}`);
  }
  if (published.length === 0) {
    say("no registry was configured, so this release is on GitHub only. docs/05-publishing.md says what to set up.");
  }
}

main();
