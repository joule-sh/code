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

export function sessionKeyFor(workspaceRoot: string): string {
  let slug = sanitizeForFilename(workspaceRoot);
  if (slug.length > SLUG_MAX_LEN) {
    slug = slug.slice(slug.length - SLUG_MAX_LEN, slug.length);
  }
  let suffix = hexEncode(crypto.sha1Bytes(workspaceRoot), KEY_HASH_BYTES);
  return slug + "-" + suffix;
}

export function sessionsDir(): string {
  let home = homeDir();
  return home + "/.config/joule-code/sessions";
}

export function sessionFilePath(workspaceRoot: string): string {
  return sessionsDir() + "/" + sessionKeyFor(workspaceRoot) + ".json";
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

export function saveWorkspaceSession(workspaceRoot: string, history: Message[]): void {
  let file: SessionFile = { workspace: workspaceRoot, savedAt: `${Date.now()}`, history: history };
  saveSessionFile(sessionFilePath(workspaceRoot), file);
}

export function loadWorkspaceSession(workspaceRoot: string): SessionFile | null {
  return loadSessionFile(sessionFilePath(workspaceRoot));
}
