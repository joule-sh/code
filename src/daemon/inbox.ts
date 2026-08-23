import { appendMailbox, MailboxReader } from "../tasks/mailbox.ts";
import { inboxDir, inboxPath, isSafeConnId } from "./paths.ts";

export const INBOX_TAG_FRAME: string = "F";
export const INBOX_TAG_CLOSED: string = "C";

export type SealedInbox = { connId: string, size: int };

export function appendInbound(runtimeDir: string, connId: string, frameJson: string): void {
  if (!isSafeConnId(connId)) { return; }
  appendMailbox(inboxPath(runtimeDir, connId), INBOX_TAG_FRAME, frameJson);
}

export function appendClosed(runtimeDir: string, connId: string): void {
  if (!isSafeConnId(connId)) { return; }
  let path = inboxPath(runtimeDir, connId);
  if (!fs.existsSync(path)) { return; }
  appendMailbox(path, INBOX_TAG_CLOSED, "");
}

function inboxFileNames(runtimeDir: string): string[] {
  let dir = inboxDir(runtimeDir);
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function connIdFromInboxFileName(name: string): string {
  let suffix = ".in";
  if (!name.endsWith(suffix)) { return ""; }
  return name.slice(0, name.length - suffix.length);
}

function inboxSize(path: string): int {
  if (!fs.existsSync(path)) { return 0; }
  return fs.statSync(path).size;
}

function removeInbox(path: string): void {
  try { fs.unlinkSync(path); } catch { }
}

export function sweepInbox(runtimeDir: string): int {
  let removed = 0;
  for (const name of inboxFileNames(runtimeDir)) {
    let connId = connIdFromInboxFileName(name);
    if (connId == "" || !isSafeConnId(connId)) { continue; }
    removeInbox(inboxPath(runtimeDir, connId));
    removed = removed + 1;
  }
  return removed;
}

export class InboxDrain {
  runtimeDir: string;
  readers: Map<string, MailboxReader>;
  sealed: SealedInbox[];

  constructor(runtimeDir: string) {
    this.runtimeDir = runtimeDir;
    this.readers = new Map<string, MailboxReader>();
    this.sealed = [];
  }

  readerFor(connId: string): MailboxReader {
    let existing = this.readers.get(connId);
    if (existing != null) { return existing; }
    let created = new MailboxReader(inboxPath(this.runtimeDir, connId));
    this.readers.set(connId, created);
    return created;
  }

  closeReader(connId: string): void {
    let existing = this.readers.get(connId);
    if (existing != null) { existing.close(); }
    this.readers.delete(connId);
  }

  reapSealed(): int {
    let pending = this.sealed;
    this.sealed = [];
    let reaped = 0;
    for (const entry of pending) {
      let path = inboxPath(this.runtimeDir, entry.connId);
      if (inboxSize(path) != entry.size) { continue; }
      removeInbox(path);
      this.closeReader(entry.connId);
      reaped = reaped + 1;
    }
    return reaped;
  }

  forgetGone(present: string[]): void {
    let known = this.readers.keys();
    let gone: string[] = [];
    for (const connId of known) {
      let stillThere = false;
      for (const name of present) {
        if (name == connId) { stillThere = true; }
      }
      if (!stillThere) { gone.push(connId); }
    }
    for (const connId of gone) { this.closeReader(connId); }
  }

  drainAll(): string[] {
    this.reapSealed();
    let names = inboxFileNames(this.runtimeDir);
    let present: string[] = [];
    let out: string[] = [];
    for (const name of names) {
      let connId = connIdFromInboxFileName(name);
      if (connId == "" || !isSafeConnId(connId)) { continue; }
      present.push(connId);
      let reader = this.readerFor(connId);
      let entries = reader.drainNew();
      let closed = false;
      for (const e of entries) {
        if (e.tag == INBOX_TAG_FRAME) { out.push(e.payload); }
        if (e.tag == INBOX_TAG_CLOSED) { closed = true; }
      }
      if (closed) {
        let path = inboxPath(this.runtimeDir, connId);
        let seal: SealedInbox = { connId: connId, size: inboxSize(path) };
        this.sealed.push(seal);
      }
    }
    this.forgetGone(present);
    return out;
  }
}
