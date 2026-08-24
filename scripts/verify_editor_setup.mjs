import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setup = (await import(pathToFileURL(path.join(ROOT, "editor", "src", "setup.js")).href)).default;

const SECRET = "sk-do-not-leak-this-one";
const TOKEN = "joule-credential-do-not-leak-this-one";

let failures = 0;
const homes = [];

function ok(condition, label) {
  if (condition) {
    console.log("ok: " + label);
    return;
  }
  console.error("FAIL: " + label);
  failures += 1;
}

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "joule-editor-setup-"));
  fs.mkdirSync(path.join(home, ".config", "joule-code"), { recursive: true });
  homes.push(home);
  return { HOME: home };
}

function writeConfig(env, body) {
  fs.writeFileSync(setup.configPath(env), JSON.stringify(body, null, 2) + "\n");
}

function writeCredential(env, server) {
  fs.writeFileSync(setup.credentialsPath(env), JSON.stringify({
    server, secret: TOKEN, accountId: "acct_1", accountEmail: "someone@example.com",
    keyId: "k1", keyPrefix: "jk_", scopes: "code", savedAt: "2026-01-01T00:00:00Z",
  }) + "\n");
}

function said(state) {
  return JSON.stringify(state);
}

const bare = makeHome();
const nothing = setup.setupState(bare);
ok(nothing.configured === false, "a machine with no config and no account is not configured, so the panel opens on the first run");
ok(nothing.keySource === setup.SOURCE_NONE, "nothing claims to be the source of a key that does not exist");
ok(nothing.server === "https://joule.sh" && nothing.serverIsDefault === true, "the default server is joule.sh");
ok(nothing.configPath.endsWith(path.join(".config", "joule-code", "config.json")),
  "the config file is the one the CLI writes, not a second one for the editor");

const keyed = makeHome();
writeConfig(keyed, { baseUrl: "https://api.example.com/v1", model: "a-model", apiKey: SECRET });
const withKey = setup.setupState(keyed);
ok(withKey.configured === true, "a provider key in the config file is enough to get past the first-run screen");
ok(withKey.keySource === setup.SOURCE_FILE, "the key is reported as coming from the file");
ok(withKey.baseUrl === "https://api.example.com/v1" && withKey.model === "a-model",
  "the base url and model are read, since neither is a secret");
ok(!said(withKey).includes(SECRET), "the key itself never leaves setup.js, so it cannot reach the webview");

const fromEnv = setup.setupState({ HOME: keyed.HOME, JOULE_CODE_API_KEY: SECRET, JOULE_CODE_MODEL: "env-model" });
ok(fromEnv.keySource === setup.SOURCE_ENV, "an environment key is what the window is actually using, and is named as such");
ok(fromEnv.model === "env-model", "the environment wins over the file for the model too");
ok(!said(fromEnv).includes(SECRET), "an environment key is not copied into the panel's state either");

const account = makeHome();
writeCredential(account, "https://joule.sh");
const signedIn = setup.setupState(account);
ok(signedIn.configured === true, "an account credential counts as configured, without a provider key");
ok(signedIn.account === "someone@example.com", "the account is named by the address it was signed in with");
ok(signedIn.reachesModelBy === setup.SOURCE_ACCOUNT, "the panel can say a model is reached through the account");
ok(!said(signedIn).includes(TOKEN), "the credential's secret never reaches the panel's state");

const elsewhere = makeHome();
writeCredential(elsewhere, "https://joule.example.com");
const other = setup.setupState(elsewhere);
ok(other.configured === false,
  "a credential for another server does not count as being signed in to the one this machine uses");
const pinned = setup.setupState({ HOME: elsewhere.HOME, JOULE_CODE_SERVER: "https://joule.example.com/" });
ok(pinned.server === "https://joule.example.com" && pinned.serverIsDefault === false,
  "JOULE_CODE_SERVER picks the server, trailing slash and all");
ok(pinned.serverSource === setup.SOURCE_ENV, "the panel can say where the server address came from");
ok(pinned.configured === true, "with that server chosen, the credential for it is the one that counts");

const remembering = makeHome();
writeConfig(remembering, { baseUrl: "https://api.example.com/v1", apiKey: SECRET });
setup.rememberServer(remembering, "https://joule.example.com/");
const kept = JSON.parse(fs.readFileSync(setup.configPath(remembering), "utf8"));
ok(kept.server === "https://joule.example.com", "a self-hosted server is remembered in the config file");
ok(kept.apiKey === SECRET, "remembering a server leaves the key that was already there untouched");
ok(setup.setupState(remembering).serverSource === setup.SOURCE_FILE, "the remembered server is the one the panel then reports");

const created = makeHome();
const file = setup.ensureConfigFile(created);
ok(fs.existsSync(file), "the provider-key route can open a config file on a machine that has none");
ok(JSON.parse(fs.readFileSync(file, "utf8")).apiKey === "", "the file it creates carries an empty key, never one it invented");
ok(process.platform === "win32" || (fs.statSync(file).mode & 0o777) === 0o600,
  "the config file it creates is readable only by its owner, where the file system has an opinion");

for (const home of homes) { fs.rmSync(home, { recursive: true, force: true }); }

if (failures > 0) {
  console.error("FAIL: " + failures + " check(s) failed");
  process.exit(1);
}
console.log("PASS: the panel can tell what this machine is configured with, and never carries a secret while doing it");
