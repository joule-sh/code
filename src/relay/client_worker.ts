import { connectWebSocket, receive, sendText, Connection } from "../vendor/websocket/client.ts";
import { PROTOCOL_VERSION, RESUME, ResumeFrame, encodeResume } from "../protocol/frames.ts";
import { encodeMailboxFrame, encodeMailboxControl, TAG_CONNECTED, TAG_DISCONNECTED, TAG_CONNECT_FAILED } from "./client_logic.ts";

let g_host: string = "";
let g_wsPort: int = 0;
let g_sessionId: string = "";
let g_secret: string = "";
let g_since: int = -1;
let g_mailboxPath: string = "";
let g_socket: Socket[] = [];

export function configureWorker(host: string, wsPort: int, sessionId: string, secret: string, since: int, mailboxPath: string): void {
  g_host = host;
  g_wsPort = wsPort;
  g_sessionId = sessionId;
  g_secret = secret;
  g_since = since;
  g_mailboxPath = mailboxPath;
}

export function currentSocket(): Socket[] {
  return g_socket;
}

function terminalHeaders(secret: string): Map<string, string> {
  let h = new Map<string, string>();
  h.set("x-relay-secret", secret);
  return h;
}

function appendMailbox(line: string): void {
  try { fs.appendFileSync(g_mailboxPath, line + "\n"); } catch { }
}

export function receiveLoop(): int {
  let path = "/sessions/" + g_sessionId + "/ws";
  let conn = connectWebSocket(g_host, g_wsPort, path, terminalHeaders(g_secret));
  if (!conn.ok) {
    appendMailbox(encodeMailboxControl(TAG_CONNECT_FAILED, conn.error));
    return 0;
  }

  if (g_since >= 0) {
    let resumeFrame: ResumeFrame = { v: PROTOCOL_VERSION, seq: 0, type: RESUME, since: g_since };
    sendText(conn, encodeResume(resumeFrame));
  }

  g_socket = [conn.socket];
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

  g_socket = [];
  return count;
}
