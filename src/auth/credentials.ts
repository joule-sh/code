import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { normalizeServer } from "./server.ts";
import { chmodPath, homeDir } from "../vendor/platform/platform.ts";

const DIR_MODE: int = 0o700;
const FILE_MODE: int = 0o600;

export const SOURCE_ENV: string = "env";
export const SOURCE_JOULE: string = "joule";
export const SOURCE_FILE: string = "file";
export const SOURCE_NONE: string = "none";

export type Credential = {
  server: string, secret: string, accountId: string, accountEmail: string,
  keyId: string, keyPrefix: string, scopes: string, savedAt: string,
  relayUrl: string, relayWsUrl: string, webUrl: string,
};

export function emptyCredential(): Credential {
  let c: Credential = {
    server: "", secret: "", accountId: "", accountEmail: "",
    keyId: "", keyPrefix: "", scopes: "", savedAt: "",
    relayUrl: "", relayWsUrl: "", webUrl: "",
  };
  return c;
}

export function credentialsDir(): string {
  let home = homeDir();
  return home + "/.config/joule-code";
}

export function credentialsPath(): string {
  return credentialsDir() + "/credentials.jsonl";
}

export function credentialLine(c: Credential): string {
  return JSON.stringify(c);
}

export function parseCredentialLine(line: string): Credential {
  let text = line.trim();
  if (!text.startsWith("{")) { return emptyCredential(); }
  let c: Credential = {
    server: jsonStringMemberAt(text, 0, "server"),
    secret: jsonStringMemberAt(text, 0, "secret"),
    accountId: jsonStringMemberAt(text, 0, "accountId"),
    accountEmail: jsonStringMemberAt(text, 0, "accountEmail"),
    keyId: jsonStringMemberAt(text, 0, "keyId"),
    keyPrefix: jsonStringMemberAt(text, 0, "keyPrefix"),
    scopes: jsonStringMemberAt(text, 0, "scopes"),
    savedAt: jsonStringMemberAt(text, 0, "savedAt"),
    relayUrl: jsonStringMemberAt(text, 0, "relayUrl"),
    relayWsUrl: jsonStringMemberAt(text, 0, "relayWsUrl"),
    webUrl: jsonStringMemberAt(text, 0, "webUrl"),
  };
  return c;
}

export function findCredentialIn(text: string, server: string): Credential {
  let want = normalizeServer(server);
  let found = emptyCredential();
  if (want == "") { return found; }
  for (const line of text.split("\n")) {
    let c = parseCredentialLine(line);
    if (c.secret != "" && normalizeServer(c.server) == want) { found = c; }
  }
  return found;
}

export function removeCredentialIn(text: string, server: string): string {
  let want = normalizeServer(server);
  let out = "";
  for (const line of text.split("\n")) {
    let c = parseCredentialLine(line);
    if (c.secret == "") { continue; }
    if (want != "" && normalizeServer(c.server) == want) { continue; }
    out = out + line.trim() + "\n";
  }
  return out;
}

export function upsertCredentialIn(text: string, c: Credential): string {
  return removeCredentialIn(text, c.server) + credentialLine(c) + "\n";
}

export function readCredentialsFile(filePath: string): string {
  if (!fs.existsSync(filePath)) { return ""; }
  return fs.readFileSync(filePath);
}

export function writeSecretFile(filePath: string, text: string): void {
  let dir = path.dirname(filePath);
  if (dir != "") {
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, true); }
    chmodPath(dir, DIR_MODE);
  }
  let tmpPath = filePath + "." + `${Date.now()}` + ".tmp";
  fs.writeFileSync(tmpPath, "");
  chmodPath(tmpPath, FILE_MODE);
  fs.writeFileSync(tmpPath, text);
  fs.renameSync(tmpPath, filePath);
}

export function loadCredentialFrom(filePath: string, server: string): Credential {
  return findCredentialIn(readCredentialsFile(filePath), server);
}

export function saveCredentialTo(filePath: string, c: Credential): void {
  writeSecretFile(filePath, upsertCredentialIn(readCredentialsFile(filePath), c));
}

export function forgetCredentialIn(filePath: string, server: string): bool {
  let before = readCredentialsFile(filePath);
  if (findCredentialIn(before, server).secret == "") { return false; }
  writeSecretFile(filePath, removeCredentialIn(before, server));
  return true;
}

export function loadCredential(server: string): Credential {
  return loadCredentialFrom(credentialsPath(), server);
}

export function saveCredential(c: Credential): void {
  saveCredentialTo(credentialsPath(), c);
}

export function forgetCredential(server: string): bool {
  return forgetCredentialIn(credentialsPath(), server);
}

export function credentialSource(envApiKey: string, jouleSecret: string, fileApiKey: string): string {
  if (envApiKey != "") { return SOURCE_ENV; }
  if (jouleSecret != "") { return SOURCE_JOULE; }
  if (fileApiKey != "") { return SOURCE_FILE; }
  return SOURCE_NONE;
}

export function accountLabel(c: Credential): string {
  if (c.accountEmail != "") { return c.accountEmail; }
  if (c.accountId != "") { return c.accountId; }
  return "an unnamed account";
}

export function serversIn(text: string, exclude: string): string[] {
  let skip = normalizeServer(exclude);
  let out: string[] = [];
  for (const line of text.split("\n")) {
    let c = parseCredentialLine(line);
    if (c.secret == "") { continue; }
    let base = normalizeServer(c.server);
    if (base == "" || base == skip) { continue; }
    let seen = false;
    for (const known of out) {
      if (known == base) { seen = true; }
    }
    if (!seen) { out.push(base); }
  }
  return out;
}

export function otherServers(exclude: string): string[] {
  return serversIn(readCredentialsFile(credentialsPath()), exclude);
}
