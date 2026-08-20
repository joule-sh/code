import { frameSeq } from "../protocol/frames.ts";
import { constantTimeEqual } from "./pairing.ts";

export const RING_CAPACITY: int = 500;
export const SESSION_IDLE_TTL_MS: i64 = 30 * 60 * 1000;
export const CODE_TTL_MS: i64 = 10 * 60 * 1000;
export const PAIR_RATE_LIMIT_MAX: int = 5;
export const PAIR_RATE_LIMIT_WINDOW_MS: i64 = 10 * 60 * 1000;

export const PAIR_OK: string = "ok";
export const PAIR_NOT_FOUND: string = "not_found";
export const PAIR_EXPIRED: string = "expired";
export const PAIR_USED: string = "used";
export const PAIR_WRONG_CODE: string = "wrong_code";
export const PAIR_RATE_LIMITED: string = "rate_limited";

export type PairOutcome = { status: string, sessionId: string };
export type ReplayOutcome = { ok: bool, frames: string[] };

export class SessionRecord {
  sessionId: string;
  secret: string;
  workspace: string;
  model: string;
  code: string;
  codeExpiresAt: i64;
  codeUsed: bool;
  pairedUserId: string;
  createdAt: i64;
  lastActivityAt: i64;

  constructor(sessionId: string, secret: string, workspace: string, model: string, code: string, now: i64) {
    this.sessionId = sessionId;
    this.secret = secret;
    this.workspace = workspace;
    this.model = model;
    this.code = code;
    this.codeExpiresAt = now + CODE_TTL_MS;
    this.codeUsed = false;
    this.pairedUserId = "";
    this.createdAt = now;
    this.lastActivityAt = now;
  }
}

export class Ring {
  frames: string[];
  capacity: int;

  constructor(capacity: int) {
    this.frames = [];
    this.capacity = capacity;
  }

  push(frameJson: string): void {
    this.frames.push(frameJson);
    if (this.frames.length > this.capacity) {
      this.frames = this.frames.slice(1);
    }
  }

  oldestSeq(): int {
    if (this.frames.length == 0) { return -1; }
    return frameSeq(this.frames[0]);
  }

  replaySince(since: int): ReplayOutcome {
    if (this.frames.length == 0) {
      let empty: ReplayOutcome = { ok: true, frames: [] };
      return empty;
    }
    let oldest = this.oldestSeq();
    if (since >= 0 && since < oldest - 1) {
      let gap: ReplayOutcome = { ok: false, frames: [] };
      return gap;
    }
    let out: string[] = [];
    for (const f of this.frames) {
      if (frameSeq(f) > since) {
        out.push(f);
      }
    }
    let found: ReplayOutcome = { ok: true, frames: out };
    return found;
  }
}

export class RateLimiter {
  attempts: Map<string, i64[]>;
  maxAttempts: int;
  windowMs: i64;

  constructor(maxAttempts: int, windowMs: i64) {
    this.attempts = new Map<string, i64[]>();
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  allow(key: string, nowMs: i64): bool {
    let prior = this.attempts.get(key) ?? [];
    let recent: i64[] = [];
    for (const t of prior) {
      if (nowMs - t < this.windowMs) {
        recent.push(t);
      }
    }
    if (recent.length >= this.maxAttempts) {
      this.attempts.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.attempts.set(key, recent);
    return true;
  }
}

export class SessionStore {
  sessions: Map<string, SessionRecord>;
  rings: Map<string, Ring>;
  pairLimiter: RateLimiter;

  constructor() {
    this.sessions = new Map<string, SessionRecord>();
    this.rings = new Map<string, Ring>();
    this.pairLimiter = new RateLimiter(PAIR_RATE_LIMIT_MAX, PAIR_RATE_LIMIT_WINDOW_MS);
  }

  create(sessionId: string, secret: string, workspace: string, model: string, code: string, now: i64): SessionRecord {
    let created = new SessionRecord(sessionId, secret, workspace, model, code, now);
    this.sessions.set(sessionId, created);
    this.rings.set(sessionId, new Ring(RING_CAPACITY));
    return created;
  }

  find(sessionId: string): SessionRecord | null {
    return this.sessions.get(sessionId);
  }

  touch(sessionId: string, now: i64): void {
    let forTouch = this.sessions.get(sessionId);
    if (forTouch == null) { return; }
    forTouch.lastActivityAt = now;
  }

  pairByCode(candidateCode: string, userId: string, now: i64): PairOutcome {
    if (!this.pairLimiter.allow(userId, now)) {
      let limited: PairOutcome = { status: PAIR_RATE_LIMITED, sessionId: "" };
      return limited;
    }
    let ids = this.sessions.keys();
    let matched: SessionRecord | null = null;
    for (const id of ids) {
      let candidate = this.sessions.get(id);
      if (candidate == null) { continue; }
      if (constantTimeEqual(candidateCode, candidate.code)) {
        matched = candidate;
      }
    }
    if (matched == null) {
      let wrong: PairOutcome = { status: PAIR_WRONG_CODE, sessionId: "" };
      return wrong;
    }
    if (matched.codeUsed) {
      let used: PairOutcome = { status: PAIR_USED, sessionId: "" };
      return used;
    }
    if (now > matched.codeExpiresAt) {
      let expired: PairOutcome = { status: PAIR_EXPIRED, sessionId: "" };
      return expired;
    }
    matched.codeUsed = true;
    matched.pairedUserId = userId;
    matched.lastActivityAt = now;
    let ok: PairOutcome = { status: PAIR_OK, sessionId: matched.sessionId };
    return ok;
  }

  authorizeTerminal(sessionId: string, secret: string): bool {
    let forAuthTerminal = this.sessions.get(sessionId);
    if (forAuthTerminal == null) { return false; }
    return constantTimeEqual(secret, forAuthTerminal.secret);
  }

  authorizeBrowser(sessionId: string, userId: string): bool {
    let forAuthBrowser = this.sessions.get(sessionId);
    if (forAuthBrowser == null) { return false; }
    if (forAuthBrowser.pairedUserId == "") { return false; }
    return forAuthBrowser.pairedUserId == userId;
  }

  appendFrame(sessionId: string, frameJson: string, now: i64): void {
    let forAppend = this.rings.get(sessionId);
    if (forAppend == null) { return; }
    forAppend.push(frameJson);
    this.touch(sessionId, now);
  }

  replay(sessionId: string, since: int): ReplayOutcome {
    let forReplay = this.rings.get(sessionId);
    if (forReplay == null) {
      let missing: ReplayOutcome = { ok: false, frames: [] };
      return missing;
    }
    return forReplay.replaySince(since);
  }

  detachTerminal(sessionId: string): bool {
    let existed = this.sessions.get(sessionId) != null;
    this.sessions.delete(sessionId);
    this.rings.delete(sessionId);
    return existed;
  }

  sweepIdle(now: i64): int {
    let ids = this.sessions.keys();
    let stale: string[] = [];
    for (const id of ids) {
      let forSweep = this.sessions.get(id);
      if (forSweep != null && now - forSweep.lastActivityAt > SESSION_IDLE_TTL_MS) {
        stale.push(id);
      }
    }
    for (const id of stale) {
      this.sessions.delete(id);
      this.rings.delete(id);
    }
    return stale.length;
  }
}
