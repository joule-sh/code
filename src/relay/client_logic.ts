import { frameSeq, INPUT, CANCEL, APPROVAL_REPLY } from "../protocol/frames.ts";

export const OUTBOUND_BUFFER_CAP: int = 500;
export const BACKOFF_START_MS: i64 = 500;
export const BACKOFF_CAP_MS: i64 = 10000;

export const TAG_FRAME: string = "FRAME";
export const TAG_CONNECTED: string = "CTRL:CONNECTED";
export const TAG_DISCONNECTED: string = "CTRL:DISCONNECTED";
export const TAG_CONNECT_FAILED: string = "CTRL:CONNECT_FAILED";

export function nextBackoffMs(currentMs: i64): i64 {
  let doubled = currentMs * 2;
  if (doubled > BACKOFF_CAP_MS) { return BACKOFF_CAP_MS; }
  if (doubled < BACKOFF_START_MS) { return BACKOFF_START_MS; }
  return doubled;
}

export function maxSeqSeen(current: int, frameJson: string): int {
  let s = frameSeq(frameJson);
  if (s > current) { return s; }
  return current;
}

export type BufferPush = { buffer: string[], overflowed: bool };

export function pushBounded(buffer: string[], cap: int, frameJson: string): BufferPush {
  let out = [...buffer, frameJson];
  let overflowed = false;
  if (out.length > cap) {
    out = out.slice(1);
    overflowed = true;
  }
  let r: BufferPush = { buffer: out, overflowed: overflowed };
  return r;
}

export function isDownstreamAllowed(t: string): bool {
  return t == INPUT || t == CANCEL || t == APPROVAL_REPLY;
}

export function encodeMailboxFrame(frameJson: string): string {
  return TAG_FRAME + "|" + frameJson;
}

export function encodeMailboxControl(tag: string, detail: string): string {
  return tag + "|" + detail;
}

export type MailboxLine = { tag: string, payload: string };

export function parseMailboxLine(line: string): MailboxLine {
  let bar = line.indexOf("|");
  if (bar < 0) {
    let empty: MailboxLine = { tag: "", payload: "" };
    return empty;
  }
  let out: MailboxLine = { tag: line.slice(0, bar), payload: line.slice(bar + 1, line.length) };
  return out;
}

export function nonEmptyLines(content: string): string[] {
  let raw = content.split("\n");
  let out: string[] = [];
  let i: int = 0;
  while (i < raw.length) {
    if (raw[i] != "") { out.push(raw[i]); }
    i = i + 1;
  }
  return out;
}

export function mailboxPathFor(tmpDir: string, sessionId: string): string {
  return tmpDir + "/joule-relay-" + sessionId + ".mailbox";
}

export function webUrlFor(baseUrl: string, code: string): string {
  return baseUrl + code;
}

export type RelayConfig = { host: string, httpPort: int, wsPort: int, webBaseUrl: string, tmpDir: string };

export function resolveRelayConfig(rawHost: string, rawHttpPort: string, rawWsPort: string, rawWebBaseUrl: string, rawTmpDir: string): RelayConfig {
  let host = rawHost;
  if (host == "") { host = "127.0.0.1"; }
  let httpPort = Number.parseInt(rawHttpPort, 10) ?? 8090;
  let wsPort = Number.parseInt(rawWsPort, 10) ?? 8091;
  let webBaseUrl = rawWebBaseUrl;
  if (webBaseUrl == "") { webBaseUrl = "https://joule.sh/w/"; }
  let tmpDir = rawTmpDir;
  if (tmpDir == "") { tmpDir = "/tmp"; }
  let cfg: RelayConfig = { host: host, httpPort: httpPort, wsPort: wsPort, webBaseUrl: webBaseUrl, tmpDir: tmpDir };
  return cfg;
}

export function loadRelayConfig(): RelayConfig {
  let rawHost = process.env("JOULE_RELAY_HOST") ?? "";
  let rawHttpPort = process.env("JOULE_RELAY_HTTP_PORT") ?? "";
  let rawWsPort = process.env("JOULE_RELAY_WS_PORT") ?? "";
  let rawWebBaseUrl = process.env("JOULE_WEB_BASE_URL") ?? "";
  let rawTmpDir = process.env("TMPDIR") ?? "";
  return resolveRelayConfig(rawHost, rawHttpPort, rawWsPort, rawWebBaseUrl, rawTmpDir);
}
