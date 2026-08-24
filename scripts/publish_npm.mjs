import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = /^\d+\.\d+\.\d+$/;
const SECRET = "NPM_TOKEN";
const REGISTRY = "https://registry.npmjs.org/";
const AUTH_LINE = "//registry.npmjs.org/:_authToken=${" + SECRET + "}";

function say(message) {
  console.log("publish-npm: " + message);
}

function fail(message) {
  console.error("publish-npm: " + message);
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

function npm(args, userconfig) {
  const result = spawnSync("npm", args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, npm_config_userconfig: userconfig },
    shell: process.platform === "win32",
  });
  if (result.error) { return { ok: false, detail: "could not run npm: " + result.error.message }; }
  const output = ((result.stdout || "") + (result.stderr || "")).trim();
  if (result.status !== 0) { return { ok: false, detail: output === "" ? `npm ${args[0]} exited ${result.status}` : output }; }
  return { ok: true, detail: output };
}

function alreadyPublished(name, version, userconfig) {
  const result = npm(["view", `${name}@${version}`, "version", "--registry", REGISTRY], userconfig);
  return result.ok && result.detail !== "";
}

function publish(entry, version, dir, userconfig) {
  const tarball = path.join(dir, entry.file);
  if (!fs.existsSync(tarball)) {
    return { ...entry, state: "failed", detail: `${entry.file} is not in ${dir}` };
  }
  if (alreadyPublished(entry.name, version, userconfig)) {
    say(`${entry.name}@${version} is already on the registry, so it was left alone`);
    return { ...entry, state: "present", detail: "already published" };
  }
  say(`publishing ${entry.name}@${version} from ${entry.file}`);
  const result = npm(["publish", tarball, "--access", "public", "--registry", REGISTRY], userconfig);
  if (!result.ok) {
    console.error(`publish-npm: the registry rejected ${entry.name}: ${result.detail}`);
    return { ...entry, state: "failed", detail: result.detail.split("\n")[0] };
  }
  say(`published ${entry.name}@${version}`);
  return { ...entry, state: "published", detail: "" };
}

function summarise(version, results) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) { return; }
  const rows = results.map((r) => `| ${r.name} | ${r.state} | ${r.detail} |`);
  fs.appendFileSync(file, [
    `### npm ${version}`,
    "",
    "| package | result | detail |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n") + "\n");
}

function readPackages(dir) {
  const listing = path.join(dir, "packages.json");
  if (!fs.existsSync(listing)) {
    fail(`${listing} does not exist. Publishing takes the tarballs the release already built, and never packs its own.`);
  }
  const parsed = JSON.parse(fs.readFileSync(listing, "utf8"));
  const platforms = parsed.packages.filter((p) => p.kind === "platform");
  const wrappers = parsed.packages.filter((p) => p.kind === "wrapper");
  if (platforms.length === 0 || wrappers.length !== 1) {
    fail(`${listing} must list at least one platform package and exactly one wrapper`);
  }
  return { version: parsed.version, platforms, wrapper: wrappers[0] };
}

function main() {
  const argv = process.argv.slice(2);
  const tag = (option(argv, "tag") || process.env.GITHUB_REF_NAME || "").trim();
  const version = withoutTagPrefix(tag);
  if (!RELEASE.test(version)) {
    say(`"${tag}" is not a release tag, so nothing is published. Only major.minor.patch tags reach the registry.`);
    return;
  }
  const token = (process.env[SECRET] || "").trim();
  if (token === "") {
    say(`no ${SECRET} secret is set, so nothing was published to npm and this release is on GitHub only.`);
    say("docs/05-publishing.md says what the token needs behind it.");
    return;
  }
  const dir = path.resolve(ROOT, option(argv, "dir") || path.join("dist", "npm"));
  const listing = readPackages(dir);
  if (listing.version !== version) {
    fail(`${dir} holds ${listing.version} but the tag is ${tag}. The tarballs and the tag have to be the same version.`);
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "joule-npmrc-"));
  const userconfig = path.join(work, "npmrc");
  fs.writeFileSync(userconfig, AUTH_LINE + "\n", { mode: 0o600 });
  const results = [];
  try {
    for (const entry of listing.platforms) {
      results.push(publish(entry, version, dir, userconfig));
    }
    const stopped = results.filter((r) => r.state === "failed");
    if (stopped.length === 0) {
      results.push(publish(listing.wrapper, version, dir, userconfig));
    } else {
      results.push({ ...listing.wrapper, state: "held back", detail: "a platform package did not publish" });
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  summarise(version, results);
  const failed = results.filter((r) => r.state === "failed");
  if (failed.length > 0) {
    fail([
      `${failed.map((r) => r.name).join(", ")} did not publish, so ${listing.wrapper.name}@${version} was held back deliberately.`,
      "A wrapper whose optional dependency is missing installs and then cannot run, and npm only lets you take a version back within 72 hours.",
      "Fix the cause and re-run this job: every package already on the registry is skipped, so a re-run finishes what this one started.",
    ].join("\n"));
  }
  const published = results.filter((r) => r.state === "published");
  if (published.length === 0) {
    say(`every package was already on the registry at ${version}, so this run changed nothing.`);
    return;
  }
  say(`${version} is on npm: install it with "npm i -g ${listing.wrapper.name}"`);
}

main();
