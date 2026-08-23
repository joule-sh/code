import { RelayOwner } from "./relay_owner.ts";
import { appendMailbox, findMailboxEntry } from "../tasks/mailbox.ts";
import { commandsLogPath, resultsLogPath, sessionDir, toBrowserLogPath } from "./relay_paths.ts";
import { CMD_CREATE, CMD_PAIR, CMD_CONNECT, CMD_DETACH, ROLE_TERMINAL_CMD, ROLE_BROWSER_CMD, CreateCommand, encodeCreateCommand, decodeCreateResult, PairCommand, encodePairCommand, decodePairResult, ConnectCommand, encodeConnectCommand, decodeConnectResult, DetachCommand, encodeDetachCommand, decodeDetachResult, ListMineCommand, encodeListMineCommand, decodeListMineResult } from "./store_commands.ts";

const BASE_TIME: i64 = 1700000000000;

function freshRuntimeDir(name: string): string {
  let dir = "/tmp/relay-owner-test-" + name;
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(dir, true);
  return dir;
}

function unowned(workspace: string, now: i64): CreateCommand {
  let c: CreateCommand = { kind: CMD_CREATE, workspace: workspace, model: "gpt", now: now, accountId: "", accountEmail: "" };
  return c;
}

test("handleCreate makes a session and a pairing code, and creates its runtime dir", () => {
  let owner = new RelayOwner(freshRuntimeDir("create"));
  let result = decodeCreateResult(owner.handleCreate(encodeCreateCommand(unowned("/repo", BASE_TIME))));
  expect(result != null);
  if (result != null) {
    expect(result.sessionId != "");
    expect(result.secret != "");
    expect(result.code.length == 6);
    expect(fs.existsSync(sessionDir(owner.runtimeDir, result.sessionId)));
  }
});

test("handlePair binds a code to a uuid, handleConnect then authorizes that uuid as the browser", () => {
  let owner = new RelayOwner(freshRuntimeDir("pair-connect"));
  let created = decodeCreateResult(owner.handleCreate(encodeCreateCommand(unowned("/repo", BASE_TIME))));
  expect(created != null);
  if (created != null) {
    let pairCmd: PairCommand = { kind: CMD_PAIR, code: created.code, userId: "user-1", now: BASE_TIME + 10 };
    let paired = decodePairResult(owner.handlePair(encodePairCommand(pairCmd)));
    expect(paired != null);
    if (paired != null) {
      expect(paired.status == "ok");
      expect(paired.sessionId == created.sessionId);
    }

    let connectCmd: ConnectCommand = { kind: CMD_CONNECT, sessionId: created.sessionId, role: ROLE_BROWSER_CMD, credential: "user-1", now: BASE_TIME + 20 };
    let connected = decodeConnectResult(owner.handleConnect(encodeConnectCommand(connectCmd)));
    expect(connected != null);
    if (connected != null) { expect(connected.ok); }

    let wrongUser: ConnectCommand = { kind: CMD_CONNECT, sessionId: created.sessionId, role: ROLE_BROWSER_CMD, credential: "user-2", now: BASE_TIME + 30 };
    let refused = decodeConnectResult(owner.handleConnect(encodeConnectCommand(wrongUser)));
    expect(refused != null);
    if (refused != null) {
      expect(!refused.ok);
      expect(refused.refusal == "wrong_user");
    }
  }
});

test("handleConnect authorizes the terminal role by secret", () => {
  let owner = new RelayOwner(freshRuntimeDir("terminal-connect"));
  let created = decodeCreateResult(owner.handleCreate(encodeCreateCommand(unowned("/repo", BASE_TIME))));
  expect(created != null);
  if (created != null) {
    let ok: ConnectCommand = { kind: CMD_CONNECT, sessionId: created.sessionId, role: ROLE_TERMINAL_CMD, credential: created.secret, now: BASE_TIME + 5 };
    let okResult = decodeConnectResult(owner.handleConnect(encodeConnectCommand(ok)));
    expect(okResult != null);
    if (okResult != null) { expect(okResult.ok); }

    let bad: ConnectCommand = { kind: CMD_CONNECT, sessionId: created.sessionId, role: ROLE_TERMINAL_CMD, credential: "wrong-secret", now: BASE_TIME + 6 };
    let refused = decodeConnectResult(owner.handleConnect(encodeConnectCommand(bad)));
    expect(refused != null);
    if (refused != null) {
      expect(!refused.ok);
      expect(refused.refusal == "unauthorized");
    }
  }
});

test("handleDetach removes the session and its runtime directory", () => {
  let owner = new RelayOwner(freshRuntimeDir("detach"));
  let created = decodeCreateResult(owner.handleCreate(encodeCreateCommand(unowned("/repo", BASE_TIME))));
  expect(created != null);
  if (created != null) {
    expect(fs.existsSync(sessionDir(owner.runtimeDir, created.sessionId)));

    let detachCmd: DetachCommand = { kind: CMD_DETACH, sessionId: created.sessionId };
    let result = decodeDetachResult(owner.handleDetach(encodeDetachCommand(detachCmd)));
    expect(result != null);
    if (result != null) { expect(result.removed); }
    expect(!fs.existsSync(sessionDir(owner.runtimeDir, created.sessionId)));

    let again = decodeDetachResult(owner.handleDetach(encodeDetachCommand(detachCmd)));
    expect(again != null);
    if (again != null) { expect(!again.removed); }
  }
});

