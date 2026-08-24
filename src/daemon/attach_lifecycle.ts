import { PROTOCOL_VERSION, DAEMON_STOP, DAEMON_STOPPING, SESSION_HELLO, MODE_CHANGED, MODEL_CHANGED, frameType, decodeSessionHello, decodeModeChanged, decodeModelChanged, encodeDaemonStop } from "../protocol/frames.ts";
import { DaemonClient } from "./attach_client.ts";
import { readDaemonInfo, readDaemonInfoAt, portFromWorkspace, daemonSpawnArgs, daemonLogPath, daemonInfoDir, defaultDaemonBinPath } from "./lifecycle.ts";

export const POLL_MS: int = 100;
const CONNECT_WAIT_TICKS: int = 20;
const SPAWN_WAIT_TICKS: int = 50;
const HELLO_WAIT_TICKS: int = 30;
const DEFAULT_PORT_BASE: int = 8300;
const DEFAULT_PORT_SPREAD: int = 400;
const STOP_ACK_TICKS: int = 50;
const ATTACH_ATTEMPTS: int = 8;
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

export function nextPortInRange(port: int): int {
  let next = port + 1;
  if (next >= DEFAULT_PORT_BASE + DEFAULT_PORT_SPREAD) { return DEFAULT_PORT_BASE; }
  return next;
}

export function helloWorkspace(frames: string[]): string {
  for (const f of frames) {
    if (frameType(f) == SESSION_HELLO) {
      let hello = decodeSessionHello(f);
      if (hello != null) { return hello.workspace; }
    }
  }
  return "";
}

export function attachedMode(frames: string[], fallback: string): string {
  let mode = fallback;
  for (const f of frames) {
    let t = frameType(f);
    if (t == SESSION_HELLO) {
      let hello = decodeSessionHello(f);
      if (hello != null) {
        if (hello.mode != "") { mode = hello.mode; }
      }
    }
    if (t == MODE_CHANGED) {
      let changed = decodeModeChanged(f);
      if (changed != null) {
        if (changed.mode != "") { mode = changed.mode; }
      }
    }
  }
  return mode;
}

export function attachedModel(frames: string[], fallback: string): string {
  let model = fallback;
  for (const f of frames) {
    let t = frameType(f);
    if (t == SESSION_HELLO) {
      let hello = decodeSessionHello(f);
      if (hello != null) {
        if (hello.model != "") { model = hello.model; }
      }
    }
    if (t == MODEL_CHANGED) {
      let changed = decodeModelChanged(f);
      if (changed != null) {
        if (changed.model != "") { model = changed.model; }
      }
    }
  }
  return model;
}

export function describeWorkspace(seen: string): string {
  if (seen == "") { return "nothing that identified itself"; }
  return seen;
}

export function isTaken(taken: int[], port: int): bool {
  for (const p of taken) {
    if (p == port) { return true; }
  }
  return false;
}

export function portsHeldByOthers(workspaceRoot: string): int[] {
  let dir = daemonInfoDir();
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  let ports: int[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) { continue; }
    let info = readDaemonInfoAt(dir + "/" + name);
    if (info == null) { continue; }
    if (info.workspace == workspaceRoot) { continue; }
    ports.push(info.port);
  }
  return ports;
}

