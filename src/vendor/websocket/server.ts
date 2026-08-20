import { Frame, Assembly, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG, CLOSE_NORMAL, CLOSE_PROTOCOL_ERROR, CLOSE_TOO_LARGE, encodeFrame, decodeFrame, encodeClose, closeCodeOf, newAssembly, addFrame } from "./frame.ts";
import { Step, STEP_WAIT, STEP_MESSAGE, STEP_PONG, STEP_CLOSE, STEP_FAIL, drain } from "./session.ts";
import { Upgrade, readUpgrade, acceptResponse, refuseResponse } from "./handshake.ts";

const MAX_MESSAGE: int = 8 * 1024 * 1024;

export type Peer = {
  socket: Socket,
  path: string,
  open: bool,
  headers: Map<string, string>,
};

export function send(peer: Peer, message: string): void {
  if (!peer.open) { return; }
  peer.socket.write(encodeFrame(OP_TEXT, message, false, ""));
}

export function sendBinary(peer: Peer, payload: string): void {
  if (!peer.open) { return; }
  peer.socket.write(encodeFrame(OP_BINARY, payload, false, ""));
}

export function ping(peer: Peer, payload: string): void {
  if (!peer.open) { return; }
  peer.socket.write(encodeFrame(OP_PING, payload, false, ""));
}

export function closePeer(peer: Peer, code: int, reason: string): void {
  if (peer.open) {
    peer.socket.write(encodeClose(code, reason, false, ""));
  }
  peer.socket.close();
}

export function serveWebSocket(port: int, onMessage: (peer: Peer, message: string) => void, onClose: (peer: Peer, graceful: bool) => void): void {
  net.createServer(port, (socket: Socket) => {
    handleConnection(socket, onMessage, onClose);
  });
}

export function handleConnection(socket: Socket, onMessage: (peer: Peer, message: string) => void, onClose: (peer: Peer, graceful: bool) => void): void {
  let buffer = "";
  let upgraded: Upgrade = { ok: false, path: "", key: "", protocol: "", consumed: 0, error: "", headers: new Map<string, string>() };
  while (!upgraded.ok) {
    let chunk = socket.read();
    if (chunk == "") {
      socket.close();
      return;
    }
    buffer = buffer + chunk;
    upgraded = readUpgrade(buffer);
    if (upgraded.error != "") {
      socket.write(refuseResponse(upgraded.error));
      socket.close();
      return;
    }
    if (buffer.length > 64 * 1024) {
      socket.write(refuseResponse("the request headers are too large"));
      socket.close();
      return;
    }
  }

  socket.write(acceptResponse(upgraded.key, upgraded.protocol));

  buffer = buffer.slice(upgraded.consumed, buffer.length);

  let peer: Peer = { socket: socket, path: upgraded.path, open: true, headers: upgraded.headers };
  let assembly = newAssembly();

  while (true) {
    while (true) {
      let step = drain(buffer, assembly, MAX_MESSAGE, true);
      buffer = step.buffer;
      assembly = step.assembly;

      if (step.what == STEP_WAIT) { break; }
      if (step.what == STEP_FAIL) {
        closePeer(peer, CLOSE_PROTOCOL_ERROR, step.error);
        onClose(peer, false);
        return;
      }
      if (step.what == STEP_CLOSE) {
        closePeer(peer, step.code, "");
        onClose(peer, true);
        return;
      }
      if (step.what == STEP_PONG) {
        socket.write(encodeFrame(OP_PONG, step.message, false, ""));
        continue;
      }
      onMessage(peer, step.message);
    }

    let chunk = socket.read();
    if (chunk == "") {
      socket.close();
      onClose(peer, false);
      return;
    }
    buffer = buffer + chunk;
    if (buffer.length > MAX_MESSAGE + 65536) {
      closePeer(peer, CLOSE_TOO_LARGE, "message too large");
      onClose(peer, false);
      return;
    }
  }
}
