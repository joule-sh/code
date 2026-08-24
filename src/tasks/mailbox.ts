import { appendFile } from "../vendor/platform/platform.ts";

export type MailboxEntry = { recvAt: i64, tag: string, payload: string };

const MAILBOX_READ_CHUNK: int = 65536;

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

export function mailboxLine(recvAt: i64, tag: string, payload: string): string {
  return `${recvAt}` + "|" + tag + "|" + payload + "\n";
}

export function appendMailboxOrReason(path: string, tag: string, payload: string): string {
  let line = mailboxLine(Date.now(), tag, payload);
  try {
    appendFile(path, line);
  } catch {
    return "could not write " + `${line.length}` + " bytes to " + path;
  }
  return "";
}

export function appendMailbox(path: string, tag: string, payload: string): void {
  appendMailboxOrReason(path, tag, payload);
}

function completeLines(content: string): string[] {
  let end = content.lastIndexOf("\n");
  if (end < 0) { return []; }
  let raw = content.slice(0, end).split("\n");
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
  let lines = completeLines(content);
  let i = 0;
  while (i < lines.length) {
    let entry = parseMailboxLine(lines[i]);
    if (entry.tag == tag) { return entry.payload; }
    i = i + 1;
  }
  return "";
}

export function readAllMailboxEntries(path: string): MailboxEntry[] {
  let content = "";
  try { content = fs.readFileSync(path); } catch { return []; }
  let lines = completeLines(content);
  let out: MailboxEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    out.push(parseMailboxLine(lines[i]));
    i = i + 1;
  }
  return out;
}

export class MailboxReader {
  path: string;
  fd: int;
  pos: int;
  pending: string;

  constructor(path: string) {
    this.path = path;
    this.fd = -1;
    this.pos = 0;
    this.pending = "";
  }

  attach(): bool {
    if (this.fd >= 0) { return true; }
    if (this.path == "") { return false; }
    let opened: int = -1;
    try { opened = fs.openSync(this.path, "r"); } catch { return false; }
    if (opened < 0) { return false; }
    this.fd = opened;
    this.pos = 0;
    this.pending = "";
    return true;
  }

  close(): void {
    if (this.fd < 0) { return; }
    try { fs.closeSync(this.fd); } catch { }
    this.fd = -1;
    this.pos = 0;
    this.pending = "";
  }

  readForward(): string {
    let parts: string[] = [];
    let more = true;
    while (more) {
      let chunk = "";
      try { chunk = fs.readSync(this.fd, MAILBOX_READ_CHUNK); } catch { chunk = ""; }
      if (chunk.length == 0) {
        more = false;
      } else {
        parts.push(chunk);
        this.pos = this.pos + chunk.length;
      }
    }
    return parts.join("");
  }

  drainNew(): MailboxEntry[] {
    if (!this.attach()) { return []; }
    let size: int = this.pos;
    try { size = fs.statSync(this.path).size; } catch { size = this.pos; }
    if (size < this.pos) { this.pending = ""; }
    let grown = this.readForward();
    if (grown == "") { return []; }
    let buffered = this.pending + grown;
    let end = buffered.lastIndexOf("\n");
    if (end < 0) {
      this.pending = buffered;
      return [];
    }
    this.pending = buffered.slice(end + 1, buffered.length);
    let out: MailboxEntry[] = [];
    for (const raw of buffered.slice(0, end).split("\n")) {
      if (raw != "") { out.push(parseMailboxLine(raw)); }
    }
    return out;
  }
}
