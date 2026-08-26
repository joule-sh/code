import { jsonStringMemberAt, jsonMemberStart } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { normalizeServer, DEFAULT_SERVER } from "../auth/server.ts";

export const VERIFY_PATH: string = "/terminal/verify";
export const CONSOLE_URL_ENV: string = "JOULE_RELAY_CONSOLE_URL";

export const VERIFY_OK: string = "ok";
export const VERIFY_UNREACHABLE: string = "unreachable";
export const VERIFY_REJECTED: string = "rejected";

export type AccountVerifyResult = { status: string, accountId: string, accountEmail: string, relayUser: string };

export function consoleUrlFromEnv(envValue: string): string {
  let raw = envValue.trim();
  if (raw == "") { return DEFAULT_SERVER; }
  return normalizeServer(raw);
}

export function verifyUrl(consoleBase: string): string {
  return normalizeServer(consoleBase) + VERIFY_PATH;
}

function unreachable(): AccountVerifyResult {
  let r: AccountVerifyResult = { status: VERIFY_UNREACHABLE, accountId: "", accountEmail: "", relayUser: "" };
  return r;
}

function rejected(): AccountVerifyResult {
  let r: AccountVerifyResult = { status: VERIFY_REJECTED, accountId: "", accountEmail: "", relayUser: "" };
  return r;
}

export function parseAccountVerify(status: int, body: string): AccountVerifyResult {
  if (status < 0) { return unreachable(); }
  if (status != 200) { return rejected(); }
  let acctAt = jsonMemberStart(body, 0, "account");
  if (acctAt < 0) { return rejected(); }
  let accountId = jsonStringMemberAt(body, acctAt, "id");
  if (accountId == "") { return rejected(); }
  let accountEmail = jsonStringMemberAt(body, acctAt, "email");
  let relayUser = jsonStringMemberAt(body, acctAt, "relayUser");
  let r: AccountVerifyResult = { status: VERIFY_OK, accountId: accountId, accountEmail: accountEmail, relayUser: relayUser };
  return r;
}

export function requestJson(secret: string): string {
  return "{\"secret\":" + JSON.stringify(secret) + "}";
}

export function verifyAccountCredential(consoleBase: string, secret: string): AccountVerifyResult {
  if (secret == "") { return rejected(); }
  let headers = new Map<string, string>();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  let resp = http.request(verifyUrl(consoleBase), "POST", requestJson(secret), headers);
  if (!resp.ok && resp.status < 0) { return parseAccountVerify(-1, ""); }
  return parseAccountVerify(resp.status, resp.body);
}
