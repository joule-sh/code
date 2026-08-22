export const DEFAULT_SERVER: string = "https://joule.sh";
export const SERVER_ENV: string = "JOULE_CODE_SERVER";
export const INSECURE_ENV: string = "JOULE_CODE_ALLOW_INSECURE_HTTP";

export const SERVER_OK: string = "ok";
export const SERVER_BAD_URL: string = "bad-url";
export const SERVER_INSECURE: string = "insecure";

export type ServerCheck = { status: string, base: string, message: string };

function stripTrailingSlashes(text: string): string {
  let out = text;
  while (out.length > 0 && out.endsWith("/")) {
    out = out.slice(0, out.length - 1);
  }
  return out;
}

export function normalizeServer(raw: string): string {
  let text = stripTrailingSlashes(raw.trim());
  let at = text.indexOf("://");
  if (at < 0) { return text; }
  let scheme = text.slice(0, at).toLowerCase();
  let rest = text.slice(at + 3, text.length);
  let slash = rest.indexOf("/");
  if (slash < 0) { return scheme + "://" + rest.toLowerCase(); }
  return scheme + "://" + rest.slice(0, slash).toLowerCase() + rest.slice(slash, rest.length);
}

export function serverScheme(base: string): string {
  let at = base.indexOf("://");
  if (at < 0) { return ""; }
  return base.slice(0, at).toLowerCase();
}

export function serverAuthority(base: string): string {
  let at = base.indexOf("://");
  if (at < 0) { return ""; }
  let rest = base.slice(at + 3, base.length);
  let slash = rest.indexOf("/");
  if (slash >= 0) { rest = rest.slice(0, slash); }
  let mark = rest.indexOf("@");
  if (mark >= 0) { rest = rest.slice(mark + 1, rest.length); }
  return rest;
}

export function serverHost(base: string): string {
  let authority = serverAuthority(base);
  if (authority.startsWith("[")) {
    let close = authority.indexOf("]");
    if (close < 0) { return ""; }
    return authority.slice(1, close).toLowerCase();
  }
  let colon = authority.indexOf(":");
  if (colon >= 0) { authority = authority.slice(0, colon); }
  return authority.toLowerCase();
}

function octet(text: string): int {
  if (text.length == 0 || text.length > 3) { return -1; }
  let value = 0;
  let i = 0;
  while (i < text.length) {
    let c = text.charCodeAt(i);
    if (c < 48 || c > 57) { return -1; }
    value = value * 10 + (c - 48);
    i = i + 1;
  }
  if (value > 255) { return -1; }
  return value;
}

function ipv4Octets(host: string): int[] {
  let out: int[] = [];
  let parts = host.split(".");
  if (parts.length != 4) { return out; }
  for (const part of parts) {
    let value = octet(part);
    if (value < 0) {
      let none: int[] = [];
      return none;
    }
    out.push(value);
  }
  return out;
}

function privateIpv4(host: string): bool {
  let p = ipv4Octets(host);
  if (p.length != 4) { return false; }
  if (p[0] == 127) { return true; }
  if (p[0] == 10) { return true; }
  if (p[0] == 172 && p[1] >= 16 && p[1] <= 31) { return true; }
  if (p[0] == 192 && p[1] == 168) { return true; }
  if (p[0] == 169 && p[1] == 254) { return true; }
  if (p[0] == 100 && p[1] >= 64 && p[1] <= 127) { return true; }
  return false;
}

function privateIpv6(host: string): bool {
  if (host == "::1") { return true; }
  if (host.startsWith("fc") || host.startsWith("fd")) { return true; }
  if (host.startsWith("fe8") || host.startsWith("fe9")) { return true; }
  if (host.startsWith("fea") || host.startsWith("feb")) { return true; }
  return false;
}

export function isPrivateHost(host: string): bool {
  if (host == "") { return false; }
  if (host == "localhost" || host.endsWith(".localhost")) { return true; }
  if (host.endsWith(".local") || host.endsWith(".internal")) { return true; }
  if (host.indexOf(":") >= 0) { return privateIpv6(host); }
  return privateIpv4(host);
}

export function isDefaultServer(base: string): bool {
  return normalizeServer(base) == normalizeServer(DEFAULT_SERVER);
}

function insecureMessage(base: string, host: string): string {
  return "refusing to sign in to " + base + " over plain http.\n"
    + host + " is not a loopback or private network address, so the sign-in code and the credential\n"
    + "it is traded for would cross the network in the clear. Use https for a public server.\n"
    + "Plain http is allowed without asking for loopback, 10.x, 172.16-31.x, 192.168.x, 169.254.x,\n"
    + "100.64-127.x, IPv6 unique-local and link-local addresses, and .local or .internal names.\n"
    + "For a host you trust that is none of those, set " + INSECURE_ENV + "=1.";
}

export function checkServer(raw: string, allowInsecure: bool): ServerCheck {
  let base = normalizeServer(raw);
  let scheme = serverScheme(base);
  let host = serverHost(base);
  if (base == "" || host == "" || (scheme != "http" && scheme != "https")) {
    let bad: ServerCheck = {
      status: SERVER_BAD_URL, base: base,
      message: "\"" + raw + "\" is not a Joule server address. Set " + SERVER_ENV + " to a full URL, for example https://joule.sh",
    };
    return bad;
  }
  if (scheme == "http" && !isPrivateHost(host) && !allowInsecure) {
    let insecure: ServerCheck = { status: SERVER_INSECURE, base: base, message: insecureMessage(base, host) };
    return insecure;
  }
  let ok: ServerCheck = { status: SERVER_OK, base: base, message: "" };
  return ok;
}

export function resolveServer(flagServer: string, envServer: string, fileServer: string): string {
  if (flagServer.trim() != "") { return normalizeServer(flagServer); }
  if (envServer.trim() != "") { return normalizeServer(envServer); }
  if (fileServer.trim() != "") { return normalizeServer(fileServer); }
  return normalizeServer(DEFAULT_SERVER);
}

export function insecureAllowed(envValue: string): bool {
  let text = envValue.trim().toLowerCase();
  return text == "1" || text == "true" || text == "yes";
}
