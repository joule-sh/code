import { Step, STEP_WAIT, STEP_MESSAGE, STEP_PONG, STEP_CLOSE, STEP_FAIL, drain } from "./session.ts";
import { Frame, Assembly, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG, CLOSE_NORMAL, encodeFrame, decodeFrame, encodeClose, newAssembly, addFrame } from "./frame.ts";
import { Accepted, newKey, upgradeRequest, readAccept } from "./handshake.ts";

export type Transport = {
  write: (chunk: string) => void,
  read: () => string,
  close: () => void,
};

export function socketTransport(sock: Socket): Transport {
  let t: Transport = {
    write: (chunk: string) => sock.write(chunk),
    read: () => sock.read(),
    close: () => sock.close(),
  };
  return t;
}

export function httpStreamTransport(stream: HttpStream): Transport {
  let t: Transport = {
    write: (chunk: string) => stream.write(chunk),
    read: () => stream.read(),
    close: () => stream.close(),
  };
  return t;
}

export type Connection = {
  socket: Transport,
  ok: bool,
  buffer: string,
  open: bool,
  error: string,
};

export type Exchange = {
  conn: Connection,
  received: Received,
};

export type Received = {
  ok: bool,
  kind: string,
  message: string,
  error: string,
};

export function connectWebSocket(host: string, port: int, path: string, extraHeaders: Map<string, string>): Connection {
  let socket = net.connect(host, port);
  let key = newKey();
  socket.write(upgradeRequest(host, port, path, key, extraHeaders));

  let buffer = "";
  while (true) {
    let answer = readAccept(buffer, key);
    if (answer.error != "") {
      socket.close();
      let refused: Connection = { socket: socketTransport(socket), ok: false, buffer: "", open: false, error: answer.error };
      return refused;
    }
    if (answer.ok) {
      let out: Connection = {
        socket: socketTransport(socket), ok: true,
        buffer: buffer.slice(answer.consumed, buffer.length),
        open: true, error: "",
      };
      return out;
    }
    let chunk = socket.read();
    if (chunk == "") {
      socket.close();
      let dead: Connection = { socket: socketTransport(socket), ok: false, buffer: "", open: false,
        error: "the server closed during the handshake" };
      return dead;
    }
    buffer = buffer + chunk;
  }
  let never: Connection = { socket: socketTransport(socket), ok: false, buffer: "", open: false, error: "unreachable" };
  return never;
}

function maskKey(): string {
  let hex = crypto.randomBytes(4);
  let out = "";
  let i: int = 0;
  while (i + 1 < hex.length && out.length < 4) {
    out = out + String.fromCharCode(hexPair(hex.charAt(i), hex.charAt(i + 1)));
    i = i + 2;
  }
  while (out.length < 4) { out = out + String.fromCharCode(0); }
  return out;
}

function hexPair(hi: string, lo: string): int {
  return hexValue(hi) * 16 + hexValue(lo);
}

function hexValue(ch: string): int {
  let c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) { return c - 48; }
  if (c >= 97 && c <= 102) { return c - 87; }
  if (c >= 65 && c <= 70) { return c - 55; }
  return 0;
}

export function sendText(conn: Connection, message: string): void {
  if (!conn.open) { return; }
  conn.socket.write(encodeFrame(OP_TEXT, message, true, maskKey()));
}

export function sendBinaryFrame(conn: Connection, payload: string): void {
  if (!conn.open) { return; }
  conn.socket.write(encodeFrame(OP_BINARY, payload, true, maskKey()));
}

export function sendPing(conn: Connection, payload: string): void {
  if (!conn.open) { return; }
  conn.socket.write(encodeFrame(OP_PING, payload, true, maskKey()));
}

export function receive(conn: Connection): Exchange {
  let assembly = newAssembly();
  let buffer = conn.buffer;
  while (true) {
    while (true) {
      let step = drain(buffer, assembly, 8 * 1024 * 1024, false);
      buffer = step.buffer;
      assembly = step.assembly;

      if (step.what == STEP_WAIT) { break; }
      if (step.what == STEP_FAIL) {
        let broken: Received = { ok: false, kind: "", message: "", error: step.error };
        return exchange(withBuffer(conn, buffer, conn.open), broken);
      }
      if (step.what == STEP_PONG) {
        conn.socket.write(encodeFrame(OP_PONG, step.message, true, maskKey()));
        continue;
      }
      if (step.what == STEP_CLOSE) {
        let closed: Received = { ok: true, kind: "close", message: step.message, error: "" };
        return exchange(withBuffer(conn, buffer, false), closed);
      }
      let kind = "text";
      if (step.opcode == OP_BINARY) { kind = "binary"; }
      let got: Received = { ok: true, kind: kind, message: step.message, error: "" };
      return exchange(withBuffer(conn, buffer, conn.open), got);
    }

    let chunk = conn.socket.read();
    if (chunk == "") {
      let hungUp: Received = { ok: false, kind: "", message: "", error: "the peer closed the connection" };
      return exchange(withBuffer(conn, buffer, false), hungUp);
    }
    buffer = buffer + chunk;
  }
  let never: Received = { ok: false, kind: "", message: "", error: "unreachable" };
  return exchange(conn, never);
}

function exchange(conn: Connection, received: Received): Exchange {
  let e: Exchange = { conn: conn, received: received };
  return e;
}

function withBuffer(conn: Connection, buffer: string, open: bool): Connection {
  let out: Connection = {
    socket: conn.socket, ok: conn.ok, buffer: buffer, open: open, error: conn.error,
  };
  return out;
}

export function sendClose(conn: Connection, code: int, reason: string): void {
  if (!conn.open) { return; }
  conn.socket.write(encodeClose(code, reason, true, maskKey()));
}
