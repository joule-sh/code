export type FrontmatterField = { key: string, value: string };
export type Frontmatter = { ok: bool, error: string, fields: FrontmatterField[], body: string };

export const FRONTMATTER_FENCE: string = "---";

function dropCarriage(line: string): string {
  if (line.endsWith("\r")) { return line.slice(0, line.length - 1); }
  return line;
}

function stripQuotes(v: string): string {
  if (v.length < 2) { return v; }
  let first = v.slice(0, 1);
  let last = v.slice(v.length - 1, v.length);
  if (first == "\"" && last == "\"") { return v.slice(1, v.length - 1); }
  if (first == "'" && last == "'") { return v.slice(1, v.length - 1); }
  return v;
}

function isContinuationOrNote(line: string): bool {
  if (line.length == 0) { return true; }
  let c = line.charCodeAt(0);
  return c == 32 || c == 9 || c == 35 || c == 45;
}

export function fieldValue(fields: FrontmatterField[], key: string): string {
  for (const f of fields) {
    if (f.key == key) { return f.value; }
  }
  return "";
}

export function hasFieldKey(fields: FrontmatterField[], key: string): bool {
  for (const f of fields) {
    if (f.key == key) { return true; }
  }
  return false;
}

function malformed(reason: string): Frontmatter {
  let empty: FrontmatterField[] = [];
  let f: Frontmatter = { ok: false, error: reason, fields: empty, body: "" };
  return f;
}

export function parseFrontmatter(text: string): Frontmatter {
  let fields: FrontmatterField[] = [];
  let lines = text.split("\n");
  if (dropCarriage(lines[0]).trim() != FRONTMATTER_FENCE) {
    let whole: Frontmatter = { ok: true, error: "", fields: fields, body: text.trim() };
    return whole;
  }

  let i = 1;
  let closed = false;
  while (i < lines.length) {
    let raw = dropCarriage(lines[i]);
    i = i + 1;
    if (raw.trim() == FRONTMATTER_FENCE) { closed = true; break; }
    if (isContinuationOrNote(raw)) { continue; }
    let colon = raw.indexOf(":");
    if (colon <= 0) {
      return malformed("frontmatter line " + `${i}` + " is not `key: value` and could not be read: " + raw.trim());
    }
    let key = raw.slice(0, colon).trim().toLowerCase();
    let value = stripQuotes(raw.slice(colon + 1, raw.length).trim());
    let fld: FrontmatterField = { key: key, value: value };
    fields.push(fld);
  }

  if (!closed) {
    return malformed("frontmatter opened with --- but no closing --- line was found");
  }

  let body = "";
  while (i < lines.length) {
    body = body + lines[i];
    if (i < lines.length - 1) { body = body + "\n"; }
    i = i + 1;
  }
  let out: Frontmatter = { ok: true, error: "", fields: fields, body: body.trim() };
  return out;
}
