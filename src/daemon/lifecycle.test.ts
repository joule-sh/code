import { writeDaemonInfoAt, readDaemonInfoAt, removeDaemonInfoAt, parseDaemonInfo, portFromWorkspace, daemonSpawnCommand, daemonBinNameFor } from "./lifecycle.ts";

function freshInfoPath(name: string): string {
  return "/tmp/daemon-lifecycle-test-" + name + "/info.json";
}

test("readDaemonInfoAt is null when nothing was ever written", () => {
  expect(readDaemonInfoAt(freshInfoPath("never-written")) == null);
});

test("writeDaemonInfoAt then readDaemonInfoAt round-trips workspace and port", () => {
  let p = freshInfoPath("roundtrip");
  writeDaemonInfoAt(p, "/some/workspace", 8342);
  let info = readDaemonInfoAt(p);
  expect(info != null);
  if (info != null) {
    expect(info.workspace == "/some/workspace");
    expect(info.port == 8342);
  }
});

test("removeDaemonInfoAt clears a previously written info file", () => {
  let p = freshInfoPath("remove");
  writeDaemonInfoAt(p, "/some/workspace", 8342);
  removeDaemonInfoAt(p);
  expect(readDaemonInfoAt(p) == null);
});

test("parseDaemonInfo returns null for malformed or empty text", () => {
  expect(parseDaemonInfo("") == null);
  expect(parseDaemonInfo("not json") == null);
});

test("portFromWorkspace is deterministic and stays in range", () => {
  let a = portFromWorkspace("/tmp/workspace-a", 9000, 500);
  let b = portFromWorkspace("/tmp/workspace-a", 9000, 500);
  expect(a == b);
  expect(a >= 9000);
  expect(a < 9500);
});

test("two different workspaces usually land on different default ports", () => {
  let a = portFromWorkspace("/tmp/workspace-a", 9000, 500);
  let b = portFromWorkspace("/tmp/workspace-completely-different", 9000, 500);
  expect(a != b);
});

test("daemonSpawnCommand backgrounds the daemon and does not block the caller", () => {
  let cmd = daemonSpawnCommand("/tmp/some-workspace", 9100, "/tmp/some.log", false, "/opt/joule-code/bin/joule-daemon");
  expect(cmd.indexOf("nohup") >= 0);
  expect(cmd.indexOf("disown") >= 0);
  expect(cmd.indexOf("JOULE_DAEMON_PORT=9100") >= 0);
  expect(cmd.indexOf("JOULE_DAEMON_RESUME") < 0);
  expect(cmd.indexOf("/opt/joule-code/bin/joule-daemon") >= 0);
});

test("daemonSpawnCommand carries a resume flag through as an env var when asked", () => {
  let cmd = daemonSpawnCommand("/tmp/some-workspace", 9100, "/tmp/some.log", true, "/opt/joule-code/bin/joule-daemon");
  expect(cmd.indexOf("JOULE_DAEMON_RESUME=1") >= 0);
});

test("daemonBinNameFor sits next to the running joule executable when its path is known", () => {
  expect(daemonBinNameFor("/opt/joule-code/bin/joule") == "/opt/joule-code/bin/joule-daemon");
});

test("daemonBinNameFor falls back to a workspace-relative path when the running executable's path is unknown", () => {
  expect(daemonBinNameFor("") == "bin/joule-daemon");
});
