export type MailboxEntry = { recvAt: i64, tag: string, payload: string };

function parseI64(s: string): i64 {
  let out: i64 = 0;
  let i: int = 0;
  while (i < s.length) {
    let c = s.charAt(i);
    let code = c.charCodeAt(0) - "0".charCodeAt(0);
    if (code < 0 || code > 9) { return -1; }
    out = out * 10 + code;
    i = i + 1;
  }
  return out;
}

export function appendMailbox(path: string, tag: string, payload: string): void {
  let recvAt: i64 = Date.now();
  try { fs.appendFileSync(path, `${recvAt}` + "|" + tag + "|" + payload + "\n"); } catch { }
}

function nonEmptyLines(content: string): string[] {
  let raw = content.split("\n");
  let out: string[] = [];
  let i: int = 0;
  while (i < raw.length) {
    if (raw[i] != "") { out.push(raw[i]); }
    i = i + 1;
  }
  return out;
}

export function parseMailboxLine(line: string): MailboxEntry {
  let bar1 = line.indexOf("|");
  let recvAt: i64 = parseI64(line.slice(0, bar1));
  let rest = line.slice(bar1 + 1, line.length);
  let bar2 = rest.indexOf("|");
  let tag = rest.slice(0, bar2);
  let payload = rest.slice(bar2 + 1, rest.length);
  let entry: MailboxEntry = { recvAt: recvAt, tag: tag, payload: payload };
  return entry;
}

export function findMailboxEntry(path: string, tag: string): string {
  let content = "";
  try { content = fs.readFileSync(path); } catch { return ""; }
  let lines = nonEmptyLines(content);
  let i = 0;
  while (i < lines.length) {
    let entry = parseMailboxLine(lines[i]);
    if (entry.tag == tag) { return entry.payload; }
    i = i + 1;
  }
  return "";
}

export class MailboxReader {
  path: string;
  seen: int;

  constructor(path: string) {
    this.path = path;
    this.seen = 0;
  }

  drainNew(): MailboxEntry[] {
    let content = "";
    try { content = fs.readFileSync(this.path); } catch { return []; }
    let lines = nonEmptyLines(content);
    let out: MailboxEntry[] = [];
    let i = this.seen;
    while (i < lines.length) {
      out.push(parseMailboxLine(lines[i]));
      i = i + 1;
    }
    this.seen = lines.length;
    return out;
  }
}
