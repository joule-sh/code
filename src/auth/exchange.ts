import { jsonStringMemberAt, jsonIntMemberAt, jsonMemberStart } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { Credential, emptyCredential } from "./credentials.ts";
import { normalizeServer } from "./server.ts";

export const CODE_ALPHABET: string = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH: int = 6;

export const LOGIN_PATH: string = "/terminal/login";
export const EXCHANGE_PATH: string = "/terminal/exchange";

export const EX_OK: string = "ok";
export const EX_BAD_CODE: string = "bad-code";
export const EX_UNKNOWN: string = "unknown";
export const EX_EXPIRED: string = "expired";
export const EX_USED: string = "used";
export const EX_THROTTLED: string = "throttled";
export const EX_REFUSED: string = "refused";
export const EX_UNREACHABLE: string = "unreachable";
export const EX_NOT_JOULE: string = "not-joule";
export const EX_NO_ACCOUNTS: string = "no-accounts";
export const EX_SERVER_ERROR: string = "server-error";
export const EX_REVOKED: string = "revoked";

export type ExchangeResult = { outcome: string, message: string, retryAfter: int, credential: Credential };

export function loginUrl(base: string): string {
  return normalizeServer(base) + LOGIN_PATH;
}

export function exchangeUrl(base: string): string {
  return normalizeServer(base) + EXCHANGE_PATH;
}

export function normalizeCode(said: string): string {
  let text = said.trim().toUpperCase();
  let cleaned = "";
  let i = 0;
  while (i < text.length) {
    let ch = text.charAt(i);
    if (ch != " " && ch != "-" && ch != "\t") { cleaned = cleaned + ch; }
    i = i + 1;
  }
  if (cleaned.length != CODE_LENGTH) { return ""; }
  let j = 0;
  while (j < cleaned.length) {
    if (CODE_ALPHABET.indexOf(cleaned.charAt(j)) < 0) { return ""; }
    j = j + 1;
  }
  return cleaned;
}

function settled(outcome: string, message: string, retryAfter: int, credential: Credential): ExchangeResult {
  let r: ExchangeResult = { outcome: outcome, message: message, retryAfter: retryAfter, credential: credential };
  return r;
}

function failure(outcome: string, message: string): ExchangeResult {
  return settled(outcome, message, 0, emptyCredential());
}

function serverErrorText(body: string): string {
  return jsonStringMemberAt(body, 0, "error");
}

function looksLikeJoule(body: string): bool {
  if (jsonMemberStart(body, 0, "error") >= 0) { return true; }
  return jsonMemberStart(body, 0, "credential") >= 0;
}

function notJoule(base: string): ExchangeResult {
  return failure(EX_NOT_JOULE, base + " answered, but not the way a Joule server does.\n"
    + "Check " + base + " is a Joule console and not something else on that address.");
}

function credentialFrom(base: string, body: string, now: i64): Credential {
  let credAt = jsonMemberStart(body, 0, "credential");
  let acctAt = jsonMemberStart(body, 0, "account");
  let relayAt = jsonMemberStart(body, 0, "relay");
  let c: Credential = {
    server: normalizeServer(base),
    secret: jsonStringMemberAt(body, credAt, "secret"),
    accountId: acctAt < 0 ? "" : jsonStringMemberAt(body, acctAt, "id"),
    accountEmail: acctAt < 0 ? "" : jsonStringMemberAt(body, acctAt, "email"),
    keyId: jsonStringMemberAt(body, credAt, "id"),
    keyPrefix: jsonStringMemberAt(body, credAt, "keyPrefix"),
    scopes: jsonStringMemberAt(body, credAt, "scopes"),
    savedAt: `${now}`,
    relayUrl: relayAt < 0 ? "" : jsonStringMemberAt(body, relayAt, "url"),
    relayWsUrl: relayAt < 0 ? "" : jsonStringMemberAt(body, relayAt, "ws"),
    webUrl: relayAt < 0 ? "" : jsonStringMemberAt(body, relayAt, "web"),
  };
  return c;
}

function refusedText(base: string, body: string): string {
  let said = serverErrorText(body);
  let tail = said == "" ? "" : "\n" + base + " said: " + said;
  return "the sign-in code was accepted but " + base + " could not issue a credential." + tail
    + "\nNothing was spent, so the same code can be tried again once that is fixed.";
}

export function parseExchange(base: string, status: int, body: string, now: i64): ExchangeResult {
  if (status < 0) {
    return failure(EX_UNREACHABLE, "could not reach " + base + ".\n"
      + "Check the address, that the server is up, and that this machine can get to it.");
  }
  if (status == 200) {
    let credAt = jsonMemberStart(body, 0, "credential");
    if (credAt < 0) { return notJoule(base); }
    let c = credentialFrom(base, body, now);
    if (c.secret == "") { return notJoule(base); }
    return settled(EX_OK, "", 0, c);
  }
  if (!looksLikeJoule(body)) { return notJoule(base); }
  if (status == 429) {
    let wait = jsonIntMemberAt(body, 0, "retryAfter");
    if (wait <= 0) { wait = 60; }
    return settled(EX_THROTTLED, "too many sign-in attempts. Wait " + `${wait}` + " seconds and run /login again.", wait, emptyCredential());
  }
  if (status == 400) {
    let reason = jsonStringMemberAt(body, 0, "reason");
    if (reason == "expired") {
      return failure(EX_EXPIRED, "that code has expired. Codes last a few minutes, so run /login again for a fresh one.");
    }
    if (reason == "used") {
      return failure(EX_USED, "that code has already been used. Each code signs in one terminal once, so run /login again for a new one.");
    }
    if (reason == "unknown") {
      return failure(EX_UNKNOWN, "that code is not one " + base + " is holding. Check for a typo and try again, or run /login for a new code.");
    }
    return failure(EX_UNKNOWN, base + " did not accept that code: " + serverErrorText(body));
  }
  if (status == 404) {
    return failure(EX_NO_ACCOUNTS, base + " keeps no accounts to sign a terminal in to.\n"
      + "Point " + "JOULE_CODE_SERVER" + " at a Joule server with sign-in enabled.");
  }
  if (status == 401 || status == 403) {
    return failure(EX_REVOKED, base + " will not accept this credential any more.\n"
      + "It was most likely revoked. Run /login to sign in again.");
  }
  if (status == 409 || status == 502) {
    return failure(EX_REFUSED, refusedText(base, body));
  }
  return failure(EX_SERVER_ERROR, base + " could not answer the sign-in (" + `${status}` + "). " + serverErrorText(body));
}

export function requestJson(code: string): string {
  return "{\"code\":" + JSON.stringify(code) + "}";
}

export function exchangeCode(base: string, said: string, now: i64): ExchangeResult {
  let code = normalizeCode(said);
  if (code == "") {
    return failure(EX_BAD_CODE, "a sign-in code is " + `${CODE_LENGTH}` + " characters from " + CODE_ALPHABET + ".\n"
      + "It never contains I, L, O, 0 or 1. Check what the page showed and try again.");
  }
  let headers = new Map<string, string>();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  let resp = http.request(exchangeUrl(base), "POST", requestJson(code), headers);
  if (!resp.ok && resp.status < 0) {
    return parseExchange(base, -1, "", now);
  }
  return parseExchange(base, resp.status, resp.body, now);
}
