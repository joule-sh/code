import { homeDir } from "../vendor/platform/platform.ts";
import { parseFrontmatter, fieldValue } from "./frontmatter.ts";

export type MemoryEntry = { text: string, savedAt: string, path: string, refused: bool };
export type MemoryWriteResult = { ok: bool, message: string };

export const MAX_MEMORY_ENTRIES: int = 50;
export const MAX_ENTRY_BYTES: int = 300;
export const MAX_MEMORY_CONTEXT_BYTES: int = 4000;
export const MEMORY_SECRET_REFUSAL: string = "that looks like it contains a credential or token, refusing to save it.";
export const MEMORY_SECRET_SKIPPED: string = "not loaded: this file looks like it holds a credential or token";

const MEMORY_LABEL: string = "What you remember about this user from earlier sessions (private to them, not shared with anyone else, may be incomplete or stale):\n\n";
const SECRET_MARKERS: string[] = ["sk-", "ghp_", "gho_", "github_pat_", "xox", "bearer ", "api_key", "apikey", "api key", "secret_key", "access_key", "private_key", "-----begin "];
const MIN_TOKEN_RUN: int = 20;
const SAVED_AT_KEY: string = "savedat";

export function memoryDirPath(): string {
  return homeDir() + "/.config/joule-code";
}

export function memoryStorePath(): string {
  return memoryDirPath() + "/memory";
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

function slugFor(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length && out.length < 40) {
    let ch = text.slice(i, i + 1);
    let c = text.charCodeAt(i);
    let isDigit = c >= 48 && c <= 57;
    let isLower = c >= 97 && c <= 122;
    let isUpper = c >= 65 && c <= 90;
    if (isDigit || isLower) {
      out = out + ch;
    } else if (isUpper) {
      out = out + ch.toLowerCase();
    } else if (out.length > 0 && !out.endsWith("-")) {
      out = out + "-";
    }
    i = i + 1;
  }
  while (out.endsWith("-")) { out = out.slice(0, out.length - 1); }
  if (out == "") { return "memory"; }
  return out;
}

function entryFilePath(dir: string, savedAt: string, text: string): string {
  let base = dir + "/" + savedAt + "-" + slugFor(text);
  let candidate = base + ".md";
  let n = 2;
  while (fs.existsSync(candidate) && n < 1000) {
    candidate = base + "-" + `${n}` + ".md";
    n = n + 1;
  }
  return candidate;
}

export function saveMemoryEntry(dir: string, text: string, savedAt: string): string {
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, true); }
  let target = entryFilePath(dir, savedAt, text);
  let tmpPath = target + "." + savedAt + ".tmp";
  fs.writeFileSync(tmpPath, "---\nsavedAt: " + savedAt + "\n---\n" + text + "\n");
  fs.renameSync(tmpPath, target);
  return target;
}

function savedAtOf(e: MemoryEntry): i64 {
  return Number.parseInt(e.savedAt, 10) ?? 0;
}

function pathLess(a: string, b: string): bool {
  let i = 0;
  while (i < a.length && i < b.length) {
    let ca = a.charCodeAt(i);
    let cb = b.charCodeAt(i);
    if (ca != cb) { return ca < cb; }
    i = i + 1;
  }
  return a.length < b.length;
}

function entryBefore(a: MemoryEntry, b: MemoryEntry): bool {
  let sa = savedAtOf(a);
  let sb = savedAtOf(b);
  if (sa != sb) { return sa < sb; }
  return pathLess(a.path, b.path);
}

function insertSorted(list: MemoryEntry[], e: MemoryEntry): MemoryEntry[] {
  let out: MemoryEntry[] = [];
  let placed = false;
  for (const cur of list) {
    if (!placed && entryBefore(e, cur)) {
      out.push(e);
      placed = true;
    }
    out.push(cur);
  }
  if (!placed) { out.push(e); }
  return out;
}

export function parseMemoryEntry(raw: string, filePath: string): MemoryEntry[] {
  let out: MemoryEntry[] = [];
  let fm = parseFrontmatter(raw);
  let text = raw.trim();
  let savedAt = "";
  if (fm.ok) {
    text = fm.body;
    savedAt = fieldValue(fm.fields, SAVED_AT_KEY).trim();
  }
  if (text == "") { return out; }
  let e: MemoryEntry = { text: text, savedAt: savedAt, path: filePath, refused: looksLikeSecret(text) };
  out.push(e);
  return out;
}

export function loadMemoryDir(dir: string): MemoryEntry[] {
  let sorted: MemoryEntry[] = [];
  if (!fs.existsSync(dir)) { return sorted; }
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md")) { continue; }
    let full = dir + "/" + name;
    for (const e of parseMemoryEntry(fs.readFileSync(full), full)) {
      sorted = insertSorted(sorted, e);
    }
  }
  return sorted;
}

export function addMemoryEntryText(dir: string, rawText: string): MemoryWriteResult {
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
  saveMemoryEntry(dir, text, `${Date.now()}`);
  let r: MemoryWriteResult = { ok: true, message: "remembered." };
  return r;
}

export function removeMemoryEntryAt(dir: string, oneBasedIndex: int): bool {
  let entries = loadMemoryDir(dir);
  let idx = oneBasedIndex - 1;
  if (idx < 0 || idx >= entries.length) { return false; }
  fs.unlinkSync(entries[idx].path);
  return true;
}

export function clearMemoryDir(dir: string): void {
  if (!fs.existsSync(dir)) { return; }
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".md")) { continue; }
    fs.unlinkSync(dir + "/" + name);
  }
}

export function listMemoryText(dir: string): string {
  let entries = loadMemoryDir(dir);
  if (entries.length == 0) {
    return "\nnothing remembered yet. /memory add <text> to add something, or write a markdown file into " + dir + " by hand.";
  }
  let out = "\nwhat joule remembers about you (" + dir + "):";
  let i = 0;
  while (i < entries.length) {
    out = out + "\n  " + `${i + 1}` + ". ";
    if (entries[i].refused) {
      out = out + "[" + MEMORY_SECRET_SKIPPED + "] " + entries[i].path;
    } else {
      out = out + entries[i].text;
    }
    i = i + 1;
  }
  return out;
}

export function buildMemoryContext(entries: MemoryEntry[]): string {
  let safe: MemoryEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    if (!entries[i].refused && !looksLikeSecret(entries[i].text)) { safe.push(entries[i]); }
    i = i + 1;
  }
  if (safe.length == 0) { return ""; }

  let kept: string[] = [];
  let total = 0;
  let taken = 0;
  let j = safe.length - 1;
  while (j >= 0 && taken < MAX_MEMORY_ENTRIES) {
    let line = "- " + safe[j].text;
    let added = line.length + 1;
    if (total + added > MAX_MEMORY_CONTEXT_BYTES) { break; }
    kept.push(line);
    total = total + added;
    taken = taken + 1;
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

export function loadUserMemoryText(dir: string): string {
  return buildMemoryContext(loadMemoryDir(dir));
}
