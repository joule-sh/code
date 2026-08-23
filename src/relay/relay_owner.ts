import { SessionStore } from "./store.ts";
import { appendMailbox, MailboxReader } from "../tasks/mailbox.ts";
import { CMD_CREATE, CMD_PAIR, CMD_CONNECT, CMD_DETACH, ROLE_TERMINAL_CMD, ROLE_BROWSER_CMD, commandKind, CreateCommand, decodeCreateCommand, CreateResult, encodeCreateResult, PairCommand, decodePairCommand, PairResult, encodePairResult, ConnectCommand, decodeConnectCommand, ConnectResult, encodeConnectResult, DetachCommand, decodeDetachCommand, DetachResult, encodeDetachResult } from "./store_commands.ts";
import { commandsLogPath, resultsLogPath, sessionDir, sessionsDir, toBrowserLogPath, toTerminalLogPath } from "./relay_paths.ts";
import { generateCode, generateSecret, generateSessionId } from "./pairing.ts";

export const OWNER_TICK_MS: int = 25;
export const SWEEP_INTERVAL_MS: i64 = 5000;

function sessionDirNames(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function newestMtime(paths: string[]): i64 {
  let best: i64 = 0;
  for (const p of paths) {
    if (!fs.existsSync(p)) { continue; }
    let st = fs.statSync(p);
    let m: i64 = st.mtimeMs;
    if (m > best) { best = m; }
  }
  return best;
}

export class RelayOwner {
  runtimeDir: string;
  store: SessionStore;
  commandReader: MailboxReader;
  lastSweepAt: i64;

  constructor(runtimeDir: string) {
    this.runtimeDir = runtimeDir;
    this.store = new SessionStore();
    this.commandReader = new MailboxReader(commandsLogPath(runtimeDir));
    this.lastSweepAt = 0;
  }

  handleCreate(text: string): string {
    let createCmd = decodeCreateCommand(text);
    if (createCmd == null) { return ""; }
    let sessionId = generateSessionId();
    let secret = generateSecret();
    let code = generateCode();
    let created = this.store.create(sessionId, secret, createCmd.workspace, createCmd.model, code, createCmd.now);
    fs.mkdirSync(sessionDir(this.runtimeDir, sessionId), true);
    let result: CreateResult = { sessionId: created.sessionId, secret: created.secret, code: created.code, expiresAt: created.codeExpiresAt };
    return encodeCreateResult(result);
  }

  handlePair(text: string): string {
    let pairCmd = decodePairCommand(text);
    if (pairCmd == null) { return ""; }
    let outcome = this.store.pairByCode(pairCmd.code, pairCmd.userId, pairCmd.now);
    let result: PairResult = { status: outcome.status, sessionId: outcome.sessionId };
    return encodePairResult(result);
  }

  handleConnect(text: string): string {
    let connectCmd = decodeConnectCommand(text);
    if (connectCmd == null) { return ""; }
    let ok = false;
    let refusal = "";
    let rec = this.store.find(connectCmd.sessionId);
    if (rec == null) {
      refusal = "session_not_found";
    } else if (connectCmd.role == ROLE_TERMINAL_CMD) {
      ok = this.store.authorizeTerminal(connectCmd.sessionId, connectCmd.credential);
      if (!ok) { refusal = "unauthorized"; }
    } else if (connectCmd.role == ROLE_BROWSER_CMD) {
      if (rec.pairedUserId == "") {
        refusal = "not_paired";
      } else if (rec.pairedUserId != connectCmd.credential) {
        refusal = "wrong_user";
      } else {
        ok = true;
      }
    } else {
      refusal = "unknown_role";
    }
    if (ok) { this.store.touch(connectCmd.sessionId, connectCmd.now); }
    let result: ConnectResult = { ok: ok, refusal: refusal };
    return encodeConnectResult(result);
  }

  handleDetach(text: string): string {
    let detachCmd = decodeDetachCommand(text);
    if (detachCmd == null) { return ""; }
    let removed = this.store.detachTerminal(detachCmd.sessionId);
    if (fs.existsSync(sessionDir(this.runtimeDir, detachCmd.sessionId))) {
      fs.rmSync(sessionDir(this.runtimeDir, detachCmd.sessionId), true);
    }
    let result: DetachResult = { removed: removed };
    return encodeDetachResult(result);
  }

  handleCommand(text: string): string {
    let kind = commandKind(text);
    if (kind == CMD_CREATE) { return this.handleCreate(text); }
    if (kind == CMD_PAIR) { return this.handlePair(text); }
    if (kind == CMD_CONNECT) { return this.handleConnect(text); }
    if (kind == CMD_DETACH) { return this.handleDetach(text); }
    return "";
  }

  drainOnce(): int {
    let entries = this.commandReader.drainNew();
    for (const e of entries) {
      if (e.tag == "") { continue; }
      let result = this.handleCommand(e.payload);
      if (result != "") {
        appendMailbox(resultsLogPath(this.runtimeDir), e.tag, result);
      }
    }
    return entries.length;
  }

  sweepTick(now: i64): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) { return; }
    this.lastSweepAt = now;
    let ids = this.store.sessions.keys();
    for (const id of ids) {
      let activity = newestMtime([toBrowserLogPath(this.runtimeDir, id), toTerminalLogPath(this.runtimeDir, id)]);
      if (activity > 0) { this.store.touch(id, activity); }
    }
    let stale = this.store.sweepIdle(now);
    if (stale > 0) { this.reapMissingSessionDirs(); }
  }

  reapMissingSessionDirs(): void {
    let dir = sessionsDir(this.runtimeDir);
    let names = sessionDirNames(dir);
    for (const name of names) {
      if (this.store.find(name) == null) {
        fs.rmSync(dir + "/" + name, true);
      }
    }
  }

  loop(): int {
    let ticks = 0;
    while (true) {
      this.drainOnce();
      this.sweepTick(Date.now());
      process.sleep(OWNER_TICK_MS);
      ticks = ticks + 1;
    }
    return ticks;
  }
}
