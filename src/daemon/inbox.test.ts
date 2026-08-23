import { appendInbound, appendClosed, sweepInbox, InboxDrain } from "./inbox.ts";
import { inboxDir, inboxPath } from "./paths.ts";

function freshRuntimeDir(name: string): string {
  let dir = "/tmp/daemon-inbox-test-" + name;
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(inboxDir(dir), true);
  return dir;
}

test("drainAll sees nothing when no connection has ever written", () => {
  let dir = freshRuntimeDir("empty");
  let drain = new InboxDrain(dir);
  expect(drain.drainAll().length == 0);
});

test("drainAll returns frames appended by a single connection", () => {
  let dir = freshRuntimeDir("single");
  appendInbound(dir, "conn-a", "{\"type\":\"input\",\"text\":\"hi\"}");
  let drain = new InboxDrain(dir);
  let frames = drain.drainAll();
  expect(frames.length == 1);
  expect(frames[0] == "{\"type\":\"input\",\"text\":\"hi\"}");
});

test("drainAll merges frames from several distinct connections", () => {
  let dir = freshRuntimeDir("multi");
  appendInbound(dir, "conn-a", "{\"seq\":1}");
  appendInbound(dir, "conn-b", "{\"seq\":2}");
  let drain = new InboxDrain(dir);
  let frames = drain.drainAll();
  expect(frames.length == 2);
});

test("drainAll does not return the same frame twice across repeated calls", () => {
  let dir = freshRuntimeDir("incremental");
  appendInbound(dir, "conn-a", "{\"seq\":1}");
  let drain = new InboxDrain(dir);
  expect(drain.drainAll().length == 1);
  expect(drain.drainAll().length == 0);
  appendInbound(dir, "conn-a", "{\"seq\":2}");
  expect(drain.drainAll().length == 1);
});

test("appendInbound refuses an unsafe connId rather than writing outside the inbox dir", () => {
  let dir = freshRuntimeDir("unsafe");
  appendInbound(dir, "../../etc/passwd", "{\"seq\":1}");
  let drain = new InboxDrain(dir);
  expect(drain.drainAll().length == 0);
});

function inboxFileCount(dir: string): int {
  try {
    return fs.readdirSync(inboxDir(dir)).length;
  } catch {
    return 0;
  }
}

test("a frame written just before the close is still delivered", () => {
  let dir = freshRuntimeDir("close-then-drain");
  appendInbound(dir, "conn-a", "{\"seq\":1}");
  appendClosed(dir, "conn-a");
  let drain = new InboxDrain(dir);
  let frames = drain.drainAll();
  expect(frames.length == 1);
  expect(frames[0] == "{\"seq\":1}");
});

test("a closed connection's file is reaped once its frames have been drained", () => {
  let dir = freshRuntimeDir("reap");
  appendInbound(dir, "conn-a", "{\"seq\":1}");
  appendClosed(dir, "conn-a");
  let drain = new InboxDrain(dir);
  expect(drain.drainAll().length == 1);
  expect(inboxFileCount(dir) == 1);
  expect(drain.drainAll().length == 0);
  expect(inboxFileCount(dir) == 0);
  expect(drain.readers.keys().length == 0);
});

test("a connection that comes back before the reap keeps its file and its frames", () => {
  let dir = freshRuntimeDir("reattach");
  appendInbound(dir, "conn-a", "{\"seq\":1}");
  appendClosed(dir, "conn-a");
  let drain = new InboxDrain(dir);
  expect(drain.drainAll().length == 1);
  appendInbound(dir, "conn-a", "{\"seq\":2}");
  let second = drain.drainAll();
  expect(second.length == 1);
  expect(second[0] == "{\"seq\":2}");
  expect(inboxFileCount(dir) == 1);
});

test("connection churn leaves neither a file nor a reader behind", () => {
  let dir = freshRuntimeDir("churn");
  let drain = new InboxDrain(dir);
  let delivered = 0;
  let i = 0;
  while (i < 20) {
    let connId = "conn-" + `${i}`;
    appendInbound(dir, connId, "{\"seq\":1}");
    appendClosed(dir, connId);
    delivered = delivered + drain.drainAll().length;
    i = i + 1;
  }
  drain.drainAll();
  expect(delivered == 20);
  expect(inboxFileCount(dir) == 0);
  expect(drain.readers.keys().length == 0);
});

test("appendClosed does not create an inbox file for a connection that never wrote one", () => {
  let dir = freshRuntimeDir("listener");
  appendClosed(dir, "conn-a");
  expect(inboxFileCount(dir) == 0);
});

test("a reader is dropped when its file disappears from under the drain", () => {
  let dir = freshRuntimeDir("vanish");
  appendInbound(dir, "conn-a", "{\"seq\":1}");
  let drain = new InboxDrain(dir);
  expect(drain.drainAll().length == 1);
  expect(drain.readers.keys().length == 1);
  fs.unlinkSync(inboxPath(dir, "conn-a"));
  expect(drain.drainAll().length == 0);
  expect(drain.readers.keys().length == 0);
});

test("sweepInbox removes the files an earlier daemon left behind", () => {
  let dir = freshRuntimeDir("sweep");
  appendInbound(dir, "conn-a", "{\"seq\":1}");
  appendInbound(dir, "conn-b", "{\"seq\":2}");
  expect(inboxFileCount(dir) == 2);
  expect(sweepInbox(dir) == 2);
  expect(inboxFileCount(dir) == 0);
});
