const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_SERVER = "https://joule.sh";
const SERVER_ENV = "JOULE_CODE_SERVER";
const KEY_ENV = "JOULE_CODE_API_KEY";
const BASE_URL_ENV = "JOULE_CODE_BASE_URL";
const MODEL_ENV = "JOULE_CODE_MODEL";
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

const SOURCE_ENV = "env";
const SOURCE_FILE = "file";
const SOURCE_ACCOUNT = "account";
const SOURCE_DEFAULT = "default";
const SOURCE_NONE = "none";

function homeDir(env) {
  const e = env || process.env;
  return e.HOME || e.USERPROFILE || os.homedir();
}

function configDir(env) {
  return path.join(homeDir(env), ".config", "joule-code");
}

function configPath(env) {
  return path.join(configDir(env), "config.json");
}

function credentialsPath(env) {
  return path.join(configDir(env), "credentials.jsonl");
}

function readJsonFile(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    void e;
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    void e;
    return null;
  }
}

function stringMember(parsed, name) {
  if (parsed === null) { return ""; }
  return typeof parsed[name] === "string" ? parsed[name].trim() : "";
}

function normalizeServer(raw) {
  const text = String(raw || "").trim().replace(/\/+$/, "");
  const at = text.indexOf("://");
  if (at < 0) { return text; }
  const scheme = text.slice(0, at).toLowerCase();
  const rest = text.slice(at + 3);
  const slash = rest.indexOf("/");
  if (slash < 0) { return scheme + "://" + rest.toLowerCase(); }
  return scheme + "://" + rest.slice(0, slash).toLowerCase() + rest.slice(slash);
}

function configFacts(env) {
  const file = configPath(env);
  const parsed = readJsonFile(file);
  return {
    path: file,
    exists: parsed !== null,
    hasApiKey: stringMember(parsed, "apiKey") !== "",
    baseUrl: stringMember(parsed, "baseUrl"),
    model: stringMember(parsed, "model"),
    server: stringMember(parsed, "server"),
  };
}

function accountsIn(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) { continue; }
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      void e;
      continue;
    }
    if (parsed === null || typeof parsed !== "object") { continue; }
    if (typeof parsed.secret !== "string" || parsed.secret === "") { continue; }
    out.push({
      server: normalizeServer(parsed.server),
      label: typeof parsed.accountEmail === "string" && parsed.accountEmail !== ""
        ? parsed.accountEmail
        : (typeof parsed.accountId === "string" && parsed.accountId !== "" ? parsed.accountId : "an unnamed account"),
    });
  }
  return out;
}

function accounts(env) {
  let text = "";
  try {
    text = fs.readFileSync(credentialsPath(env), "utf8");
  } catch (e) {
    void e;
    return [];
  }
  return accountsIn(text);
}

function serverChoice(env, file) {
  const e = env || process.env;
  const fromEnv = String(e[SERVER_ENV] || "").trim();
  if (fromEnv !== "") { return { url: normalizeServer(fromEnv), source: SOURCE_ENV }; }
  if (file.server !== "") { return { url: normalizeServer(file.server), source: SOURCE_FILE }; }
  return { url: normalizeServer(DEFAULT_SERVER), source: SOURCE_DEFAULT };
}

function keyChoice(env, file) {
  const e = env || process.env;
  if (String(e[KEY_ENV] || "").trim() !== "") { return SOURCE_ENV; }
  if (file.hasApiKey) { return SOURCE_FILE; }
  return SOURCE_NONE;
}

function setupState(env) {
  const e = env || process.env;
  const file = configFacts(e);
  const server = serverChoice(e, file);
  const signedInAs = accounts(e).filter((a) => a.server === server.url).map((a) => a.label);
  const keySource = keyChoice(e, file);
  const baseUrl = String(e[BASE_URL_ENV] || "").trim() || file.baseUrl;
  return {
    configured: keySource !== SOURCE_NONE || signedInAs.length > 0,
    reachesModelBy: keySource !== SOURCE_NONE ? keySource : (signedInAs.length > 0 ? SOURCE_ACCOUNT : SOURCE_NONE),
    keySource,
    baseUrl,
    model: String(e[MODEL_ENV] || "").trim() || file.model,
    account: signedInAs.length > 0 ? signedInAs[0] : "",
    server: server.url,
    serverSource: server.source,
    serverIsDefault: server.url === normalizeServer(DEFAULT_SERVER),
    configPath: file.path,
    configExists: file.exists,
    serverEnv: SERVER_ENV,
  };
}

function rememberServer(env, url) {
  const file = configPath(env);
  const kept = readJsonFile(file) || {};
  kept.server = normalizeServer(url);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: DIR_MODE });
  fs.writeFileSync(file, JSON.stringify(kept, null, 2) + "\n", { mode: FILE_MODE });
  return kept.server;
}

function ensureConfigFile(env) {
  const file = configPath(env);
  if (fs.existsSync(file)) { return file; }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: DIR_MODE });
  fs.writeFileSync(file, JSON.stringify({ baseUrl: "", model: "", apiKey: "" }, null, 2) + "\n", { mode: FILE_MODE });
  return file;
}

module.exports = {
  DEFAULT_SERVER,
  SERVER_ENV,
  KEY_ENV,
  SOURCE_ENV,
  SOURCE_FILE,
  SOURCE_ACCOUNT,
  SOURCE_DEFAULT,
  SOURCE_NONE,
  accountsIn,
  configPath,
  credentialsPath,
  configFacts,
  normalizeServer,
  setupState,
  rememberServer,
  ensureConfigFile,
};
