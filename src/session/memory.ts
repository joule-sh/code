import { homeDir } from "../vendor/platform/platform.ts";

export type MemoryEntry = { text: string, savedAt: string };
export type MemoryFile = { entries: MemoryEntry[] };
export type MemoryWriteResult = { ok: bool, message: string };

export const MAX_MEMORY_ENTRIES: int = 50;
export const MAX_ENTRY_BYTES: int = 300;
export const MAX_MEMORY_CONTEXT_BYTES: int = 4000;
export const MEMORY_SECRET_REFUSAL: string = "that looks like it contains a credential or token, refusing to save it.";

const MEMORY_LABEL: string = "What you remember about this user from earlier sessions (private to them, not shared with anyone else, may be incomplete or stale):\n\n";
const SECRET_MARKERS: string[] = ["sk-", "ghp_", "gho_", "github_pat_", "xox", "bearer ", "api_key", "apikey", "api key", "secret_key", "access_key", "private_key", "-----begin "];
const MIN_TOKEN_RUN: int = 20;

function emptyMemoryFile(): MemoryFile {
  let f: MemoryFile = { entries: [] };
  return f;
}

export function memoryDirPath(): string {
  let home = homeDir();
  return home + "/.config/joule-code";
}

export function memoryFilePath(): string {
  return memoryDirPath() + "/memory.json";
}

export function parseMemoryFile(text: string): MemoryFile | null {
  if (text.trim() == "") { return null; }
  try {
    return JSON.parse<MemoryFile>(text);
  } catch {
    return null;
  }
}

export function loadMemoryFile(filePath: string): MemoryFile {
  if (!fs.existsSync(filePath)) { return emptyMemoryFile(); }
  return parseMemoryFile(fs.readFileSync(filePath)) ?? emptyMemoryFile();
}

export function saveMemoryFile(filePath: string, file: MemoryFile): void {
  let dir = path.dirname(filePath);
  if (dir != "" && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, true);
  }
  let tmpPath = filePath + "." + `${Date.now()}` + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(file));
  fs.renameSync(tmpPath, filePath);
}

function hasLongToken(text: string): bool {
  let run = 0;
  let runHasDigit = false;
  let runHasAlpha = false;
  let i = 0;
  while (i < text.length) {
    let c = text.charCodeAt(i);
    let isDigit = c >= 48 && c <= 57;
    let isUpper = c >= 65 && c <= 90;
    let isLower = c >= 97 && c <= 122;
    let isTokenChar = isDigit || isUpper || isLower || c == 45 || c == 95;
    if (isTokenChar) {
      run = run + 1;
      if (isDigit) { runHasDigit = true; }
      if (isUpper || isLower) { runHasAlpha = true; }
      if (run >= MIN_TOKEN_RUN && runHasDigit && runHasAlpha) { return true; }
    } else {
      run = 0;
      runHasDigit = false;
      runHasAlpha = false;
    }
    i = i + 1;
  }
  return false;
}

export function looksLikeSecret(text: string): bool {
  let lower = text.toLowerCase();
  for (const marker of SECRET_MARKERS) {
    if (lower.indexOf(marker) >= 0) { return true; }
  }
  return hasLongToken(text);
}

function capEntries(entries: MemoryEntry[]): MemoryEntry[] {
  if (entries.length <= MAX_MEMORY_ENTRIES) { return entries; }
  return entries.slice(entries.length - MAX_MEMORY_ENTRIES, entries.length);
}

function appendEntry(entries: MemoryEntry[], e: MemoryEntry): MemoryEntry[] {
  let out: MemoryEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    out.push(entries[i]);
    i = i + 1;
  }
  out.push(e);
  return out;
}

function withoutIndex(entries: MemoryEntry[], idx: int): MemoryEntry[] {
  let out: MemoryEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    if (i != idx) { out.push(entries[i]); }
    i = i + 1;
  }
  return out;
}

export function addMemoryEntryText(filePath: string, rawText: string): MemoryWriteResult {
  let text = rawText.trim();
  if (text == "") {
    let r: MemoryWriteResult = { ok: false, message: "usage: /memory add <text>" };
    return r;
  }
  if (looksLikeSecret(text)) {
    let r: MemoryWriteResult = { ok: false, message: MEMORY_SECRET_REFUSAL };
    return r;
  }
  if (text.length > MAX_ENTRY_BYTES) {
    let r: MemoryWriteResult = { ok: false, message: "that's " + `${text.length}` + " bytes, over the " + `${MAX_ENTRY_BYTES}` + "-byte limit for one memory entry; shorten it." };
    return r;
  }
  let file = loadMemoryFile(filePath);
  let entry: MemoryEntry = { text: text, savedAt: `${Date.now()}` };
  let entries = capEntries(appendEntry(file.entries, entry));
  saveMemoryFile(filePath, { entries: entries });
  let r: MemoryWriteResult = { ok: true, message: "remembered." };
  return r;
}

export function removeMemoryEntryAt(filePath: string, oneBasedIndex: int): bool {
  let file = loadMemoryFile(filePath);
  let idx = oneBasedIndex - 1;
  if (idx < 0 || idx >= file.entries.length) { return false; }
  saveMemoryFile(filePath, { entries: withoutIndex(file.entries, idx) });
  return true;
}

export function clearMemoryFile(filePath: string): void {
  saveMemoryFile(filePath, emptyMemoryFile());
}

export function listMemoryText(filePath: string): string {
  let file = loadMemoryFile(filePath);
  if (file.entries.length == 0) {
    return "\nnothing remembered yet. /memory add <text> to add something, or edit " + filePath + " by hand.";
  }
  let out = "\nwhat joule remembers about you (" + filePath + "):";
  let i = 0;
  while (i < file.entries.length) {
    out = out + "\n  " + `${i + 1}` + ". " + file.entries[i].text;
    i = i + 1;
  }
  return out;
}

export function buildMemoryContext(entries: MemoryEntry[]): string {
  let safe: MemoryEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    if (!looksLikeSecret(entries[i].text)) { safe.push(entries[i]); }
    i = i + 1;
  }
  if (safe.length == 0) { return ""; }

  let kept: string[] = [];
  let total = 0;
  let j = safe.length - 1;
  while (j >= 0) {
    let line = "- " + safe[j].text;
    let added = line.length + 1;
    if (total + added > MAX_MEMORY_CONTEXT_BYTES) { break; }
    kept.push(line);
    total = total + added;
    j = j - 1;
  }

  let ordered: string[] = [];
  let k = kept.length - 1;
  while (k >= 0) {
    ordered.push(kept[k]);
    k = k - 1;
  }
  return MEMORY_LABEL + ordered.join("\n");
}

export function loadUserMemoryText(filePath: string): string {
  return buildMemoryContext(loadMemoryFile(filePath).entries);
}
