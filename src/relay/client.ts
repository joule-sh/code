import { LEVEL_WARN, encodeNotice, noticeFrame, frameType } from "../protocol/frames.ts";
import { Connection, sendText } from "../vendor/websocket/client.ts";
import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { OUTBOUND_BUFFER_CAP, BACKOFF_START_MS, nextBackoffMs, shouldSayUnreachable, maxSeqSeen, pushBounded, isDownstreamAllowed, parseMailboxLine, nonEmptyLines, mailboxPathFor, webUrlFor, attributionProblem, TAG_FRAME, TAG_CONNECTED, TAG_DISCONNECTED, TAG_CONNECT_FAILED } from "./client_logic.ts";
import { configureWorker, currentSocket, receiveLoop, stopReceiveLoop } from "./client_worker.ts";

export type ConnectResult = { ok: bool, code: string, url: string, error: string };

type CreateSessionRequest = { workspace: string, model: string, credentialSecret: string };

export class RelayClient {
  host: string;
  httpPort: int;
  wsPort: int;
  webBaseUrl: string;
  tmpDir: string;
  credentialSecret: string;

  sessionId: string;
  secret: string;
  code: string;

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
  configProblem: string;

  backoffMs: i64;
  nextRetryAt: i64;

  inboundQueue: string[];
  diagnostics: string[];

  constructor(host: string, httpPort: int, wsPort: int, webBaseUrl: string, tmpDir: string) {
    this.host = host;
    this.httpPort = httpPort;
    this.wsPort = wsPort;
    this.webBaseUrl = webBaseUrl;
    this.tmpDir = tmpDir;
    this.credentialSecret = "";
    this.sessionId = "";
    this.secret = "";
    this.code = "";
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
    this.configProblem = "";
    this.backoffMs = BACKOFF_START_MS;
    this.nextRetryAt = 0;
    this.inboundQueue = [];
    this.diagnostics = [];
  }

  isAttached(): bool {
    return this.attaching;
  }

  reachFailure(where: string, status: int, body: string): string {
    if (status >= 0) {
      return "the relay refused this session\n"
        + "  asked " + where + "\n"
        + "  it answered " + `${status}` + " " + body;
    }
    return "cannot reach the relay\n"
      + "  tried " + where + "\n"
      + "  nothing answered there, so nothing refused anything\n"
      + "  that address came from the server you signed in to";
  }

  connect(workspace: string, model: string): ConnectResult {
    if (this.attaching) {
      let already: ConnectResult = { ok: false, code: this.code, url: webUrlFor(this.webBaseUrl, this.code), error: "already attached" };
      return already;
    }
    if (this.configProblem != "") {
      let unset: ConnectResult = { ok: false, code: "", url: "", error: this.configProblem };
      return unset;
    }

    let req: CreateSessionRequest = { workspace: workspace, model: model, credentialSecret: this.credentialSecret };
    let headers = new Map<string, string>();
    headers.set("Content-Type", "application/json");
    let where = "http://" + this.host + ":" + `${this.httpPort}`;
    let resp = http.request(where + "/sessions", "POST", JSON.stringify(req), headers);
    if (!resp.ok) {
      let failed: ConnectResult = { ok: false, code: "", url: "", error: this.reachFailure(where, resp.status, resp.body) };
      return failed;
    }

    let sessionId = jsonStringMemberAt(resp.body, 0, "sessionId");
    let sessionSecret = jsonStringMemberAt(resp.body, 0, "secret");
    let pairingCode = jsonStringMemberAt(resp.body, 0, "code");
    if (sessionId == "" || sessionSecret == "" || pairingCode == "") {
      let bad: ConnectResult = { ok: false, code: "", url: "", error: "malformed response from relay" };
      return bad;
    }

    if (this.credentialSecret != "") {
      let unowned = attributionProblem(jsonStringMemberAt(resp.body, 0, "accountStatus"), jsonStringMemberAt(resp.body, 0, "verifiedBy"));
      if (unowned != "") {
        let anonymous: ConnectResult = { ok: false, code: "", url: "", error: unowned };
        return anonymous;
      }
    }

    this.sessionId = sessionId;
    this.secret = sessionSecret;
    this.code = pairingCode;
    this.attaching = true;
    this.socketReady = false;
    this.connecting = true;
    this.detachRequested = false;
    this.lastSeq = 0;
    this.outbound = [];
    this.overflowed = false;
    this.saidUnreachable = false;
    this.outageSince = 0;
    this.mailboxPath = mailboxPathFor(this.tmpDir, this.sessionId);
    this.mailboxSeen = 0;
    this.backoffMs = BACKOFF_START_MS;
    this.nextRetryAt = 0;
    this.inboundQueue = [];

    try { fs.writeFileSync(this.mailboxPath, ""); } catch { }
    configureWorker(this.host, this.wsPort, this.sessionId, this.secret, -1, this.mailboxPath);
    Worker.run(receiveLoop);

    let ok: ConnectResult = { ok: true, code: this.code, url: webUrlFor(this.webBaseUrl, this.code), error: "" };
    return ok;
  }

  writeFrame(frameJson: string): void {
    let sock = currentSocket();
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
      this.diagnostics.push(encodeNotice(noticeFrame("relay.buffer_overflow", LEVEL_WARN, "the local outbound buffer overflowed while disconnected, the oldest buffered frames were dropped - the web view will be behind once reconnected")));
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
      this.diagnostics.push(encodeNotice(noticeFrame("relay.unreachable", LEVEL_WARN, "cannot reach the relay (" + detail + "), still retrying - the web view is behind until it answers")));
    }
    this.nextRetryAt = now + this.backoffMs;
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
        if (isDownstreamAllowed(frameType(parsed.payload))) {
          this.inboundQueue.push(parsed.payload);
        } else {
          this.diagnostics.push(encodeNotice(noticeFrame("relay.rejected_frame", LEVEL_WARN, "dropped a frame of a type the terminal never accepts from the relay: " + frameType(parsed.payload))));
        }
      } else if (parsed.tag == TAG_CONNECTED) {
        this.onConnected();
      } else if (parsed.tag == TAG_DISCONNECTED) {
        this.onDisconnected(parsed.payload, false);
      } else if (parsed.tag == TAG_CONNECT_FAILED) {
        this.onDisconnected(parsed.payload, true);
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
    configureWorker(this.host, this.wsPort, this.sessionId, this.secret, this.lastSeq, this.mailboxPath);
    Worker.run(receiveLoop);
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
    stopReceiveLoop();
    this.attaching = false;
    this.socketReady = false;
  }
}
