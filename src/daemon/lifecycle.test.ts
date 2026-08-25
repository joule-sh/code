import { writeDaemonInfoAt, readDaemonInfoAt, removeDaemonInfoAt, parseDaemonInfo, portFromWorkspace, posixDaemonSpawnCommand, windowsDaemonSpawnCommand, windowsDaemonStartCommand, daemonErrorLogPath, daemonBinNameFor } from "./lifecycle.ts";

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

test("the POSIX spawn command backgrounds the daemon and does not block the caller", () => {
  let cmd = posixDaemonSpawnCommand("/tmp/some-workspace", 9100, "/tmp/some.log", false, "/opt/joule-code/bin/joule-daemon");
  expect(cmd.indexOf("nohup") >= 0);
  expect(cmd.slice(cmd.length - 1, cmd.length) == "&");
  expect(cmd.indexOf("JOULE_DAEMON_PORT=9100") >= 0);
  expect(cmd.indexOf("JOULE_DAEMON_RESUME") < 0);
  expect(cmd.indexOf("/opt/joule-code/bin/joule-daemon") >= 0);
});

test("the POSIX spawn command asks for nothing a POSIX shell does not have, so its exit status means something", () => {
  let cmd = posixDaemonSpawnCommand("/tmp/some-workspace", 9100, "/tmp/some.log", false, "/opt/joule-code/bin/joule-daemon");
  expect(cmd.indexOf("disown") < 0);
  let ran = child_process.spawnSync("/bin/sh", ["-c", "true &"]);
  expect(ran.status == 0);
});

test("the POSIX spawn command carries a resume flag through as an env var when asked", () => {
  let cmd = posixDaemonSpawnCommand("/tmp/some-workspace", 9100, "/tmp/some.log", true, "/opt/joule-code/bin/joule-daemon");
  expect(cmd.indexOf("JOULE_DAEMON_RESUME=1") >= 0);
});

test("the Windows spawn command hands the daemon to the system rather than to the shell that asked", () => {
  let cmd = windowsDaemonSpawnCommand("C:\\ws", 9100, "C:\\logs\\d.log", false, "C:\\Program Files\\joule\\joule-daemon.exe");
  expect(cmd.indexOf("Start-Process") >= 0);
  expect(cmd.indexOf("-WindowStyle Hidden") >= 0);
  expect(cmd.indexOf("nohup") < 0);
  expect(cmd.indexOf("&") < 0);
});

test("the outer Start-Process names no redirect, which is what keeps it from handing the daemon a copy of the client's pipes", () => {
  let cmd = windowsDaemonSpawnCommand("C:\\ws", 9100, "C:\\logs\\d.log", false, "C:\\bin\\joule-daemon.exe");
  let outer = cmd.slice(0, cmd.indexOf("-ArgumentList"));
  expect(outer.indexOf("-Redirect") < 0);
  expect(outer.indexOf("-FilePath 'powershell.exe'") >= 0);
});

test("the inner command is the one that starts the daemon, redirects and all", () => {
  let inner = windowsDaemonStartCommand("C:\\a workspace", "C:\\logs\\d.log", "C:\\Program Files\\joule\\joule-daemon.exe");
  expect(inner.indexOf("-WorkingDirectory 'C:\\a workspace'") >= 0);
  expect(inner.indexOf("-FilePath 'C:\\Program Files\\joule\\joule-daemon.exe'") >= 0);
  expect(inner.indexOf("-RedirectStandardOutput 'C:\\logs\\d.log'") >= 0);
});

test("the Windows spawn command names the port and carries the inner command as one quoted argument", () => {
  let cmd = windowsDaemonSpawnCommand("C:\\a workspace", 9100, "C:\\logs\\d.log", false, "C:\\bin\\joule-daemon.exe");
  expect(cmd.indexOf("$env:JOULE_DAEMON_PORT = '9100'") >= 0);
  expect(cmd.indexOf("'-NoProfile','-NonInteractive','-Command','Start-Process") >= 0);
  expect(cmd.indexOf("-WorkingDirectory ''C:\\a workspace''") >= 0);
});

test("a single quote in a Windows path survives both levels of quoting", () => {
  let inner = windowsDaemonStartCommand("C:\\o'brien", "C:\\logs\\d.log", "C:\\bin\\joule-daemon.exe");
  expect(inner.indexOf("-WorkingDirectory 'C:\\o''brien'") >= 0);
  let cmd = windowsDaemonSpawnCommand("C:\\o'brien", 9100, "C:\\logs\\d.log", false, "C:\\bin\\joule-daemon.exe");
  expect(cmd.indexOf("-WorkingDirectory ''C:\\o''''brien''") >= 0);
});

test("the Windows spawn command turns a failure into a non-zero exit status, which is all spawnSync reports", () => {
  let cmd = windowsDaemonSpawnCommand("C:\\ws", 9100, "C:\\logs\\d.log", false, "C:\\bin\\joule-daemon.exe");
  expect(cmd.indexOf("$ErrorActionPreference = 'Stop'") == 0);
});

test("the Windows spawn command clears the resume flag when it was not asked for, and sets it when it was", () => {
  let off = windowsDaemonSpawnCommand("C:\\ws", 9100, "C:\\logs\\d.log", false, "C:\\bin\\joule-daemon.exe");
  expect(off.indexOf("$env:JOULE_DAEMON_RESUME = ''") >= 0);
  let on = windowsDaemonSpawnCommand("C:\\ws", 9100, "C:\\logs\\d.log", true, "C:\\bin\\joule-daemon.exe");
  expect(on.indexOf("$env:JOULE_DAEMON_RESUME = '1'") >= 0);
});

test("the two Windows redirects are different files, because Start-Process refuses one path for both", () => {
  let cmd = windowsDaemonSpawnCommand("C:\\ws", 9100, "C:\\logs\\d.log", false, "C:\\bin\\joule-daemon.exe");
  expect(daemonErrorLogPath("C:\\logs\\d.log") != "C:\\logs\\d.log");
  expect(cmd.indexOf("-RedirectStandardOutput ''C:\\logs\\d.log''") >= 0);
  expect(cmd.indexOf("-RedirectStandardError ''C:\\logs\\d.log.err''") >= 0);
});

test("daemonBinNameFor sits next to the running joule executable when its path is known", () => {
  expect(daemonBinNameFor("/opt/joule-code/bin/joule") == "/opt/joule-code/bin/joule-daemon");
});

test("daemonBinNameFor falls back to a workspace-relative path when the running executable's path is unknown", () => {
  expect(daemonBinNameFor("") == "bin/joule-daemon");
});
