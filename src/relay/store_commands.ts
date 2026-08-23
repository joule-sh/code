import { SessionSummary } from "./store.ts";

export const CMD_CREATE: string = "create";
export const CMD_PAIR: string = "pair";
export const CMD_CONNECT: string = "connect";
export const CMD_DETACH: string = "detach";
export const CMD_LIST_MINE: string = "list_mine";

export const ROLE_TERMINAL_CMD: string = "terminal";
export const ROLE_BROWSER_CMD: string = "browser";

export type CreateCommand = { kind: string, workspace: string, model: string, now: i64, accountId: string, accountEmail: string };
export type CreateResult = { sessionId: string, secret: string, code: string, expiresAt: i64 };

export type PairCommand = { kind: string, code: string, userId: string, now: i64 };
export type PairResult = { status: string, sessionId: string };

export type ConnectCommand = { kind: string, sessionId: string, role: string, credential: string, now: i64 };
export type ConnectResult = { ok: bool, refusal: string };

export type ListMineCommand = { kind: string, accountId: string };
export type ListMineResult = { sessions: SessionSummary[] };

export function rawFieldValue(body: string, key: string): string {
  let mark = "\"" + key + "\"";
  let at = body.indexOf(mark);
  if (at < 0) { return ""; }
  let colon = body.indexOf(":", at + mark.length);
  if (colon < 0) { return ""; }
  let i = colon + 1;
  while (i < body.length && (body.charAt(i) == " " || body.charAt(i) == "\n" || body.charAt(i) == "\t")) {
    i = i + 1;
  }
  if (i >= body.length) { return ""; }
  if (body.charAt(i) == "\"") {
    let out = "";
    let j = i + 1;
    while (j < body.length) {
      let c = body.charAt(j);
      if (c == "\\") { out = out + body.charAt(j + 1); j = j + 2; continue; }
      if (c == "\"") { return out; }
      out = out + c;
      j = j + 1;
    }
    return "";
  }
  let end = i;
  while (end < body.length) {
    let c = body.charAt(end);
    if (c == "," || c == "}" || c == "\n" || c == " ") { break; }
    end = end + 1;
  }
  return body.slice(i, end);
}

export function commandKind(text: string): string {
  return rawFieldValue(text, "kind");
}

export function encodeCreateCommand(c: CreateCommand): string { return JSON.stringify(c); }
export function decodeCreateCommand(text: string): CreateCommand | null {
  try { return JSON.parse<CreateCommand>(text); } catch { return null; }
}
export function encodeCreateResult(r: CreateResult): string { return JSON.stringify(r); }
export function decodeCreateResult(text: string): CreateResult | null {
  try { return JSON.parse<CreateResult>(text); } catch { return null; }
}

export function encodePairCommand(c: PairCommand): string { return JSON.stringify(c); }
export function decodePairCommand(text: string): PairCommand | null {
  try { return JSON.parse<PairCommand>(text); } catch { return null; }
}
export function encodePairResult(r: PairResult): string { return JSON.stringify(r); }
export function decodePairResult(text: string): PairResult | null {
  try { return JSON.parse<PairResult>(text); } catch { return null; }
}

export function encodeConnectCommand(c: ConnectCommand): string { return JSON.stringify(c); }
export function decodeConnectCommand(text: string): ConnectCommand | null {
  try { return JSON.parse<ConnectCommand>(text); } catch { return null; }
}
export function encodeConnectResult(r: ConnectResult): string { return JSON.stringify(r); }
export function decodeConnectResult(text: string): ConnectResult | null {
  try { return JSON.parse<ConnectResult>(text); } catch { return null; }
}

export type DetachCommand = { kind: string, sessionId: string };
export type DetachResult = { removed: bool };

export function encodeDetachCommand(c: DetachCommand): string { return JSON.stringify(c); }
export function decodeDetachCommand(text: string): DetachCommand | null {
  try { return JSON.parse<DetachCommand>(text); } catch { return null; }
}
export function encodeDetachResult(r: DetachResult): string { return JSON.stringify(r); }
export function decodeDetachResult(text: string): DetachResult | null {
  try { return JSON.parse<DetachResult>(text); } catch { return null; }
}

export function encodeListMineCommand(c: ListMineCommand): string { return JSON.stringify(c); }
export function decodeListMineCommand(text: string): ListMineCommand | null {
  try { return JSON.parse<ListMineCommand>(text); } catch { return null; }
}
export function encodeListMineResult(r: ListMineResult): string { return JSON.stringify(r); }
export function decodeListMineResult(text: string): ListMineResult | null {
  try { return JSON.parse<ListMineResult>(text); } catch { return null; }
}