export function firstFreePort(start: int, taken: int[]): int {
  let port = start;
  let steps = 0;
  while (steps < DEFAULT_PORT_SPREAD && isTaken(taken, port)) {
    port = nextPortInRange(port);
    steps = steps + 1;
  }
  return port;
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

function waitForHello(client: DaemonClient, seed: string[], ticks: int): string[] {
  let collected: string[] = [];
  for (const f of seed) { collected.push(f); }
  let i = 0;
  while (i < ticks) {
    if (helloWorkspace(collected) != "") { return collected; }
    let frames = client.pollInbound();
    for (const f of frames) { collected.push(f); }
    process.sleep(POLL_MS);
    i = i + 1;
  }
  return collected;
}

export type AttachResult = { client: DaemonClient, spawned: bool, pending: string[], port: int, notes: string[] };

export function firstLine(text: string): string {
  let trimmed = text.trim();
  if (trimmed == "") { return ""; }
  return trimmed.split("\n")[0].trim();
}

export function spawnFailureText(daemonBinPath: string, status: int, stderr: string): string {
  let detail = firstLine(stderr);
  if (detail == "" && status < 0) { detail = "it was killed before it could run"; }
  if (detail == "") { detail = "it exited with status " + `${status}`; }
  return "joule: " + daemonBinPath + " will not run: " + detail;
}

export function daemonBinFailure(daemonBinPath: string): string {
  if (!fs.existsSync(daemonBinPath)) {
    return "joule: " + daemonBinPath + " will not run: there is no such file";
  }
  let probe = child_process.spawnSync(daemonBinPath, ["--version"]);
  if (probe.status == 0) { return ""; }
  return spawnFailureText(daemonBinPath, probe.status, probe.stderr);
}

export function ensureAttached(workspaceRoot: string, resumeFlag: bool): AttachResult {
  let notes: string[] = [];
  let info = readDaemonInfo(workspaceRoot);
  let taken = portsHeldByOthers(workspaceRoot);
  let port = DEFAULT_PORT_BASE;
  let recorded = false;
  if (info != null) {
    port = info.port;
    recorded = true;
  } else {
    port = firstFreePort(portFromWorkspace(workspaceRoot, DEFAULT_PORT_BASE, DEFAULT_PORT_SPREAD), taken);
  }

  let attempt = 0;
  while (attempt < ATTACH_ATTEMPTS) {
    let client = new DaemonClient("127.0.0.1", port, tmpDir());
    client.connect();
    let first = waitForReady(client, CONNECT_WAIT_TICKS);

    if (first.ready) {
      let settled = waitForHello(client, first.frames, HELLO_WAIT_TICKS);
      let seen = helloWorkspace(settled);
      if (seen == workspaceRoot || (recorded && seen == "")) {
        let already: AttachResult = { client: client, spawned: false, pending: settled, port: port, notes: notes };
        return already;
      }
      notes.push("joule: 127.0.0.1:" + `${port}` + " answers for " + describeWorkspace(seen) + ", not " + workspaceRoot + " - looking for a port of its own");
      client.disconnect();
      taken.push(port);
      port = firstFreePort(nextPortInRange(port), taken);
      recorded = false;
      attempt = attempt + 1;
      continue;
    }

    fs.mkdirSync(daemonInfoDir(), true);
    let daemonBinPath = defaultDaemonBinPath();
    let binFailure = daemonBinFailure(daemonBinPath);
    if (binFailure != "") {
      notes.push(binFailure);
      client.disconnect();
      let unusable: AttachResult = { client: client, spawned: false, pending: [], port: port, notes: notes };
      return unusable;
    }
    let args = daemonSpawnArgs(workspaceRoot, port, daemonLogPath(workspaceRoot), resumeFlag, daemonBinPath);
    let spawn = child_process.spawnSync("/bin/sh", args);
    if (spawn.status != 0) {
      notes.push(spawnFailureText(daemonBinPath, spawn.status, spawn.stderr));
      client.disconnect();
      let unstarted: AttachResult = { client: client, spawned: false, pending: [], port: port, notes: notes };
      return unstarted;
    }
    let second = waitForReady(client, SPAWN_WAIT_TICKS);
    let combined: string[] = [];
    for (const f of first.frames) { combined.push(f); }
    for (const f of second.frames) { combined.push(f); }
    let settled = waitForHello(client, combined, HELLO_WAIT_TICKS);
    let seen = helloWorkspace(settled);
    if (seen != "" && seen != workspaceRoot) {
      notes.push("joule: started a daemon for " + workspaceRoot + " on 127.0.0.1:" + `${port}` + " but 127.0.0.1:" + `${port}` + " answered for " + seen);
      notes.push("joule: two daemons are sharing that port - stop the stale one with joule --stop in " + seen);
      client.disconnect();
      let shared: AttachResult = { client: client, spawned: true, pending: settled, port: port, notes: notes };
      return shared;
    }
    let fresh: AttachResult = { client: client, spawned: true, pending: settled, port: port, notes: notes };
    return fresh;
  }

  notes.push("joule: every port this workspace tried is serving another workspace - stop the stale daemons with joule --stop in their workspaces");
  let exhausted = new DaemonClient("127.0.0.1", port, tmpDir());
  let none: AttachResult = { client: exhausted, spawned: false, pending: [], port: port, notes: notes };
  return none;
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

  let settled = waitForHello(client, ready.frames, HELLO_WAIT_TICKS);
  let seen = helloWorkspace(settled);
  if (seen != "" && seen != workspaceRoot) {
    console.log("joule --stop: 127.0.0.1:" + `${info.port}` + " is serving " + seen + ", not " + workspaceRoot + " - leaving it alone");
    client.detach();
    return;
  }

  client.publish(encodeDaemonStop({ v: PROTOCOL_VERSION, seq: 0, type: DAEMON_STOP }));

  let acked = false;
  for (const f of settled) {
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
