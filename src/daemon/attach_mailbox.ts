import { MailboxLine, parseMailboxLine, nonEmptyLines } from "../relay/client_logic.ts";

export const ATTACH_MAILBOX_PREFIX: string = "joule-attach-";
export const ATTACH_MAILBOX_SUFFIX: string = ".mailbox";

export type AttachMailboxRead = { lines: MailboxLine[], seen: int };

export function attachMailboxPath(tmpDir: string, connId: string): string {
  return tmpDir + "/" + ATTACH_MAILBOX_PREFIX + connId + ATTACH_MAILBOX_SUFFIX;
}

export function openAttachMailbox(path: string): void {
  try { fs.writeFileSync(path, ""); } catch { }
}

export function appendAttachMailbox(path: string, line: string): void {
  if (path == "") { return; }
  if (!fs.existsSync(path)) { return; }
  try { fs.appendFileSync(path, line + "\n"); } catch { }
}

export function reapAttachMailbox(path: string): bool {
  if (path == "") { return false; }
  if (!fs.existsSync(path)) { return false; }
  try { fs.unlinkSync(path); } catch { return false; }
  return true;
}

export function drainAttachMailbox(path: string, seen: int): AttachMailboxRead {
  let content = "";
  try { content = fs.readFileSync(path); } catch {
    let unread: AttachMailboxRead = { lines: [], seen: seen };
    return unread;
  }
  let all = nonEmptyLines(content);
  let out: MailboxLine[] = [];
  let i = seen;
  while (i < all.length) {
    out.push(parseMailboxLine(all[i]));
    i = i + 1;
  }
  let read: AttachMailboxRead = { lines: out, seen: all.length };
  return read;
}
