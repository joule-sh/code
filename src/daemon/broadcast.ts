import { appendMailbox, MailboxReader } from "../tasks/mailbox.ts";
import { broadcastLogPath } from "./paths.ts";

export const BROADCAST_TAG_FRAME: string = "F";

export function appendBroadcast(runtimeDir: string, frameJson: string): void {
  appendMailbox(broadcastLogPath(runtimeDir), BROADCAST_TAG_FRAME, frameJson);
}

export function newBroadcastReader(runtimeDir: string): MailboxReader {
  return new MailboxReader(broadcastLogPath(runtimeDir));
}
