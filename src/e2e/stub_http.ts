const HEX_DIGITS: string = "0123456789abcdef";
const MAX_HEAD_SIZE: int = 65536;

export function toHex(n: int): string {
  if (n <= 0) { return "0"; }
  let out = "";
  let v = n;
  while (v > 0) {
    let d = v % 16;
    out = HEX_DIGITS.charAt(d) + out;
    v = v / 16;
  }
  return out;
}

export function chunkedSseResponse(body: string): string {
  let statusLine = "HTTP/1.1 200 OK\r\n";
  let headers = "content-type: text/event-stream\r\n"
    + "transfer-encoding: chunked\r\n"
    + "cache-control: no-cache\r\n"
    + "connection: close\r\n\r\n";
  let chunk = toHex(body.length) + "\r\n" + body + "\r\n";
  let terminator = "0\r\n\r\n";
  return statusLine + headers + chunk + terminator;
}

export type StubRequest = { ok: bool, body: string };

function contentLengthOf(headLines: string[]): int {
  let i: int = 1;
  while (i < headLines.length) {
    let at = headLines[i].indexOf(":");
    if (at > 0) {
      let name = headLines[i].slice(0, at).trim().toLowerCase();
      if (name == "content-length") {
        let value = headLines[i].slice(at + 1, headLines[i].length).trim();
        return Number.parseInt(value, 10) ?? 0;
      }
    }
    i = i + 1;
  }
  return 0;
}

export function readStubRequest(socket: Socket): StubRequest {
  let buffer = "";
  while (buffer.indexOf("\r\n\r\n") < 0) {
    let chunk = socket.read();
    if (chunk == "") {
      let closed: StubRequest = { ok: false, body: "" };
      return closed;
    }
    buffer = buffer + chunk;
    if (buffer.length > MAX_HEAD_SIZE) {
      let tooLarge: StubRequest = { ok: false, body: "" };
      return tooLarge;
    }
  }

  let headEnd = buffer.indexOf("\r\n\r\n");
  let head = buffer.slice(0, headEnd);
  let bodySoFar = buffer.slice(headEnd + 4, buffer.length);
  let lines = head.split("\r\n");
  let want = contentLengthOf(lines);

  let body = bodySoFar;
  while (body.length < want) {
    let chunk = socket.read();
    if (chunk == "") { break; }
    body = body + chunk;
  }

  let ok: StubRequest = { ok: true, body: body };
  return ok;
}

test("toHex converts small and multi-digit lengths", () => {
  expect(toHex(0) == "0");
  expect(toHex(15) == "f");
  expect(toHex(16) == "10");
  expect(toHex(255) == "ff");
  expect(toHex(4096) == "1000");
});

test("chunkedSseResponse frames the body as one chunk plus a terminator", () => {
  let out = chunkedSseResponse("data: hi\n\n");
  expect(out.indexOf("transfer-encoding: chunked") >= 0);
  expect(out.indexOf("a\r\ndata: hi\n\n\r\n") >= 0);
  expect(out.indexOf("0\r\n\r\n") >= 0);
});