test("drainOnce answers a command it finds in the mailbox, tagged by the caller's reqId", () => {
  let dir = freshRuntimeDir("drain");
  let owner = new RelayOwner(dir);
  appendMailbox(commandsLogPath(dir), "req-1", encodeCreateCommand(unowned("/repo", BASE_TIME)));

  let handled = owner.drainOnce();
  expect(handled == 1);

  let resultJson = findMailboxEntry(resultsLogPath(dir), "req-1");
  let result = decodeCreateResult(resultJson);
  expect(result != null);
  if (result != null) { expect(result.sessionId != ""); }
});

test("sweepTick removes a session once it has been idle past the TTL", () => {
  let owner = new RelayOwner(freshRuntimeDir("sweep"));
  let created = decodeCreateResult(owner.handleCreate(encodeCreateCommand(unowned("/repo", BASE_TIME))));
  expect(created != null);
  if (created != null) {
    owner.sweepTick(BASE_TIME + 31 * 60 * 1000);
    expect(owner.store.find(created.sessionId) == null);
  }
});

test("handleCreate stores the accountId and accountEmail the caller already resolved", () => {
  let owner = new RelayOwner(freshRuntimeDir("create-owned"));
  let cmd: CreateCommand = { kind: CMD_CREATE, workspace: "/repo", model: "gpt", now: BASE_TIME, accountId: "acct-1", accountEmail: "a@example.com" };
  let created = decodeCreateResult(owner.handleCreate(encodeCreateCommand(cmd)));
  expect(created != null);
  if (created != null) {
    let rec = owner.store.find(created.sessionId);
    expect(rec != null);
    if (rec != null) {
      expect(rec.accountId == "acct-1");
      expect(rec.accountEmail == "a@example.com");
    }
  }
});

test("handleListMine returns only the caller's own sessions, and an unowned session appears for no one", () => {
  let owner = new RelayOwner(freshRuntimeDir("list-mine"));
  let mine: CreateCommand = { kind: CMD_CREATE, workspace: "/mine", model: "gpt", now: BASE_TIME, accountId: "acct-1", accountEmail: "a@example.com" };
  let other: CreateCommand = { kind: CMD_CREATE, workspace: "/other", model: "gpt", now: BASE_TIME, accountId: "acct-2", accountEmail: "b@example.com" };
  owner.handleCreate(encodeCreateCommand(mine));
  owner.handleCreate(encodeCreateCommand(other));
  owner.handleCreate(encodeCreateCommand(unowned("/nobody", BASE_TIME)));

  let listCmd: ListMineCommand = { kind: "list_mine", accountId: "acct-1" };
  let result = decodeListMineResult(owner.handleListMine(encodeListMineCommand(listCmd)));
  expect(result != null);
  if (result != null) {
    expect(result.sessions.length == 1);
    expect(result.sessions[0].workspace == "/mine");
  }
});

test("sweepTick keeps a session whose transcript log is still growing, however long it has been running", () => {
  let owner = new RelayOwner(freshRuntimeDir("sweep-active"));
  let created = decodeCreateResult(owner.handleCreate(encodeCreateCommand(unowned("/repo", BASE_TIME))));
  expect(created != null);
  if (created != null) {
    let log = toBrowserLogPath(owner.runtimeDir, created.sessionId);
    appendMailbox(log, "F", "{\"seq\":1}");
    owner.sweepTick(BASE_TIME + 10 * 1000);
    expect(owner.store.find(created.sessionId) != null);

    appendMailbox(log, "F", "{\"seq\":2}");
    owner.sweepTick(BASE_TIME + 40 * 60 * 1000);
    expect(owner.store.find(created.sessionId) != null);
    expect(fs.existsSync(sessionDir(owner.runtimeDir, created.sessionId)));
  }
});

test("a session that wrote frames and then went quiet is still swept once it is genuinely idle", () => {
  let owner = new RelayOwner(freshRuntimeDir("sweep-quiet"));
  let created = decodeCreateResult(owner.handleCreate(encodeCreateCommand(unowned("/repo", BASE_TIME))));
  expect(created != null);
  if (created != null) {
    let log = toBrowserLogPath(owner.runtimeDir, created.sessionId);
    appendMailbox(log, "F", "{\"seq\":1}");
    owner.sweepTick(BASE_TIME + 10 * 1000);
    expect(owner.store.find(created.sessionId) != null);

    owner.sweepTick(BASE_TIME + 10 * 1000 + 31 * 60 * 1000);
    expect(owner.store.find(created.sessionId) == null);
  }
});

test("a swept session is forgotten by the activity tracker rather than tracked forever", () => {
  let owner = new RelayOwner(freshRuntimeDir("sweep-forget"));
  let created = decodeCreateResult(owner.handleCreate(encodeCreateCommand(unowned("/repo", BASE_TIME))));
  expect(created != null);
  if (created != null) {
    appendMailbox(toBrowserLogPath(owner.runtimeDir, created.sessionId), "F", "{\"seq\":1}");
    owner.sweepTick(BASE_TIME + 10 * 1000);
    expect(owner.seenLogBytes.get(created.sessionId) != null);

    owner.sweepTick(BASE_TIME + 10 * 1000 + 31 * 60 * 1000);
    expect(owner.store.find(created.sessionId) == null);
    expect(owner.seenLogBytes.get(created.sessionId) == null);
  }
});
