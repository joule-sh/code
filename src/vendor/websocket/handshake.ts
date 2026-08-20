const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type Upgrade = {
  ok: bool,
  path: string,
  key: string,
  protocol: string,
  consumed: int,
  error: string,
  headers: Map<string, string>,
};

export function acceptFor(key: string): string {
  return crypto.base64Encode(crypto.sha1Bytes(key + WS_GUID));
}

export function readUpgrade(buffer: string): Upgrade {
  let waiting: Upgrade = { ok: false, path: "", key: "", protocol: "", consumed: 0, error: "", headers: new Map<string, string>() };
  let end = buffer.indexOf("\r\n\r\n");
  if (end < 0) { return waiting; }

  let head = buffer.slice(0, end);
  let lines = head.split("\r\n");
  if (lines.length < 1) { return waiting; }

  let parts = lines[0].split(" ");
  if (parts.length < 3 || parts[0] != "GET") {
    let notGet: Upgrade = { ok: false, path: "", key: "", protocol: "", consumed: 0,
      error: "an upgrade is a GET, not " + parts[0], headers: new Map<string, string>() };
    return notGet;
  }

  let key = "";
  let upgrade = "";
  let connection = "";
  let version = "";
  let protocol = "";
  let headers = new Map<string, string>();
  let i: int = 1;
  while (i < lines.length) {
    let at = lines[i].indexOf(":");
    if (at > 0) {
      let name = lines[i].slice(0, at).trim().toLowerCase();
      let value = lines[i].slice(at + 1, lines[i].length).trim();
      if (name != "" && value != "") {
        headers.set(name, value);
      }
      if (name == "sec-websocket-key") { key = value; }
      else if (name == "upgrade") { upgrade = value.toLowerCase(); }
      else if (name == "connection") { connection = value.toLowerCase(); }
      else if (name == "sec-websocket-version") { version = value; }
      else if (name == "sec-websocket-protocol") { protocol = value; }
    }
    i = i + 1;
  }

  if (upgrade != "websocket") {
    let notWs: Upgrade = { ok: false, path: parts[1], key: "", protocol: "", consumed: 0,
      error: "not a websocket upgrade", headers: headers };
    return notWs;
  }
  if (connection.indexOf("upgrade") < 0) {
    let noConn: Upgrade = { ok: false, path: parts[1], key: "", protocol: "", consumed: 0,
      error: "the Connection header does not ask to upgrade", headers: headers };
    return noConn;
  }
  if (key == "") {
    let noKey: Upgrade = { ok: false, path: parts[1], key: "", protocol: "", consumed: 0,
      error: "no Sec-WebSocket-Key", headers: headers };
    return noKey;
  }
  if (version != "13") {
    let oldVersion: Upgrade = { ok: false, path: parts[1], key: "", protocol: "", consumed: 0,
      error: "this speaks websocket version 13, not \"" + version + "\"", headers: headers };
    return oldVersion;
  }

  let out: Upgrade = {
    ok: true, path: parts[1], key: key, protocol: protocol,
    consumed: end + 4, error: "", headers: headers,
  };
  return out;
}

export function acceptResponse(key: string, protocol: string): string {
  let out = "HTTP/1.1 101 Switching Protocols\r\n"
    + "Upgrade: websocket\r\n"
    + "Connection: Upgrade\r\n"
    + "Sec-WebSocket-Accept: " + acceptFor(key) + "\r\n";
  if (protocol != "") { out = out + "Sec-WebSocket-Protocol: " + firstProtocol(protocol) + "\r\n"; }
  return out + "\r\n";
}

export function firstProtocol(offered: string): string {
  let at = offered.indexOf(",");
  if (at < 0) { return offered.trim(); }
  return offered.slice(0, at).trim();
}

export function refuseResponse(why: string): string {
  let body = "This endpoint speaks WebSocket: " + why;
  return "HTTP/1.1 400 Bad Request\r\n"
    + "Content-Type: text/plain\r\n"
    + "Content-Length: " + `${body.length}` + "\r\n"
    + "Connection: close\r\n\r\n" + body;
}

export function newKey(): string {
  return crypto.base64Encode(bytesFromHex(crypto.randomBytes(16)));
}

function bytesFromHex(hex: string): string {
  let out = "";
  let i: int = 0;
  while (i + 1 < hex.length) {
    let hi = hexValue(hex.charAt(i));
    let lo = hexValue(hex.charAt(i + 1));
    if (hi < 0 || lo < 0) { return out; }
    out = out + String.fromCharCode(hi * 16 + lo);
    i = i + 2;
  }
  return out;
}

function hexValue(ch: string): int {
  let c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) { return c - 48; }
  if (c >= 97 && c <= 102) { return c - 87; }
  if (c >= 65 && c <= 70) { return c - 55; }
  return -1;
}

export function extraHeaderLines(extraHeaders: Map<string, string>): string {
  let out = "";
  for (const name of extraHeaders.keys()) {
    let value = extraHeaders.get(name) ?? "";
    out = out + name + ": " + value + "\r\n";
  }
  return out;
}

export function upgradeRequest(host: string, port: int, path: string, key: string, extraHeaders: Map<string, string>): string {
  return "GET " + path + " HTTP/1.1\r\n"
    + "Host: " + host + ":" + `${port}` + "\r\n"
    + "Upgrade: websocket\r\n"
    + "Connection: Upgrade\r\n"
    + "Sec-WebSocket-Key: " + key + "\r\n"
    + "Sec-WebSocket-Version: 13\r\n"
    + extraHeaderLines(extraHeaders)
    + "\r\n";
}

export type Accepted = {
  ok: bool,
  consumed: int,
  error: string,
};

export function readAccept(buffer: string, key: string): Accepted {
  let waiting: Accepted = { ok: false, consumed: 0, error: "" };
  let end = buffer.indexOf("\r\n\r\n");
  if (end < 0) { return waiting; }

  let head = buffer.slice(0, end);
  let lines = head.split("\r\n");
  if (lines[0].indexOf("101") < 0) {
    let refused: Accepted = { ok: false, consumed: 0, error: "the server answered " + lines[0] };
    return refused;
  }

  let accept = "";
  let i: int = 1;
  while (i < lines.length) {
    let at = lines[i].indexOf(":");
    if (at > 0 && lines[i].slice(0, at).trim().toLowerCase() == "sec-websocket-accept") {
      accept = lines[i].slice(at + 1, lines[i].length).trim();
    }
    i = i + 1;
  }
  if (accept != acceptFor(key)) {
    let wrong: Accepted = { ok: false, consumed: 0,
      error: "the server's Sec-WebSocket-Accept does not answer our key" };
    return wrong;
  }
  let out: Accepted = { ok: true, consumed: end + 4, error: "" };
  return out;
}
