import { Connection, httpStreamTransport } from "./client.ts";
import { newKey, acceptFor } from "./handshake.ts";

export function connectWebSocketTls(baseUrl: string, path: string, extraHeaders: Map<string, string>): Connection {
  let key = newKey();
  let headers = new Map<string, string>();
  for (const name of extraHeaders.keys()) {
    headers.set(name, extraHeaders.get(name) ?? "");
  }
  headers.set("Connection", "Upgrade");
  headers.set("Upgrade", "websocket");
  headers.set("Sec-WebSocket-Version", "13");
  headers.set("Sec-WebSocket-Key", key);

  let stream = http.stream(baseUrl + path, "GET", "", headers);
  let status = stream.status();
  if (status != 101) {
    stream.close();
    let refused: Connection = { socket: httpStreamTransport(stream), ok: false, buffer: "", open: false,
      error: "the relay answered " + `${status}` + " to the websocket upgrade" };
    return refused;
  }

  let accept = stream.header("sec-websocket-accept");
  if (accept != acceptFor(key)) {
    stream.close();
    let wrong: Connection = { socket: httpStreamTransport(stream), ok: false, buffer: "", open: false,
      error: "the relay's Sec-WebSocket-Accept does not answer our key" };
    return wrong;
  }

  let out: Connection = { socket: httpStreamTransport(stream), ok: true, buffer: "", open: true, error: "" };
  return out;
}
