const net = require("node:net");
const crypto = require("node:crypto");

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function makeAcceptKey(key) {
  return crypto.createHash("sha1").update(key + GUID).digest("base64");
}

function connect(host, port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, host);
    const key = crypto.randomBytes(16).toString("base64");
    let buffer = Buffer.alloc(0);
    let upgraded = false;

    const listeners = { message: [], close: [] };
    const conn = {
      socket,
      onMessage(fn) { listeners.message.push(fn); },
      onClose(fn) { listeners.close.push(fn); },
      send(text) {
        const payload = Buffer.from(text, "utf8");
        const maskKey = crypto.randomBytes(4);
        const masked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
          masked[i] = payload[i] ^ maskKey[i % 4];
        }
        let header;
        if (payload.length < 126) {
          header = Buffer.from([0x81, 0x80 | payload.length]);
        } else if (payload.length < 65536) {
          header = Buffer.alloc(4);
          header[0] = 0x81;
          header[1] = 0x80 | 126;
          header.writeUInt16BE(payload.length, 2);
        } else {
          header = Buffer.alloc(10);
          header[0] = 0x81;
          header[1] = 0x80 | 127;
          header.writeBigUInt64BE(BigInt(payload.length), 2);
        }
        socket.write(Buffer.concat([header, maskKey, masked]));
      },
      close() {
        socket.end();
      },
      destroy() {
        socket.destroy();
      },
    };

    socket.on("connect", () => {
      let headerLines = "";
      for (const [name, value] of Object.entries(headers)) {
        headerLines += `${name}: ${value}\r\n`;
      }
      const req =
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n` +
        headerLines +
        `\r\n`;
      socket.write(req);
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const headEnd = buffer.indexOf("\r\n\r\n");
        if (headEnd < 0) { return; }
        const head = buffer.slice(0, headEnd).toString("utf8");
        buffer = buffer.slice(headEnd + 4);
        if (head.indexOf("101") < 0) {
          reject(new Error("handshake refused: " + head));
          socket.end();
          return;
        }
        const acceptLine = head.split("\r\n").find((l) => l.toLowerCase().startsWith("sec-websocket-accept"));
        const accept = acceptLine ? acceptLine.split(":")[1].trim() : "";
        if (accept !== makeAcceptKey(key)) {
          reject(new Error("bad accept key"));
          socket.end();
          return;
        }
        upgraded = true;
        resolve(conn);
      }
      if (upgraded) {
        drainFrames();
      }
    });

    function drainFrames() {
      while (buffer.length >= 2) {
        const b0 = buffer[0];
        const b1 = buffer[1];
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) { return; }
          len = buffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffer.length < 10) { return; }
          len = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        let maskKey = null;
        if (masked) {
          if (buffer.length < offset + 4) { return; }
          maskKey = buffer.slice(offset, offset + 4);
          offset += 4;
        }
        if (buffer.length < offset + len) { return; }
        let payload = buffer.slice(offset, offset + len);
        if (masked) {
          const unmasked = Buffer.alloc(payload.length);
          for (let i = 0; i < payload.length; i++) {
            unmasked[i] = payload[i] ^ maskKey[i % 4];
          }
          payload = unmasked;
        }
        buffer = buffer.slice(offset + len);
        if (opcode === 0x1) {
          for (const fn of listeners.message) { fn(payload.toString("utf8")); }
        } else if (opcode === 0x8) {
          for (const fn of listeners.close) { fn(); }
          socket.end();
        } else if (opcode === 0x9) {
          const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
          socket.write(pong);
        }
      }
    }

    socket.on("error", (e) => reject(e));
    socket.on("close", () => {
      for (const fn of listeners.close) { fn(); }
    });
  });
}

module.exports = { connect };
