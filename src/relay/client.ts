import { LEVEL_INFO, LEVEL_WARN, encodeNotice, noticeFrame, frameType } from "../protocol/frames.ts";
import { Connection, sendText } from "../vendor/websocket/client.ts";
import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { OUTBOUND_BUFFER_CAP, BACKOFF_START_MS, nextBackoffMs, shouldSayUnreachable, shouldGiveUp, refusalCodeOf, refusalEndsShare, resharedMessage, outageEndedMessage, refusedMessage, staleShareProblem, maxSeqSeen, pushBounded, isDownstreamAllowed, parseMailboxLine, nonEmptyLines, mailboxPathFor, webUrlFor, attributionProblem, REFUSAL_SESSION_GONE, TAG_FRAME, TAG_CONNECTED, TAG_DISCONNECTED, TAG_CONNECT_FAILED } from "./client_logic.ts";
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

  workspace: string;
  model: string;
  helloFrame: string;

  attaching: bool;
  socketReady: bool;
  connecting: bool;
  detachRequested: bool;
  sessionLost: bool;

  lastSeq: int;
  outbound: string[];
  overflowed: bool;
  saidUnreachable: bool;
  outageSince: i64;
  lastFailure: string;

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
    this.workspace = "";
    this.model = "";
    this.helloFrame = "";
    this.attaching = false;
    this.socketReady = false;
    this.connecting = false;
    this.detachRequested = false;
    this.sessionLost = false;
    this.lastSeq = 0;
    this.outbound = [];
    this.overflowed = false;
    this.saidUnreachable = false;
    this.outageSince = 0;
    this.lastFailure = "";
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

  whereHttp(): string {
    return "http://" + this.host + ":" + `${this.httpPort}`;
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

  createSession(workspace: string, model: string, since: int): ConnectResult {
    if (this.configProblem != "") {
      let unset: ConnectResult = { ok: false, code: "", url: "", error: this.configProblem };
      return unset;
    }

    let req: CreateSessionRequest = { workspace: workspace, model: model, credentialSecret: this.credentialSecret };
    let headers = new Map<string, string>();
    headers.set("Content-Type", "application/json");
    let where = this.whereHttp();
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

    this.sessionId = "" + sessionId;
    this.secret = "" + sessionSecret;
    this.code = "" + pairingCode;
    this.attaching = true;
    this.socketReady = false;
    this.connecting = true;
    this.detachRequested = false;
    this.sessionLost = false;
    this.saidUnreachable = false;
    this.outageSince = 0;
    this.lastFailure = "";
    this.mailboxPath = mailboxPathFor(this.tmpDir, this.sessionId);
    this.mailboxSeen = 0;
    this.backoffMs = BACKOFF_START_MS;
    this.nextRetryAt = 0;

    try { fs.writeFileSync(this.mailboxPath, ""); } catch { }
    configureWorker(this.host, this.wsPort, this.sessionId, this.secret, since, this.mailboxPath);
    Worker.run(receiveLoop);

    let ok: ConnectResult = { ok: true, code: this.code, url: webUrlFor(this.webBaseUrl, this.code), error: "" };
    return ok;
  }

  connect(workspace: string, model: string): ConnectResult {
    if (this.attaching) {
      let already: ConnectResult = { ok: false, code: this.code, url: webUrlFor(this.webBaseUrl, this.code), error: "already attached" };
      return already;
    }
    this.workspace = workspace;
    this.model = model;
    this.lastSeq = 0;
    this.outbound = [];
    this.overflowed = false;
    this.inboundQueue = [];
    return this.createSession(workspace, model, -1);
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
    this.lastFailure = "" + detail;
    if (this.outageSince == 0) { this.outageSince = now; }
    if (shouldSayUnreachable(retryFailed, this.saidUnreachable, this.outageSince, now)) {
      this.saidUnreachable = true;
      this.diagnostics.push(encodeNotice(noticeFrame("relay.unreachable", LEVEL_WARN, "cannot reach the relay (" + detail + "), still retrying - the web view is behind until it answers")));
    }
    this.nextRetryAt = now + this.backoffMs;
    this.backoffMs = nextBackoffMs(this.backoffMs);
  }

  onRefusal(code: string): void {
    if (code == REFUSAL_SESSION_GONE) {
      this.sessionLost = true;
      return;
    }
    if (!refusalEndsShare(code)) { return; }
    this.endShare(refusedMessage(code));
  }

  endShare(message: string): void {
    this.diagnostics.push(encodeNotice(noticeFrame("relay.share_ended", LEVEL_WARN, message)));
    this.detachRequested = true;
    stopReceiveLoop();
    this.attaching = false;
    this.socketReady = false;
    this.connecting = false;
    this.sessionLost = false;
    this.outbound = [];
    this.code = "";
  }

  recreate(): void {
    let held = this.outbound;
    let seq = this.lastSeq;
    let result = this.createSession(this.workspace, this.model, seq);
    if (!result.ok) {
      let now = Date.now();
      this.connecting = false;
      this.lastFailure = "" + result.error;
      if (this.outageSince == 0) { this.outageSince = now; }
      this.nextRetryAt = now + this.backoffMs;
      this.backoffMs = nextBackoffMs(this.backoffMs);
      return;
    }
    this.lastSeq = seq;
    this.outbound = [];
    if (this.helloFrame != "") { this.publish(this.helloFrame); }
    for (const f of held) { this.publish(f); }
    this.diagnostics.push(encodeNotice(noticeFrame("relay.reshared", LEVEL_INFO, resharedMessage())));
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
        let refusal = refusalCodeOf(parsed.payload);
        if (refusal != "") {
          this.onRefusal(refusal);
        } else if (isDownstreamAllowed(frameType(parsed.payload))) {
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

  maybeRecover(): void {
    if (!this.attaching || this.socketReady || this.connecting || this.detachRequested) { return; }
    if (this.nextRetryAt == 0) { return; }
    let now = Date.now();
    if (now < this.nextRetryAt) { return; }
    if (shouldGiveUp(this.outageSince, now)) {
      this.endShare(outageEndedMessage(this.whereHttp(), this.lastFailure));
      return;
    }
    if (this.sessionLost) {
      this.recreate();
      return;
    }
    this.connecting = true;
    configureWorker(this.host, this.wsPort, this.sessionId, this.secret, this.lastSeq, this.mailboxPath);
    Worker.run(receiveLoop);
  }

  reshareNow(): string {
    if (!this.attaching || this.detachRequested) { return ""; }
    this.drainMailbox();
    if (!this.sessionLost) { return ""; }
    this.recreate();
    if (!this.sessionLost) { return ""; }
    return staleShareProblem(this.lastFailure);
  }

  pollInbound(): string[] {
    if (!this.attaching) { return []; }
    this.drainMailbox();
    this.maybeRecover();
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
