import { Peer, send, closePeer, handleConnection } from "../vendor/websocket/server.ts";
import { CLOSE_PROTOCOL_ERROR } from "../vendor/websocket/frame.ts";
import { PROTOCOL_VERSION, RESUME, INPUT, CANCEL, APPROVAL_REPLY, ERROR, ErrorFrame, encodeError, decodeResume, frameType, frameSeq } from "../protocol/frames.ts";
import { appendMailbox, MailboxReader } from "../tasks/mailbox.ts";
import { splitPathAndQuery, queryParam } from "./query.ts";
import { toBrowserLogPath, toTerminalLogPath } from "./relay_paths.ts";
import { callStore } from "./relay_rpc.ts";
import { CMD_CONNECT, CMD_DETACH, ROLE_TERMINAL_CMD, ROLE_BROWSER_CMD, ConnectCommand, ConnectResult, encodeConnectCommand, decodeConnectResult, DetachCommand, encodeDetachCommand } from "./store_commands.ts";

export const PUSH_POLL_MS: int = 60;

export function sessionIdFromPath(pathname: string, prefix: string, suffix: string): string {
  if (pathname.length <= prefix.length + suffix.length) { return ""; }
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) { return ""; }
  return pathname.slice(prefix.length, pathname.length - suffix.length);
}

export function browserUserIdFrom(headerValue: string, query: string): string {
  if (headerValue != "") { return headerValue; }
  return queryParam(query, "x-user");
}

function refusalMessage(code: string): string {
  if (code == "wrong_user") { return "frames are refused to a different paired uuid"; }
  if (code == "not_paired") { return "this session has not been paired to a browser yet"; }
  if (code == "session_not_found") { return "no such session"; }
  if (code == "unsupported_frame") { return "this frame type is not accepted from a browser"; }
  return code;
}

function sendRefusal(peer: Peer, code: string): void {
  let err: ErrorFrame = { v: PROTOCOL_VERSION, seq: 0, type: ERROR, code: code, message: refusalMessage(code) };
  send(peer, encodeError(err));
}

function closeCodeForRefusal(code: string): int {
  if (code == "session_not_found") { return 4404; }
  return 4403;
}

function sinceFromResume(message: string): int {
  let resume = decodeResume(message);
  if (resume == null) { return -1; }
  return resume.since;
}

function connectRpc(runtimeDir: string, sessionId: string, role: string, credential: string): ConnectResult {
  let cmd: ConnectCommand = { kind: CMD_CONNECT, sessionId: sessionId, role: role, credential: credential, now: Date.now() };
  let resultJson = callStore(runtimeDir, encodeConnectCommand(cmd));
  let parsed = decodeConnectResult(resultJson);
  if (parsed == null) {
    let timedOut: ConnectResult = { ok: false, refusal: "relay_timeout" };
    return timedOut;
  }
  return parsed;
}

function detachRpc(runtimeDir: string, sessionId: string): void {
  let cmd: DetachCommand = { kind: CMD_DETACH, sessionId: sessionId };
  callStore(runtimeDir, encodeDetachCommand(cmd));
}

function pusherLoop(peer: Peer, logPath: string, since: int, filterBySeq: bool): int {
  let reader = new MailboxReader(logPath);
  if (!filterBySeq) { reader.drainNew(); }
  let watermark = since;
  let pushed = 0;
  while (peer.open) {
    let entries = reader.drainNew();
    for (const e of entries) {
      if (filterBySeq) {
        let seq = frameSeq(e.payload);
        if (seq > watermark) {
          send(peer, e.payload);
          watermark = seq;
          pushed = pushed + 1;
        }
      } else {
        send(peer, e.payload);
        pushed = pushed + 1;
      }
    }
    process.sleep(PUSH_POLL_MS);
  }
  return pushed;
}

class ConnState {
  runtimeDir: string;
  sessionId: string;
  authorized: bool;
  pusherStarted: bool;
  constructor(runtimeDir: string) {
    this.runtimeDir = runtimeDir;
    this.sessionId = "";
    this.authorized = false;
    this.pusherStarted = false;
  }
}

export function serveTerminalWebSocket(port: int, runtimeDir: string): void {
  net.createServer(port, (socket: Socket) => {
    let state = new ConnState(runtimeDir);

    let onMessage = (peer: Peer, message: string) => {
      if (!state.authorized) {
        let pathname = splitPathAndQuery(peer.path).pathname;
        let sid = sessionIdFromPath(pathname, "/sessions/", "/ws");
        if (sid == "") { closePeer(peer, CLOSE_PROTOCOL_ERROR, "bad path"); return; }
        let secret = peer.headers.get("x-relay-secret") ?? "";
        let result = connectRpc(state.runtimeDir, sid, ROLE_TERMINAL_CMD, secret);
        if (!result.ok) { closePeer(peer, 4401, "unauthorized"); return; }
        state.sessionId = sid;
        state.authorized = true;
      }

      let type = frameType(message);
      if (!state.pusherStarted) {
        state.pusherStarted = true;
        let since = -1;
        if (type == RESUME) { since = sinceFromResume(message); }
        let logPath = toTerminalLogPath(state.runtimeDir, state.sessionId);
        Worker.run(() => { return pusherLoop(peer, logPath, since, false); });
        if (type == RESUME) { return; }
      } else if (type == RESUME) {
        return;
      }

      appendMailbox(toBrowserLogPath(state.runtimeDir, state.sessionId), "F", message);
    };

    let onClose = (peer: Peer, graceful: bool) => {
      if (!graceful || !state.authorized) { return; }
      detachRpc(state.runtimeDir, state.sessionId);
    };

    handleConnection(socket, onMessage, onClose);
  });
}

export function serveBrowserWebSocket(port: int, runtimeDir: string): void {
  net.createServer(port, (socket: Socket) => {
    let state = new ConnState(runtimeDir);

    let onMessage = (peer: Peer, message: string) => {
      if (!state.authorized) {
        let split = splitPathAndQuery(peer.path);
        let sid = sessionIdFromPath(split.pathname, "/w/", "/ws");
        if (sid == "") { closePeer(peer, CLOSE_PROTOCOL_ERROR, "bad path"); return; }
        let userId = browserUserIdFrom(peer.headers.get("x-user") ?? "", split.query);
        let result = connectRpc(state.runtimeDir, sid, ROLE_BROWSER_CMD, userId);
        if (!result.ok) {
          sendRefusal(peer, result.refusal);
          closePeer(peer, closeCodeForRefusal(result.refusal), "refused");
          return;
        }
        state.sessionId = sid;
        state.authorized = true;
      }

      let type = frameType(message);
      if (!state.pusherStarted) {
        state.pusherStarted = true;
        let since = -1;
        if (type == RESUME) { since = sinceFromResume(message); }
        let logPath = toBrowserLogPath(state.runtimeDir, state.sessionId);
        Worker.run(() => { return pusherLoop(peer, logPath, since, true); });
        if (type == RESUME) { return; }
      } else if (type == RESUME) {
        return;
      }

      if (type != INPUT && type != CANCEL && type != APPROVAL_REPLY) {
        sendRefusal(peer, "unsupported_frame");
        return;
      }

      appendMailbox(toTerminalLogPath(state.runtimeDir, state.sessionId), "F", message);
    };

    let onClose = (peer: Peer, graceful: bool) => {};

    handleConnection(socket, onMessage, onClose);
  });
}
