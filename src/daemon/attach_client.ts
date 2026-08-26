import { Connection, sendText } from "../vendor/websocket/client.ts";
import { LEVEL_WARN, encodeNotice, noticeFrame, frameType } from "../protocol/frames.ts";
import { OUTBOUND_BUFFER_CAP, BACKOFF_START_MS, nextBackoffMs, shouldSayUnreachable, maxSeqSeen, pushBounded, TAG_FRAME, TAG_CONNECTED, TAG_DISCONNECTED, TAG_CONNECT_FAILED } from "../relay/client_logic.ts";
import { configureAttachWorker, currentAttachSocket, attachReceiveLoop, stopAttachWorker } from "./attach_worker.ts";
import { attachMailboxPath, openAttachMailbox, reapAttachMailbox, drainAttachMailbox } from "./attach_mailbox.ts";
import { worthConnectingTo } from "../vendor/platform/platform.ts";

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
  saidUnreachable: bool;
  outageSince: i64;

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
    this.saidUnreachable = false;
    this.outageSince = 0;
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
    this.saidUnreachable = false;
    this.outageSince = 0;
    this.mailboxPath = attachMailboxPath(this.tmpDir, this.connId);
    this.mailboxSeen = 0;
    this.backoffMs = BACKOFF_START_MS;
    this.nextRetryAt = 0;
    this.inboundQueue = [];

    openAttachMailbox(this.mailboxPath);
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
      this.diagnostics.push(encodeNotice(noticeFrame("daemon.buffer_overflow", LEVEL_WARN, "the local outbound buffer overflowed while disconnected, the oldest buffered frames were dropped")));
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
    this.saidUnreachable = false;
    this.outageSince = 0;
    this.flushOutbound();
  }

  onDisconnected(detail: string, retryFailed: bool): void {
    this.socketReady = false;
    this.connecting = false;
    if (this.detachRequested) { return; }
    let now = Date.now();
    if (this.outageSince == 0) { this.outageSince = now; }
    if (shouldSayUnreachable(retryFailed, this.saidUnreachable, this.outageSince, now)) {
      this.saidUnreachable = true;
      this.diagnostics.push(encodeNotice(noticeFrame("daemon.unreachable", LEVEL_WARN, "cannot reach the daemon (" + detail + "), still retrying")));
    }
    this.nextRetryAt = now + this.backoffMs;
    this.backoffMs = nextBackoffMs(this.backoffMs);
  }

  drainMailbox(): void {
    let read = drainAttachMailbox(this.mailboxPath, this.mailboxSeen);
    for (const parsed of read.lines) {
      if (parsed.tag == TAG_FRAME) {
        this.lastSeq = maxSeqSeen(this.lastSeq, parsed.payload);
        this.inboundQueue.push(parsed.payload);
      } else if (parsed.tag == TAG_CONNECTED) {
        this.onConnected();
      } else if (parsed.tag == TAG_DISCONNECTED) {
        this.onDisconnected(parsed.payload, false);
      } else if (parsed.tag == TAG_CONNECT_FAILED) {
        this.onDisconnected(parsed.payload, true);
      }
    }
    this.mailboxSeen = read.seen;
  }

  retryNow(): void {
    if (this.socketReady || this.connecting || this.detachRequested) { return; }
    this.backoffMs = BACKOFF_START_MS;
    this.nextRetryAt = Date.now();
  }

  maybeReconnect(): void {
    if (!this.attaching || this.socketReady || this.connecting || this.detachRequested) { return; }
    if (this.nextRetryAt == 0) { return; }
    if (Date.now() < this.nextRetryAt) { return; }
    if (!worthConnectingTo(this.host, this.port)) {
      this.nextRetryAt = Date.now() + this.backoffMs;
      return;
    }
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

  reapMailbox(): bool {
    let path = this.mailboxPath;
    this.mailboxPath = "";
    this.mailboxSeen = 0;
    return reapAttachMailbox(path);
  }

  detach(): void {
    this.detachRequested = true;
    this.attaching = false;
    this.socketReady = false;
    stopAttachWorker();
    this.reapMailbox();
  }
}
