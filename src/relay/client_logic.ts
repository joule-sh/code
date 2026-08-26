import { frameSeq, INPUT, CANCEL, APPROVAL_REPLY } from "../protocol/frames.ts";
import { envOr } from "../vendor/platform/platform.ts";

export const OUTBOUND_BUFFER_CAP: int = 500;
export const BACKOFF_START_MS: i64 = 500;
export const BACKOFF_CAP_MS: i64 = 10000;
export const UNREACHABLE_QUIET_MS: i64 = 5000;

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

export function shouldSayUnreachable(retryFailed: bool, alreadySaid: bool, outageSince: i64, now: i64): bool {
  if (!retryFailed || alreadySaid) { return false; }
  if (outageSince == 0) { return false; }
  return now - outageSince >= UNREACHABLE_QUIET_MS;
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
  if (baseUrl == "") { return ""; }
  if (baseUrl.indexOf("?") >= 0) { return baseUrl + "&code=" + code; }
  return baseUrl + "?code=" + code;
}

export const RELAY_URL_ENV: string = "JOULE_RELAY_URL";
export const RELAY_WS_URL_ENV: string = "JOULE_RELAY_WS_URL";
export const WEB_URL_ENV: string = "JOULE_WEB_BASE_URL";

export type Endpoint = { host: string, port: int, ok: bool };

function schemePort(url: string): int {
  let t = url.trim().toLowerCase();
  if (t.startsWith("https://") || t.startsWith("wss://")) { return 443; }
  if (t.startsWith("http://") || t.startsWith("ws://")) { return 80; }
  return 0;
}

function lastColon(text: string): int {
  let i = text.length - 1;
  while (i >= 0) {
    if (text.charAt(i) == ":") { return i; }
    i = i - 1;
  }
  return -1;
}

export function splitEndpoint(url: string): Endpoint {
  let none: Endpoint = { host: "", port: 0, ok: false };
  let text = url.trim();
  let scheme = text.indexOf("://");
  if (scheme >= 0) { text = text.slice(scheme + 3, text.length); }
  let slash = text.indexOf("/");
  if (slash >= 0) { text = text.slice(0, slash); }
  if (text == "") { return none; }
  let colon = lastColon(text);
  if (colon < 0) {
    let implied = schemePort(url);
    if (implied == 0) { return none; }
    let bare: Endpoint = { host: text, port: implied, ok: true };
    return bare;
  }
  let host = text.slice(0, colon);
  let port = Number.parseInt(text.slice(colon + 1, text.length), 10) ?? 0;
  if (host == "" || port <= 0) { return none; }
  let out: Endpoint = { host: host, port: port, ok: true };
  return out;
}

export type RelayConfig = { host: string, httpPort: int, wsPort: int, webBaseUrl: string, tmpDir: string, configured: bool };

export function resolveRelayConfig(rawRelayUrl: string, rawRelayWsUrl: string, rawWebUrl: string, rawTmpDir: string): RelayConfig {
  let httpAt = splitEndpoint(rawRelayUrl);
  let wsAt = splitEndpoint(rawRelayWsUrl);
  let webBaseUrl = rawWebUrl.trim();
  let tmpDir = rawTmpDir;
  if (tmpDir == "") { tmpDir = "/tmp"; }
  let cfg: RelayConfig = {
    host: httpAt.host, httpPort: httpAt.port, wsPort: wsAt.port,
    webBaseUrl: webBaseUrl, tmpDir: tmpDir,
    configured: httpAt.ok && wsAt.ok && webBaseUrl != "",
  };
  return cfg;
}

export function loadRelayConfig(credRelayUrl: string, credRelayWsUrl: string, credWebUrl: string): RelayConfig {
  let relayUrl = envOr(RELAY_URL_ENV, "");
  if (relayUrl == "") { relayUrl = credRelayUrl; }
  let relayWsUrl = envOr(RELAY_WS_URL_ENV, "");
  if (relayWsUrl == "") { relayWsUrl = credRelayWsUrl; }
  let webUrl = envOr(WEB_URL_ENV, "");
  if (webUrl == "") { webUrl = credWebUrl; }
  return resolveRelayConfig(relayUrl, relayWsUrl, webUrl, envOr("TMPDIR", ""));
}

export function shareProblem(server: string, credentialSecret: string, cfg: RelayConfig): string {
  if (credentialSecret == "") {
    return "not signed in to " + server + "\n"
      + "  a shared terminal is watched from that console, under your\n"
      + "  account, so sharing needs its credential. Run /login.";
  }
  if (!cfg.configured) {
    return server + " did not say where its relay is\n"
      + "  sign in again with /login to pick that up, or set\n"
      + "  " + RELAY_URL_ENV + ", " + RELAY_WS_URL_ENV + " and " + WEB_URL_ENV + ".";
  }
  return "";
}
