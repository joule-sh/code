import { connIdFromPath, isSafeConnId, attachPath, inboxPath, broadcastLogPath, daemonRuntimeDir } from "./paths.ts";

test("attachPath and connIdFromPath round-trip a client-chosen id", () => {
  let id = "a1b2c3d4";
  expect(connIdFromPath(attachPath(id)) == id);
});

test("connIdFromPath refuses a path with the wrong shape", () => {
  let emptyId = "/attach/" + "/ws";
  expect(connIdFromPath("/sessions/foo/ws") == "");
  expect(connIdFromPath(emptyId) == "");
  expect(connIdFromPath("/attach/abc") == "");
  expect(connIdFromPath("attach/abc/ws") == "");
});

test("isSafeConnId accepts only alphanumerics and dashes", () => {
  expect(isSafeConnId("abc-123"));
  expect(!isSafeConnId(""));
  expect(!isSafeConnId("../../etc/passwd"));
  expect(!isSafeConnId("has spaces"));
  expect(!isSafeConnId("has/slash"));
});

test("a path-traversal connId is rejected before it can shape a filesystem path", () => {
  let evil = connIdFromPath("/attach/../../../etc/passwd/ws");
  expect(!isSafeConnId(evil));
});

test("inboxPath and broadcastLogPath live under the runtime dir passed to them", () => {
  let dir = "/tmp/some-runtime-dir";
  expect(inboxPath(dir, "abc").startsWith(dir));
  expect(broadcastLogPath(dir).startsWith(dir));
});

test("two different workspaces never share a runtime dir", () => {
  expect(daemonRuntimeDir("/tmp/one", "") != daemonRuntimeDir("/tmp/two", ""));
});

test("two named sessions on the same workspace never share a runtime dir either", () => {
  expect(daemonRuntimeDir("/tmp/one", "a") != daemonRuntimeDir("/tmp/one", "b"));
  expect(daemonRuntimeDir("/tmp/one", "a") != daemonRuntimeDir("/tmp/one", ""));
});
