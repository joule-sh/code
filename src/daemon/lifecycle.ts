// Pure-ish helpers for "does a daemon already own this workspace, and if
// not, how do we start one" -- kept separate from daemon.ts so the discovery
// logic is unit-testable without a real socket.
//
// Lumen's own child_process has no detach/kill (spec 450, lumen#6) so a
// direct child of this process cannot outlive it. spawnDaemonDetached routes
// through `/bin/sh -c 'nohup ... & disown'` instead: the shell we spawnSync
// exits immediately once it has backgrounded the real daemon, so waiting for
// it to finish does not mean waiting for the daemon.

import { sessionKeyFor } from "../session/persistence.ts";

export type DaemonInfo = { workspace: string, port: int, startedAt: string };

export function daemonInfoDir(): string {
  let home = process.env("HOME") ?? "";
  return home + "/.config/joule-code/daemon";
}

export function daemonInfoPath(workspaceRoot: string): string {
  return daemonInfoDir() + "/" + sessionKeyFor(workspaceRoot) + ".json";
}

export function parseDaemonInfo(text: string): DaemonInfo | null {
  if (text.trim() == "") { return null; }
  try {
    return JSON.parse<DaemonInfo>(text);
  } catch {
    return null;
  }
}

export function readDaemonInfo(workspaceRoot: string): DaemonInfo | null {
  let p = daemonInfoPath(workspaceRoot);
  if (!fs.existsSync(p)) { return null; }
  return parseDaemonInfo(fs.readFileSync(p));
}

export function writeDaemonInfo(workspaceRoot: string, port: int): void {
  let dir = daemonInfoDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, true);
  }
  let info: DaemonInfo = { workspace: workspaceRoot, port: port, startedAt: `${Date.now()}` };
  fs.writeFileSync(daemonInfoPath(workspaceRoot), JSON.stringify(info));
}

export function removeDaemonInfo(workspaceRoot: string): void {
  let p = daemonInfoPath(workspaceRoot);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

// A real liveness check has to attempt the connection (there is no portable
// "is this port bound" query without one) -- callers on the daemon-client
// side do this over the websocket itself; this module only decides where to
// look, not whether the far end answers.
export function daemonBinaryArgs(workspaceRoot: string, port: int): string[] {
  let cmd = "cd " + workspaceRoot + " && JOULE_DAEMON_PORT=" + `${port}` + " nohup bin/joule-daemon >/tmp/joule-daemon-" + `${port}` + ".log 2>&1 & disown";
  return ["-c", cmd];
}
