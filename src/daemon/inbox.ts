import { appendMailbox, MailboxReader } from "../tasks/mailbox.ts";
import { inboxDir, inboxPath, isSafeConnId } from "./paths.ts";

export const INBOX_TAG_FRAME: string = "F";

export function appendInbound(runtimeDir: string, connId: string, frameJson: string): void {
  if (!isSafeConnId(connId)) { return; }
  appendMailbox(inboxPath(runtimeDir, connId), INBOX_TAG_FRAME, frameJson);
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

export class InboxDrain {
  runtimeDir: string;
  readers: Map<string, MailboxReader>;

  constructor(runtimeDir: string) {
    this.runtimeDir = runtimeDir;
    this.readers = new Map<string, MailboxReader>();
  }

  readerFor(connId: string): MailboxReader {
    let existing = this.readers.get(connId);
    if (existing != null) { return existing; }
    let created = new MailboxReader(inboxPath(this.runtimeDir, connId));
    this.readers.set(connId, created);
    return created;
  }

  drainAll(): string[] {
    let names = inboxFileNames(this.runtimeDir);
    let out: string[] = [];
    for (const name of names) {
      let connId = connIdFromInboxFileName(name);
      if (connId == "" || !isSafeConnId(connId)) { continue; }
      let reader = this.readerFor(connId);
      let entries = reader.drainNew();
      for (const e of entries) {
        if (e.tag == INBOX_TAG_FRAME) { out.push(e.payload); }
      }
    }
    return out;
  }
}
