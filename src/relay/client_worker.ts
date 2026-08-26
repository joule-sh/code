import { connectWebSocket, receive, sendText, sendClose, Connection } from "../vendor/websocket/client.ts";
import { CLOSE_NORMAL } from "../vendor/websocket/frame.ts";
import { PROTOCOL_VERSION, RESUME, ResumeFrame, encodeResume } from "../protocol/frames.ts";
import { encodeMailboxFrame, encodeMailboxControl, TAG_CONNECTED, TAG_DISCONNECTED, TAG_CONNECT_FAILED } from "./client_logic.ts";
import { appendFile } from "../vendor/platform/platform.ts";

export const STOP_POLL_MS: int = 10;
export const STOP_WAIT_TICKS: int = 60;

let g_host: string = "";
let g_wsPort: int = 0;
let g_sessionId: string = "";
let g_secret: string = "";
let g_since: int = -1;
let g_mailboxPath: string = "";
let g_socket: Socket[] = [];
let g_generation: int = 0;
let g_live: int = 0;

export function configureWorker(host: string, wsPort: int, sessionId: string, secret: string, since: int, mailboxPath: string): void {
  g_host = host;
  g_wsPort = wsPort;
  g_sessionId = sessionId;
  g_secret = secret;
  g_since = since;
  g_mailboxPath = mailboxPath;
  g_generation = g_generation + 1;
  g_live = g_live + 1;
}

export function currentSocket(): Socket[] {
  return g_socket;
}

export function stopReceiveLoop(): bool {
  let sock = g_socket;
  g_socket = [];
  g_generation = g_generation + 1;
  if (sock.length == 0) { return g_live == 0; }
  let conn: Connection = { socket: sock[0], ok: true, buffer: "", open: true, error: "" };
  sendClose(conn, CLOSE_NORMAL, "terminal detached");
  let i = 0;
  while (i < STOP_WAIT_TICKS && g_live > 0) {
    process.sleep(STOP_POLL_MS);
    i = i + 1;
  }
  return g_live == 0;
}

function terminalHeaders(secret: string): Map<string, string> {
  let h = new Map<string, string>();
  h.set("x-relay-secret", secret);
  return h;
}

function appendMailbox(line: string): void {
  try { appendFile(g_mailboxPath, line + "\n"); } catch { }
}

export function receiveLoop(): int {
  let mine = g_generation;
  let path = "/sessions/" + g_sessionId + "/ws";
  let conn = connectWebSocket(g_host, g_wsPort, path, terminalHeaders(g_secret));
  if (!conn.ok) {
    appendMailbox(encodeMailboxControl(TAG_CONNECT_FAILED, conn.error));
    g_live = g_live - 1;
    return 0;
  }

  if (g_since >= 0) {
    let resumeFrame: ResumeFrame = { v: PROTOCOL_VERSION, seq: 0, type: RESUME, since: g_since };
    sendText(conn, encodeResume(resumeFrame));
  }

  if (g_generation == mine) { g_socket = [conn.socket]; }
  appendMailbox(encodeMailboxControl(TAG_CONNECTED, ""));

  let count = 0;
  let alive = true;
  while (alive) {
    let ex = receive(conn);
    conn = ex.conn;
    if (!ex.received.ok || ex.received.kind == "close" || !conn.open) {
      appendMailbox(encodeMailboxControl(TAG_DISCONNECTED, ex.received.error));
      alive = false;
      continue;
    }
    if (ex.received.kind == "text") {
      appendMailbox(encodeMailboxFrame(ex.received.message));
      count = count + 1;
    }
  }

  if (g_generation == mine) { g_socket = []; }
  conn.socket.close();
  g_live = g_live - 1;
  return count;
}
