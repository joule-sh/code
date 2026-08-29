import { Message } from "./types.ts";
import { homeDir } from "../vendor/platform/platform.ts";

const HEX_DIGITS: string = "0123456789abcdef";
const SAFE_CHARS: string = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
const SLUG_MAX_LEN: int = 60;
const KEY_HASH_BYTES: int = 8;

export type SessionFile = { workspace: string, savedAt: string, history: Message[] };

function sanitizeForFilename(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    let ch = s.charAt(i);
    if (SAFE_CHARS.indexOf(ch) >= 0) {
      out = out + ch;
    } else {
      out = out + "-";
    }
    i = i + 1;
  }
  return out;
}

function hexEncode(bytes: string, maxBytes: int): string {
  let out = "";
  let i = 0;
  while (i < bytes.length && i < maxBytes) {
    let c = bytes.charCodeAt(i);
    let hi = c / 16;
    let lo = c % 16;
    out = out + HEX_DIGITS.charAt(hi) + HEX_DIGITS.charAt(lo);
    i = i + 1;
  }
  return out;
}

// The key a workspace path (plus, since #331, an optional session name)
// resolves to everywhere identity matters: the persisted history file, the
// daemon's info/log paths, its runtime dir, and the port it listens on. name
// == "" reproduces the pre-#331 key byte for byte - the slug and the hash
// input are both exactly what they always were - so nothing already on disk
// is orphaned by upgrading. A named session gets its own slug tail (purely
// for a human scanning the directory - the hash is what actually
// disambiguates) and its own hash, salted so "path A, session BC" can never
// collide with "path AB, session C".
export function sessionKeyFor(workspaceRoot: string, name: string): string {
  let slug = sanitizeForFilename(workspaceRoot);
  if (slug.length > SLUG_MAX_LEN) {
    slug = slug.slice(slug.length - SLUG_MAX_LEN, slug.length);
  }
  let hashInput = workspaceRoot;
  if (name != "") {
    slug = slug + "-" + sanitizeForFilename(name);
    hashInput = workspaceRoot + " session:" + name;
  }
  let suffix = hexEncode(crypto.sha1Bytes(hashInput), KEY_HASH_BYTES);
  return slug + "-" + suffix;
}

// What a message says about which session it means, appended after the
// workspace path - "" for the default session, so every existing message
// stays byte-identical. Shared by the daemon's own log line and every
// attach/stop/reap note that names a workspace, so a person always reads the
// same phrase for the same session.
export function describeSessionSuffix(name: string): string {
  if (name == "") { return ""; }
  return " (session " + name + ")";
}

export function sessionsDir(): string {
  let home = homeDir();
  return home + "/.config/joule-code/sessions";
}

export function sessionFilePath(workspaceRoot: string, name: string): string {
  return sessionsDir() + "/" + sessionKeyFor(workspaceRoot, name) + ".json";
}

export function parseSessionFile(text: string): SessionFile | null {
  if (text.trim() == "") { return null; }
  try {
    return JSON.parse<SessionFile>(text);
  } catch {
    return null;
  }
}

export function loadSessionFile(filePath: string): SessionFile | null {
  if (!fs.existsSync(filePath)) { return null; }
  return parseSessionFile(fs.readFileSync(filePath));
}

export function saveSessionFile(filePath: string, file: SessionFile): void {
  let dir = path.dirname(filePath);
  if (dir != "" && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, true);
  }
  let tmpPath = filePath + "." + `${Date.now()}` + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(file));
  fs.renameSync(tmpPath, filePath);
}

export function saveWorkspaceSession(workspaceRoot: string, name: string, history: Message[]): void {
  let file: SessionFile = { workspace: workspaceRoot, savedAt: `${Date.now()}`, history: history };
  saveSessionFile(sessionFilePath(workspaceRoot, name), file);
}

export function loadWorkspaceSession(workspaceRoot: string, name: string): SessionFile | null {
  return loadSessionFile(sessionFilePath(workspaceRoot, name));
}
