import { SessionStore } from "./store.ts";
import { makeHttpHandler, RelayHttpRequest, RelayHttpResponse } from "./http.ts";

const MAX_HEAD_SIZE: int = 65536;
const STATUS_REASONS: Map<int, string> = http.STATUS_CODES();

type ParsedRequest = {
  ok: bool,
  req: RelayHttpRequest,
  error: string,
};

type ParsedHeaders = {
  headers: Map<string, string>,
  contentLength: int,
  chunked: bool,
};

function reasonPhrase(status: int): string {
  return STATUS_REASONS.get(status) ?? "Unknown";
}

function emptyRequest(): RelayHttpRequest {
  let req: RelayHttpRequest = { method: "", path: "", body: "", headers: new Map<string, string>() };
  return req;
}

function parseHeaderLines(lines: string[]): ParsedHeaders {
  let headers = new Map<string, string>();
  let contentLength: int = 0;
  let chunked = false;
  let i: int = 1;
  while (i < lines.length) {
    let at = lines[i].indexOf(":");
    if (at > 0) {
      let name = lines[i].slice(0, at).trim().toLowerCase();
      let value = lines[i].slice(at + 1, lines[i].length).trim();
      if (name != "" && value != "") {
        headers.set(name, value);
        if (name == "content-length") { contentLength = Number.parseInt(value, 10) ?? 0; }
        if (name == "transfer-encoding" && value.toLowerCase().indexOf("chunked") >= 0) { chunked = true; }
      }
    }
    i = i + 1;
  }
  let out: ParsedHeaders = { headers: headers, contentLength: contentLength, chunked: chunked };
  return out;
}

function readRequest(socket: Socket): ParsedRequest {
  let buffer = "";
  while (buffer.indexOf("\r\n\r\n") < 0) {
    let chunk = socket.read();
    if (chunk == "") {
      let closed: ParsedRequest = { ok: false, req: emptyRequest(), error: "" };
      return closed;
    }
    buffer = buffer + chunk;
    if (buffer.length > MAX_HEAD_SIZE) {
      let tooLarge: ParsedRequest = { ok: false, req: emptyRequest(), error: "request headers too large" };
      return tooLarge;
    }
  }

  let headEnd = buffer.indexOf("\r\n\r\n");
  let head = buffer.slice(0, headEnd);
  let bodySoFar = buffer.slice(headEnd + 4, buffer.length);
  let lines = head.split("\r\n");
  let requestLine = lines[0].split(" ");
  if (requestLine.length < 2) {
    let bad: ParsedRequest = { ok: false, req: emptyRequest(), error: "malformed request line" };
    return bad;
  }
  let method = requestLine[0];
  let path = requestLine[1];

  let parsedHeaders = parseHeaderLines(lines);
  if (parsedHeaders.chunked) {
    let unsupported: ParsedRequest = { ok: false, req: emptyRequest(), error: "chunked request bodies are not supported" };
    return unsupported;
  }

  let body = bodySoFar;
  while (body.length < parsedHeaders.contentLength) {
    let chunk = socket.read();
    if (chunk == "") { break; }
    body = body + chunk;
  }

  let req: RelayHttpRequest = { method: method, path: path, body: body, headers: parsedHeaders.headers };
  let ok: ParsedRequest = { ok: true, req: req, error: "" };
  return ok;
}

function transportError(status: int, message: string): RelayHttpResponse {
  let h = new Map<string, string>();
  h.set("content-type", "application/json");
  let resp: RelayHttpResponse = { status: status, body: "{\"error\":\"" + message + "\"}", ok: false, headers: h };
  return resp;
}

function headerLines(headers: Map<string, string>): string {
  let out = "";
  for (const name of headers.keys()) {
    out = out + name + ": " + (headers.get(name) ?? "") + "\r\n";
  }
  return out;
}

function writeResponse(socket: Socket, resp: RelayHttpResponse): void {
  let statusLine = "HTTP/1.1 " + `${resp.status}` + " " + reasonPhrase(resp.status) + "\r\n";
  let out = statusLine
    + headerLines(resp.headers)
    + "content-length: " + `${resp.body.length}` + "\r\n"
    + "connection: close\r\n\r\n"
    + resp.body;
  socket.write(out);
  socket.close();
}

export function socketHandler(store: SessionStore): (socket: Socket) => void {
  return (socket: Socket) => {
    let parsed = readRequest(socket);
    if (!parsed.ok) {
      if (parsed.error != "") {
        writeResponse(socket, transportError(400, parsed.error));
      } else {
        socket.close();
      }
      return;
    }
    let handler = makeHttpHandler(store);
    let resp = handler(parsed.req);
    writeResponse(socket, resp);
  };
}
