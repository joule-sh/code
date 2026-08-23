import { PROTOCOL_VERSION, DAEMON_STOP, DAEMON_STOPPING, frameType, encodeDaemonStop } from "../protocol/frames.ts";
import { DaemonClient } from "./attach_client.ts";
import { readDaemonInfo, portFromWorkspace, daemonSpawnArgs, daemonLogPath, daemonInfoDir, defaultDaemonBinPath } from "./lifecycle.ts";

export const POLL_MS: int = 100;
const CONNECT_WAIT_TICKS: int = 20;
const SPAWN_WAIT_TICKS: int = 50;
const DEFAULT_PORT_BASE: int = 8300;
const DEFAULT_PORT_SPREAD: int = 400;
const STOP_ACK_TICKS: int = 50;
export const STOP_FLAG: string = "--stop";

export function tmpDir(): string {
  return process.env("TMPDIR") ?? "/tmp";
}

export function hasStopFlag(argv: string[]): bool {
  for (const a of argv) {
    if (a == STOP_FLAG) { return true; }
  }
  return false;
}

export type ReadyOutcome = { ready: bool, frames: string[] };

function waitForReady(client: DaemonClient, ticks: int): ReadyOutcome {
  let collected: string[] = [];
  let i = 0;
  while (i < ticks) {
    let frames = client.pollInbound();
    for (const f of frames) { collected.push(f); }
    if (client.socketReady) {
      let ready: ReadyOutcome = { ready: true, frames: collected };
      return ready;
    }
    process.sleep(POLL_MS);
    i = i + 1;
  }
  let out: ReadyOutcome = { ready: client.socketReady, frames: collected };
  return out;
}

export type AttachResult = { client: DaemonClient, spawned: bool, pending: string[] };

export function ensureAttached(workspaceRoot: string, resumeFlag: bool): AttachResult {
  let info = readDaemonInfo(workspaceRoot);
  let port = DEFAULT_PORT_BASE;
  if (info != null) {
    port = info.port;
  } else {
    port = portFromWorkspace(workspaceRoot, DEFAULT_PORT_BASE, DEFAULT_PORT_SPREAD);
  }

  let client = new DaemonClient("127.0.0.1", port, tmpDir());
  client.connect();
  let first = waitForReady(client, CONNECT_WAIT_TICKS);
  if (first.ready) {
    let already: AttachResult = { client: client, spawned: false, pending: first.frames };
    return already;
  }

  fs.mkdirSync(daemonInfoDir(), true);
  let args = daemonSpawnArgs(workspaceRoot, port, daemonLogPath(workspaceRoot), resumeFlag, defaultDaemonBinPath());
  child_process.spawnSync("/bin/sh", args);
  let second = waitForReady(client, SPAWN_WAIT_TICKS);
  let combined: string[] = [];
  for (const f of first.frames) { combined.push(f); }
  for (const f of second.frames) { combined.push(f); }
  let fresh: AttachResult = { client: client, spawned: true, pending: combined };
  return fresh;
}

export function runAttachStop(workspaceRoot: string): void {
  let info = readDaemonInfo(workspaceRoot);
  if (info == null) {
    console.log("joule: no daemon is running for " + workspaceRoot);
    return;
  }

  let client = new DaemonClient("127.0.0.1", info.port, tmpDir());
  client.connect();
  let ready = waitForReady(client, CONNECT_WAIT_TICKS);
  if (!ready.ready) {
    console.log("joule: could not reach the daemon at 127.0.0.1:" + `${info.port}` + " for " + workspaceRoot + " - it may have already crashed or stopped");
    return;
  }

  client.publish(encodeDaemonStop({ v: PROTOCOL_VERSION, seq: 0, type: DAEMON_STOP }));

  let acked = false;
  for (const f of ready.frames) {
    if (frameType(f) == DAEMON_STOPPING) { acked = true; }
  }
  let i = 0;
  while (i < STOP_ACK_TICKS && !acked) {
    let frames = client.pollInbound();
    for (const f of frames) {
      if (frameType(f) == DAEMON_STOPPING) { acked = true; }
    }
    if (!acked) { process.sleep(POLL_MS); }
    i = i + 1;
  }
  client.detach();

  if (acked) {
    console.log("joule --stop: the daemon for " + workspaceRoot + " acknowledged the request and is shutting down");
    console.log("joule --stop: note - any already-running background task or subagent it started keeps running as its own detached process; stopping the daemon does not stop those (see docs/03-daemon.md)");
  } else {
    console.log("joule --stop: sent the stop request but saw no acknowledgement within " + `${STOP_ACK_TICKS * POLL_MS}` + "ms - it may still be finishing an in-flight turn before it stops");
  }
}
