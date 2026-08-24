import { Peer, send, closePeer, serveWebSocket } from "../vendor/websocket/server.ts";
import { CLOSE_PROTOCOL_ERROR } from "../vendor/websocket/frame.ts";
import { RESUME, INPUT, CANCEL, APPROVAL_REPLY, MODE_SET, MODEL_SET, TASKS_REQUEST, DAEMON_STOP, SHARE_REQUEST, decodeResume, frameType, frameSeq } from "../protocol/frames.ts";
import { connIdFromPath, isSafeConnId } from "./paths.ts";
import { appendInbound, appendClosed } from "./inbox.ts";
import { newBroadcastReader } from "./broadcast.ts";
import { MailboxEntry } from "../tasks/mailbox.ts";
import { logDaemon, logReceived, logUndeliverable, shortConnId } from "./daemon_log.ts";

export const PUSH_POLL_MS: int = 60;

let g_runtimeDir: string = "";

export function configureConnections(runtimeDir: string): void {
  g_runtimeDir = runtimeDir;
}

export function highestSeq(entries: MailboxEntry[]): int {
  let highest = -1;
  for (const e of entries) {
    let seq = frameSeq(e.payload);
    if (seq > highest) { highest = seq; }
  }
  return highest;
}

export function watermarkForResume(since: int, highest: int): int {
  if (since > highest) { return -1; }
  return since;
}

export function pusherLoop(peer: Peer, since: int): int {
  let reader = newBroadcastReader(g_runtimeDir);
  let watermark = since;
  let settled = false;
  let pushed = 0;
  while (peer.open) {
    let entries = reader.drainNew();
    if (!settled && entries.length > 0) {
      settled = true;
      watermark = watermarkForResume(watermark, highestSeq(entries));
    }
    for (const e of entries) {
      let seq = frameSeq(e.payload);
      if (seq > watermark) {
        send(peer, e.payload);
        watermark = seq;
        pushed = pushed + 1;
      }
    }
    process.sleep(PUSH_POLL_MS);
  }
  reader.close();
  return pushed;
}

function sinceFromResume(message: string): int {
  let resume = decodeResume(message);
  if (resume == null) { return -1; }
  return resume.since;
}

export function isAcceptedInboundType(t: string): bool {
  if (t == INPUT || t == CANCEL || t == APPROVAL_REPLY) { return true; }
  if (t == MODE_SET || t == MODEL_SET || t == TASKS_REQUEST || t == DAEMON_STOP) { return true; }
  if (t == SHARE_REQUEST) { return true; }
  return false;
}

export function daemonOnMessage(peer: Peer, message: string): void {
  let connId = connIdFromPath(peer.path);
  if (!isSafeConnId(connId)) {
    logDaemon("refused a connection on attach path " + peer.path);
    closePeer(peer, CLOSE_PROTOCOL_ERROR, "bad attach path");
    return;
  }
  let t = frameType(message);
  logReceived(connId, message);
  if (t == RESUME) {
    let since = sinceFromResume(message);
    logDaemon("replaying to " + shortConnId(connId) + " from seq " + `${since}`);
    Worker.run(() => { return pusherLoop(peer, since); });
    return;
  }
  if (!isAcceptedInboundType(t)) {
    logUndeliverable(connId, message, "the daemon does not accept that frame from a client");
    return;
  }
  let reason = appendInbound(g_runtimeDir, connId, message);
  if (reason != "") { logUndeliverable(connId, message, reason); }
}

export function daemonOnClose(peer: Peer, graceful: bool): void {
  if (peer.path == "" && graceful) { return; }
  let connId = connIdFromPath(peer.path);
  if (!isSafeConnId(connId)) { return; }
  logDaemon("client " + shortConnId(connId) + " went away");
  appendClosed(g_runtimeDir, connId);
}

export function runDaemonWebSocket(port: int, runtimeDir: string): void {
  configureConnections(runtimeDir);
  serveWebSocket(port, daemonOnMessage, daemonOnClose);
}
