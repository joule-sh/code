import { Peer, send, closePeer, serveWebSocket } from "../vendor/websocket/server.ts";
import { CLOSE_PROTOCOL_ERROR } from "../vendor/websocket/frame.ts";
import { PROTOCOL_VERSION, RESUME, INPUT, CANCEL, APPROVAL_REPLY, ERROR, ErrorFrame, encodeError, decodeResume, frameType } from "../protocol/frames.ts";
import { SessionStore } from "./store.ts";

const ROLE_TERMINAL: string = "terminal";
const ROLE_BROWSER: string = "browser";
const ROLE_UNKNOWN: string = "";

export class PeerRegistry {
  terminals: Map<string, Peer>;
  browsers: Map<string, Peer>;

  constructor() {
    this.terminals = new Map<string, Peer>();
    this.browsers = new Map<string, Peer>();
  }
}

function roleForPath(path: string): string {
  if (path.startsWith("/sessions/") && path.endsWith("/ws")) { return ROLE_TERMINAL; }
  if (path.startsWith("/w/") && path.endsWith("/ws")) { return ROLE_BROWSER; }
  return ROLE_UNKNOWN;
}

function sessionIdFromPath(path: string, prefix: string, suffix: string): string {
  if (path.length <= prefix.length + suffix.length) { return ""; }
  return path.slice(prefix.length, path.length - suffix.length);
}

function refusalMessage(code: string): string {
  if (code == "wrong_user") { return "frames are refused to a different paired uuid"; }
  if (code == "not_paired") { return "this session has not been paired to a browser yet"; }
  if (code == "session_not_found") { return "no such session"; }
  if (code == "resume_gap") { return "the ring no longer holds frames since that seq, some frames were missed"; }
  if (code == "unsupported_frame") { return "this frame type is not accepted from a browser"; }
  return code;
}

function sendRefusal(peer: Peer, code: string): void {
  let err: ErrorFrame = { v: PROTOCOL_VERSION, seq: 0, type: ERROR, code: code, message: refusalMessage(code) };
  send(peer, encodeError(err));
}

function replayTo(store: SessionStore, peer: Peer, sessionId: string, message: string): void {
  let resume = decodeResume(message);
  let since: int = -1;
  if (resume != null) { since = resume.since; }
  let outcome = store.replay(sessionId, since);
  if (!outcome.ok) {
    sendRefusal(peer, "resume_gap");
    return;
  }
  for (const f of outcome.frames) {
    send(peer, f);
  }
}

function handleTerminalMessage(store: SessionStore, registry: PeerRegistry, peer: Peer, message: string): void {
  let sessionId = sessionIdFromPath(peer.path, "/sessions/", "/ws");
  if (sessionId == "") {
    closePeer(peer, CLOSE_PROTOCOL_ERROR, "bad path");
    return;
  }
  let secret = peer.headers.get("x-relay-secret") ?? "";
  if (!store.authorizeTerminal(sessionId, secret)) {
    closePeer(peer, 4401, "unauthorized");
    return;
  }
  registry.terminals.set(sessionId, peer);

  let now: i64 = Date.now();
  let type = frameType(message);
  if (type == RESUME) {
    replayTo(store, peer, sessionId, message);
    return;
  }
  store.appendFrame(sessionId, message, now);
  let browser = registry.browsers.get(sessionId);
  if (browser != null && browser.open) {
    send(browser, message);
  }
}

function handleBrowserMessage(store: SessionStore, registry: PeerRegistry, peer: Peer, message: string): void {
  let sessionId = sessionIdFromPath(peer.path, "/w/", "/ws");
  if (sessionId == "") {
    closePeer(peer, CLOSE_PROTOCOL_ERROR, "bad path");
    return;
  }
  let userId = peer.headers.get("x-user") ?? "";
  let rec = store.find(sessionId);
  if (rec == null) {
    sendRefusal(peer, "session_not_found");
    closePeer(peer, 4404, "refused");
    return;
  }
  if (rec.pairedUserId == "") {
    sendRefusal(peer, "not_paired");
    closePeer(peer, 4403, "refused");
    return;
  }
  if (rec.pairedUserId != userId) {
    sendRefusal(peer, "wrong_user");
    closePeer(peer, 4403, "refused");
    return;
  }
  registry.browsers.set(sessionId, peer);

  let now: i64 = Date.now();
  let type = frameType(message);
  if (type == RESUME) {
    replayTo(store, peer, sessionId, message);
    return;
  }
  if (type != INPUT && type != CANCEL && type != APPROVAL_REPLY) {
    sendRefusal(peer, "unsupported_frame");
    return;
  }
  store.appendFrame(sessionId, message, now);
  let terminal = registry.terminals.get(sessionId);
  if (terminal != null && terminal.open) {
    send(terminal, message);
  }
}

export function makeOnMessage(store: SessionStore, registry: PeerRegistry): (peer: Peer, message: string) => void {
  return (peer: Peer, message: string) => {
    let role = roleForPath(peer.path);
    if (role == ROLE_TERMINAL) {
      handleTerminalMessage(store, registry, peer, message);
      return;
    }
    if (role == ROLE_BROWSER) {
      handleBrowserMessage(store, registry, peer, message);
      return;
    }
    closePeer(peer, CLOSE_PROTOCOL_ERROR, "unknown path");
  };
}

export function serveRelayWebSocket(port: int, store: SessionStore, registry: PeerRegistry): void {
  serveWebSocket(port, makeOnMessage(store, registry));
}
