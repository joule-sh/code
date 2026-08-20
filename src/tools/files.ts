import { jail } from "./jail.ts";

const DEFAULT_READ_LIMIT: int = 2000;
const MAX_GREP_MATCHES: int = 200;

export type ReadResult = { ok: bool, content: string, truncated: bool, error: string };
export type WriteResult = { ok: bool, error: string };
export type EditResult = { ok: bool, error: string };
export type ListResult = { ok: bool, entries: string[], error: string };
export type GrepMatch = { file: string, line: int, text: string };
export type GrepResult = { ok: bool, matches: GrepMatch[], truncated: bool, error: string };

function joinLines(lines: string[]): string {
  let out = "";
  let i = 0;
  while (i < lines.length) {
    if (i > 0) { out = out + "\n"; }
    out = out + lines[i];
    i = i + 1;
  }
  return out;
}

export function readFile(root: string, relPath: string, offset: int, limit: int): ReadResult {
  let j = jail(root, relPath);
  if (!j.ok) {
    return { ok: false, content: "", truncated: false, error: "path escapes the workspace root" };
  }
  if (!fs.existsSync(j.path)) {
    return { ok: false, content: "", truncated: false, error: "no such file" };
  }
  let full = fs.readFileSync(j.path);
  let lines = full.split("\n");

  let start = offset;
  if (start < 0) { start = 0; }
  if (start >= lines.length) {
    return { ok: true, content: "", truncated: false, error: "" };
  }

  let cap = limit;
  if (cap <= 0) { cap = DEFAULT_READ_LIMIT; }
  let end = lines.length;
  let truncated = false;
  if (start + cap < lines.length) {
    end = start + cap;
    truncated = true;
  }

  let selected: string[] = [];
  let i = start;
  while (i < end) {
    selected.push(lines[i]);
    i = i + 1;
  }
  return { ok: true, content: joinLines(selected), truncated: truncated, error: "" };
}

export function writeFile(root: string, relPath: string, content: string): WriteResult {
  let j = jail(root, relPath);
  if (!j.ok) {
    return { ok: false, error: "path escapes the workspace root" };
  }
  let dir = path.dirname(j.path);
  if (dir != "" && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, true);
  }
  fs.writeFileSync(j.path, content);
  return { ok: true, error: "" };
}

function countOccurrences(hay: string, needle: string): int {
  if (needle == "") { return 0; }
  let count = 0;
  let idx = 0;
  while (true) {
    let at = hay.indexOf(needle, idx);
    if (at < 0) { break; }
    count = count + 1;
    idx = at + needle.length;
  }
  return count;
}

export function editFile(root: string, relPath: string, oldStr: string, newStr: string): EditResult {
  let j = jail(root, relPath);
  if (!j.ok) {
    return { ok: false, error: "path escapes the workspace root" };
  }
  if (!fs.existsSync(j.path)) {
    return { ok: false, error: "no such file" };
  }
  let content = fs.readFileSync(j.path);
  let count = countOccurrences(content, oldStr);
  if (count == 0) {
    return { ok: false, error: "no match found" };
  }
  if (count > 1) {
    return { ok: false, error: "ambiguous: " + `${count}` + " matches found, edit must match exactly one" };
  }
  let at = content.indexOf(oldStr);
  let newContent = content.slice(0, at) + newStr + content.slice(at + oldStr.length);
  fs.writeFileSync(j.path, newContent);
  return { ok: true, error: "" };
}

export function listDir(root: string, relPath: string): ListResult {
  let j = jail(root, relPath);
  if (!j.ok) {
    return { ok: false, entries: [], error: "path escapes the workspace root" };
  }
  if (!fs.existsSync(j.path)) {
    return { ok: false, entries: [], error: "no such directory" };
  }
  let entries = fs.readdirSync(j.path);
  return { ok: true, entries: entries, error: "" };
}

function simpleGlobMatch(name: string, glob: string): bool {
  if (glob == "") { return true; }
  let star = glob.indexOf("*");
  if (star < 0) { return name == glob; }
  let prefix = glob.slice(0, star);
  let suffix = glob.slice(star + 1);
  if (!name.startsWith(prefix)) { return false; }
  if (suffix == "") { return true; }
  return name.slice(name.length - suffix.length) == suffix;
}

function walk(dir: string): string[] {
  let out: string[] = [];
  if (!fs.existsSync(dir)) { return out; }
  let entries = fs.readdirSync(dir);
  for (const name of entries) {
    if (name == ".git" || name == "node_modules" || name == "bin") { continue; }
    let full = dir + "/" + name;
    let st = fs.statSync(full);
    if (st.isDirectory) {
      let sub = walk(full);
      for (const f of sub) {
        out.push(f);
      }
    } else {
      out.push(full);
    }
  }
  return out;
}

export function grep(root: string, pattern: string, glob: string): GrepResult {
  let j = jail(root, ".");
  if (!j.ok) {
    return { ok: false, matches: [], truncated: false, error: "path escapes the workspace root" };
  }
  let files = walk(j.path);

  let matches: GrepMatch[] = [];
  let truncated = false;
  for (const f of files) {
    if (matches.length >= MAX_GREP_MATCHES) {
      truncated = true;
      break;
    }
    let base = f.slice(j.path.length + 1);
    if (!simpleGlobMatch(base, glob)) { continue; }
    let content = fs.readFileSync(f);
    let lines = content.split("\n");
    let lineNo = 1;
    for (const line of lines) {
      if (line.indexOf(pattern) >= 0) {
        matches.push({ file: base, line: lineNo, text: line });
        if (matches.length >= MAX_GREP_MATCHES) {
          truncated = true;
          break;
        }
      }
      lineNo = lineNo + 1;
    }
  }
  return { ok: true, matches: matches, truncated: truncated, error: "" };
}
