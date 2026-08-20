import { SessionStore, PAIR_OK, PAIR_NOT_FOUND, PAIR_RATE_LIMITED } from "./store.ts";
import { generateCode, generateSecret, generateSessionId } from "./pairing.ts";

type CreateSessionRequest = { workspace: string, model: string };
type CreateSessionResponse = { sessionId: string, secret: string, code: string, expiresAt: i64 };
type PairRequest = { code: string };
type PairResponse = { sessionId: string };
type ErrorResponse = { error: string };

function jsonResponse(status: int, bodyJson: string): HttpResponse {
  let h = new Map<string, string>();
  h.set("content-type", "application/json");
  let resp: HttpResponse = { status: status, body: bodyJson, ok: status < 400, headers: h };
  return resp;
}

function errorResponse(status: int, message: string): HttpResponse {
  let e: ErrorResponse = { error: message };
  return jsonResponse(status, JSON.stringify(e));
}

function parseCreateSession(body: string): CreateSessionRequest | null {
  try {
    return JSON.parse<CreateSessionRequest>(body);
  } catch {
    return null;
  }
}

function parsePair(body: string): PairRequest | null {
  try {
    return JSON.parse<PairRequest>(body);
  } catch {
    return null;
  }
}

function handleCreateSession(store: SessionStore, req: HttpRequest, now: i64): HttpResponse {
  let createReq = parseCreateSession(req.body);
  if (createReq == null) {
    return errorResponse(400, "malformed request body");
  }
  if (createReq.workspace == "" || createReq.model == "") {
    return errorResponse(400, "workspace and model are required");
  }
  let sessionId = generateSessionId();
  let secret = generateSecret();
  let code = generateCode();
  let created = store.create(sessionId, secret, createReq.workspace, createReq.model, code, now);
  let resp: CreateSessionResponse = {
    sessionId: created.sessionId, secret: created.secret, code: created.code, expiresAt: created.codeExpiresAt,
  };
  return jsonResponse(200, JSON.stringify(resp));
}

function statusForPairFailure(status: string): int {
  if (status == PAIR_NOT_FOUND) { return 404; }
  if (status == PAIR_RATE_LIMITED) { return 429; }
  return 400;
}

function handlePair(store: SessionStore, req: HttpRequest, now: i64): HttpResponse {
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
  let outcome = store.pairByCode(pairReq.code, userId, now);
  if (outcome.status != PAIR_OK) {
    return errorResponse(statusForPairFailure(outcome.status), outcome.status);
  }
  let resp: PairResponse = { sessionId: outcome.sessionId };
  return jsonResponse(200, JSON.stringify(resp));
}

export function makeHttpHandler(store: SessionStore): (req: HttpRequest) => HttpResponse {
  return (req: HttpRequest) => {
    let now: i64 = Date.now();
    store.sweepIdle(now);
    if (req.method == "POST" && req.path == "/sessions") {
      return handleCreateSession(store, req, now);
    }
    if (req.method == "POST" && req.path == "/pair") {
      return handlePair(store, req, now);
    }
    return errorResponse(404, "not found");
  };
}
