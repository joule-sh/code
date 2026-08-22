import { appendInbound, InboxDrain } from "./inbox.ts";
import { inboxDir } from "./paths.ts";

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
