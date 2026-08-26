import { PAIR_OK, PAIR_NOT_FOUND, PAIR_RATE_LIMITED } from "./store.ts";
import { renderWebPage, renderFramesAsset, WEB_PAGE_PATH, FRAMES_ASSET_PATH } from "./web/web_page.ts";
import { StoreCaller } from "./relay_rpc.ts";
import { CMD_CREATE, CMD_PAIR, CreateCommand, encodeCreateCommand, decodeCreateResult, PairCommand, encodePairCommand, decodePairResult, rawFieldValue, CMD_LIST_MINE, ListMineCommand, encodeListMineCommand, decodeListMineResult } from "./store_commands.ts";
import { AccountVerifyResult, VERIFY_OK } from "./account_verify.ts";

export type RelayHttpRequest = { method: string, path: string, body: string, headers: Map<string, string> };
export type RelayHttpResponse = { status: int, body: string, ok: bool, headers: Map<string, string> };

export type AccountVerifier = (secret: string) => AccountVerifyResult;

type CreateSessionRequest = { workspace: string, model: string };
type CreateSessionResponse = { sessionId: string, secret: string, code: string, expiresAt: i64, accountStatus: string, verifiedBy: string };
type PairRequest = { code: string };
type PairResponse = { sessionId: string };
type ErrorResponse = { error: string };

function jsonResponse(status: int, bodyJson: string): RelayHttpResponse {
  let h = new Map<string, string>();
  h.set("content-type", "application/json");
  let resp: RelayHttpResponse = { status: status, body: bodyJson, ok: status < 400, headers: h };
  return resp;
}

function htmlResponse(status: int, body: string): RelayHttpResponse {
  let h = new Map<string, string>();
  h.set("content-type", "text/html; charset=utf-8");
  let resp: RelayHttpResponse = { status: status, body: body, ok: status < 400, headers: h };
  return resp;
}

function errorResponse(status: int, message: string): RelayHttpResponse {
  let e: ErrorResponse = { error: message };
  return jsonResponse(status, JSON.stringify(e));
}

function parseCreateSession(body: string): CreateSessionRequest | null {
  if (!body.trim().startsWith("{")) { return null; }
  let req: CreateSessionRequest = { workspace: rawFieldValue(body, "workspace"), model: rawFieldValue(body, "model") };
  return req;
}

function parsePair(body: string): PairRequest | null {
  try {
    return JSON.parse<PairRequest>(body);
  } catch {
    return null;
  }
}

function resolveAccount(verifyAccount: AccountVerifier, body: string): AccountVerifyResult {
  let secret = rawFieldValue(body, "credentialSecret");
  if (secret == "") {
    let none: AccountVerifyResult = { status: "", accountId: "", accountEmail: "", relayUser: "" };
    return none;
  }
  return verifyAccount(secret);
}

function handleCreateSession(caller: StoreCaller, verifyAccount: AccountVerifier, consoleBase: string, req: RelayHttpRequest, now: i64): RelayHttpResponse {
  let createReq = parseCreateSession(req.body);
  if (createReq == null) {
    return errorResponse(400, "malformed request body");
  }
  if (createReq.workspace == "" || createReq.model == "") {
    return errorResponse(400, "workspace and model are required");
  }
  let account = resolveAccount(verifyAccount, req.body);
  let accountId = account.status == VERIFY_OK ? account.accountId : "";
  let accountEmail = account.status == VERIFY_OK ? account.accountEmail : "";
  let ownerUser = accountId == "" ? "" : account.relayUser;
  let cmd: CreateCommand = { kind: CMD_CREATE, workspace: createReq.workspace, model: createReq.model, now: now, accountId: accountId, accountEmail: accountEmail, ownerUser: ownerUser };
  let resultJson = caller(encodeCreateCommand(cmd));
  let created = decodeCreateResult(resultJson);
  if (created == null) {
    return errorResponse(503, "relay owner did not answer in time");
  }
  let resp: CreateSessionResponse = {
    sessionId: created.sessionId, secret: created.secret, code: created.code, expiresAt: created.expiresAt,
    accountStatus: account.status, verifiedBy: account.status == "" ? "" : consoleBase,
  };
  return jsonResponse(200, JSON.stringify(resp));
}

function statusForPairFailure(status: string): int {
  if (status == PAIR_NOT_FOUND) { return 404; }
  if (status == PAIR_RATE_LIMITED) { return 429; }
  return 400;
}

function handlePair(caller: StoreCaller, req: RelayHttpRequest, now: i64): RelayHttpResponse {
  let userId = req.headers.get("x-user") ?? "";
  if (userId == "") {
    return errorResponse(401, "missing x-user");
  }
  let pairReq = parsePair(req.body);
  if (pairReq == null) {
    return errorResponse(400, "malformed request body");
  }
  if (pairReq.code == "") {
    return errorResponse(400, "malformed request body");
  }
  let cmd: PairCommand = { kind: CMD_PAIR, code: pairReq.code, userId: userId, now: now };
  let resultJson = caller(encodePairCommand(cmd));
  let outcome = decodePairResult(resultJson);
  if (outcome == null) {
    return errorResponse(503, "relay owner did not answer in time");
  }
  if (outcome.status != PAIR_OK) {
    return errorResponse(statusForPairFailure(outcome.status), outcome.status);
  }
  let resp: PairResponse = { sessionId: outcome.sessionId };
  return jsonResponse(200, JSON.stringify(resp));
}

function handleListMine(caller: StoreCaller, req: RelayHttpRequest): RelayHttpResponse {
  let accountId = req.headers.get("x-user") ?? "";
  if (accountId == "") {
    return errorResponse(401, "missing x-user");
  }
  let cmd: ListMineCommand = { kind: CMD_LIST_MINE, accountId: accountId };
  let resultJson = caller(encodeListMineCommand(cmd));
  let result = decodeListMineResult(resultJson);
  if (result == null) {
    return errorResponse(503, "relay owner did not answer in time");
  }
  return jsonResponse(200, JSON.stringify(result));
}

function scriptResponse(status: int, body: string): RelayHttpResponse {
  let h = new Map<string, string>();
  h.set("content-type", "application/javascript; charset=utf-8");
  let resp: RelayHttpResponse = { status: status, body: body, ok: status < 400, headers: h };
  return resp;
}

function handleFramesAsset(): RelayHttpResponse {
  return scriptResponse(200, renderFramesAsset());
}

function handleWebPage(wsBrowserPort: int): RelayHttpResponse {
  return htmlResponse(200, renderWebPage(wsBrowserPort));
}

export function makeHttpHandler(caller: StoreCaller, wsBrowserPort: int, verifyAccount: AccountVerifier, consoleBase: string): (req: RelayHttpRequest) => RelayHttpResponse {
  return (req: RelayHttpRequest) => {
    let now: i64 = Date.now();
    if (req.method == "GET" && req.path == WEB_PAGE_PATH) {
      return handleWebPage(wsBrowserPort);
    }
    if (req.method == "GET" && req.path == FRAMES_ASSET_PATH) {
      return handleFramesAsset();
    }
    if (req.method == "POST" && req.path == "/sessions") {
      return handleCreateSession(caller, verifyAccount, consoleBase, req, now);
    }
    if (req.method == "POST" && req.path == "/pair") {
      return handlePair(caller, req, now);
    }
    if (req.method == "GET" && req.path == "/sessions/mine") {
      return handleListMine(caller, req);
    }
    return errorResponse(404, "not found");
  };
}
