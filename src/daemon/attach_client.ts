import { Connection, sendText } from "../vendor/websocket/client.ts";
import { PROTOCOL_VERSION, ERROR, ErrorFrame, encodeError, frameType } from "../protocol/frames.ts";
import { OUTBOUND_BUFFER_CAP, BACKOFF_START_MS, nextBackoffMs, maxSeqSeen, pushBounded, parseMailboxLine, nonEmptyLines, TAG_FRAME, TAG_CONNECTED, TAG_DISCONNECTED, TAG_CONNECT_FAILED } from "../relay/client_logic.ts";
import { configureAttachWorker, currentAttachSocket, attachReceiveLoop } from "./attach_worker.ts";

function noticeFrame(code: string, message: string): ErrorFrame {
  let f: ErrorFrame = { v: PROTOCOL_VERSION, seq: 0, type: ERROR, code: code, message: message };
  return f;
}

function mailboxPathFor(tmpDir: string, connId: string): string {
  return tmpDir + "/joule-attach-" + connId + ".mailbox";
}

export class DaemonClient {
  host: string;
  port: int;
  tmpDir: string;

  connId: string;
  attaching: bool;
  socketReady: bool;
  connecting: bool;
  detachRequested: bool;

  lastSeq: int;
  outbound: string[];
  overflowed: bool;

  mailboxPath: string;
  mailboxSeen: int;

  backoffMs: i64;
  nextRetryAt: i64;

  inboundQueue: string[];
  diagnostics: string[];

  constructor(host: string, port: int, tmpDir: string) {
    this.host = host;
    this.port = port;
    this.tmpDir = tmpDir;
    this.connId = "";
    this.attaching = false;
    this.socketReady = false;
    this.connecting = false;
    this.detachRequested = false;
    this.lastSeq = 0;
    this.outbound = [];
    this.overflowed = false;
    this.mailboxPath = "";
    this.mailboxSeen = 0;
    this.backoffMs = BACKOFF_START_MS;
    this.nextRetryAt = 0;
    this.inboundQueue = [];
    this.diagnostics = [];
  }

  isAttached(): bool {
    return this.attaching;
  }

  connect(): void {
    if (this.attaching) { return; }
    this.connId = crypto.randomUUID();
    this.attaching = true;
    this.socketReady = false;
    this.connecting = true;
    this.detachRequested = false;
    this.lastSeq = 0;
    this.outbound = [];
    this.overflowed = false;
    this.mailboxPath = mailboxPathFor(this.tmpDir, this.connId);
    this.mailboxSeen = 0;
    this.backoffMs = BACKOFF_START_MS;
    this.nextRetryAt = 0;
    this.inboundQueue = [];

    try { fs.writeFileSync(this.mailboxPath, ""); } catch { }
    configureAttachWorker(this.host, this.port, this.connId, -1, this.mailboxPath);
    Worker.run(attachReceiveLoop);
  }

  writeFrame(frameJson: string): void {
    let sock = currentAttachSocket();
    if (sock.length == 0) { return; }
    let conn: Connection = { socket: sock[0], ok: true, buffer: "", open: true, error: "" };
    sendText(conn, frameJson);
  }

  publish(frameJson: string): void {
    if (!this.attaching) { return; }
    this.lastSeq = maxSeqSeen(this.lastSeq, frameJson);
    if (this.socketReady) {
      this.writeFrame(frameJson);
      return;
    }
    let pushed = pushBounded(this.outbound, OUTBOUND_BUFFER_CAP, frameJson);
    this.outbound = pushed.buffer;
    if (pushed.overflowed && !this.overflowed) {
      this.overflowed = true;
      this.diagnostics.push(encodeError(noticeFrame("daemon.buffer_overflow", "the local outbound buffer overflowed while disconnected, the oldest buffered frames were dropped")));
    }
  }

  flushOutbound(): void {
    for (const f of this.outbound) {
      this.writeFrame(f);
    }
    this.outbound = [];
    this.overflowed = false;
  }

  onConnected(): void {
    this.socketReady = true;
    this.connecting = false;
    this.backoffMs = BACKOFF_START_MS;
    this.diagnostics.push(encodeError(noticeFrame("daemon.attached", "connected to the daemon")));
    this.flushOutbound();
  }

  onDisconnected(detail: string): void {
    this.socketReady = false;
    this.connecting = false;
    if (this.detachRequested) { return; }
    this.diagnostics.push(encodeError(noticeFrame("daemon.disconnected", "lost the daemon connection (" + detail + "), retrying")));
    this.nextRetryAt = Date.now() + this.backoffMs;
    this.backoffMs = nextBackoffMs(this.backoffMs);
  }

  drainMailbox(): void {
    let content = "";
    try { content = fs.readFileSync(this.mailboxPath); } catch { return; }
    let lines = nonEmptyLines(content);
    let i = this.mailboxSeen;
    while (i < lines.length) {
      let parsed = parseMailboxLine(lines[i]);
      if (parsed.tag == TAG_FRAME) {
        this.lastSeq = maxSeqSeen(this.lastSeq, parsed.payload);
        this.inboundQueue.push(parsed.payload);
      } else if (parsed.tag == TAG_CONNECTED) {
        this.onConnected();
      } else if (parsed.tag == TAG_DISCONNECTED || parsed.tag == TAG_CONNECT_FAILED) {
        this.onDisconnected(parsed.payload);
      }
      i = i + 1;
    }
    this.mailboxSeen = lines.length;
  }

  maybeReconnect(): void {
    if (!this.attaching || this.socketReady || this.connecting || this.detachRequested) { return; }
    if (this.nextRetryAt == 0) { return; }
    if (Date.now() < this.nextRetryAt) { return; }
    this.connecting = true;
    configureAttachWorker(this.host, this.port, this.connId, this.lastSeq, this.mailboxPath);
    Worker.run(attachReceiveLoop);
  }

  pollInbound(): string[] {
    if (!this.attaching) { return []; }
    this.drainMailbox();
    this.maybeReconnect();
    let out = this.inboundQueue;
    this.inboundQueue = [];
    return out;
  }

  drainDiagnostics(): string[] {
    let out = this.diagnostics;
    this.diagnostics = [];
    return out;
  }

  detach(): void {
    if (!this.attaching) { return; }
    this.detachRequested = true;
    this.attaching = false;
    this.socketReady = false;
  }

  disconnect(): void {
    this.detachRequested = true;
    this.attaching = false;
    this.socketReady = false;
    let sock = currentAttachSocket();
    if (sock.length > 0) { sock[0].close(); }
  }
}
