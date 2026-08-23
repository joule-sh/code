import { Peer, send, closePeer, serveWebSocket } from "../vendor/websocket/server.ts";
import { CLOSE_PROTOCOL_ERROR } from "../vendor/websocket/frame.ts";
import { RESUME, INPUT, CANCEL, APPROVAL_REPLY, MODE_SET, MODEL_SET, TASKS_REQUEST, DAEMON_STOP, SHARE_REQUEST, decodeResume, frameType, frameSeq } from "../protocol/frames.ts";
import { connIdFromPath, isSafeConnId } from "./paths.ts";
import { appendInbound, appendClosed } from "./inbox.ts";
import { newBroadcastReader } from "./broadcast.ts";

export const PUSH_POLL_MS: int = 60;

let g_runtimeDir: string = "";

export function configureConnections(runtimeDir: string): void {
  g_runtimeDir = runtimeDir;
}

export function pusherLoop(peer: Peer, since: int): int {
  let reader = newBroadcastReader(g_runtimeDir);
  let watermark = since;
  let pushed = 0;
  while (peer.open) {
    let entries = reader.drainNew();
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
    closePeer(peer, CLOSE_PROTOCOL_ERROR, "bad attach path");
    return;
  }
  let t = frameType(message);
  if (t == RESUME) {
    let since = sinceFromResume(message);
    Worker.run(() => { return pusherLoop(peer, since); });
    return;
  }
  if (!isAcceptedInboundType(t)) { return; }
  appendInbound(g_runtimeDir, connId, message);
}

export function daemonOnClose(peer: Peer, graceful: bool): void {
  if (peer.path == "" && graceful) { return; }
  let connId = connIdFromPath(peer.path);
  if (!isSafeConnId(connId)) { return; }
  appendClosed(g_runtimeDir, connId);
}

export function runDaemonWebSocket(port: int, runtimeDir: string): void {
  configureConnections(runtimeDir);
  serveWebSocket(port, daemonOnMessage, daemonOnClose);
}
