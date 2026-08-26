import { PROTOCOL_VERSION, DAEMON_STOP, DAEMON_STOPPING, SESSION_HELLO, MODE_CHANGED, MODEL_CHANGED, frameType, decodeSessionHello, decodeModeChanged, decodeModelChanged, encodeDaemonStop, helloFrameWorkspace, helloFrameBuild } from "../protocol/frames.ts";
import { VERSION } from "../version.ts";
import { DaemonClient } from "./attach_client.ts";
import { readDaemonInfo, readDaemonInfoAt, removeDaemonInfo, daemonPortOrZero, portFromWorkspace, daemonSpawnArgs, daemonLogPath, daemonInfoDir, defaultDaemonBinPath } from "./lifecycle.ts";
import { shellProgram, tempDir, worthConnectingTo } from "../vendor/platform/platform.ts";

export const DAEMON_HOST: string = "127.0.0.1";
export const POLL_MS: int = 100;
const CONNECT_WAIT_TICKS: int = 20;
const PROBE_WAIT_TICKS: int = 5;
const SPAWN_WAIT_TICKS: int = 50;
const HELLO_WAIT_TICKS: int = 30;
const DEFAULT_PORT_BASE: int = 8300;
const DEFAULT_PORT_SPREAD: int = 400;
const STOP_ACK_TICKS: int = 50;
const STOP_GONE_TICKS: int = 100;
const ATTACH_ATTEMPTS: int = 8;
export const STOP_FLAG: string = "--stop";

export function tmpDir(): string {
  return tempDir();
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
    if (frameType(f) == SESSION_HELLO) { return helloFrameWorkspace(f); }
  }
  return "";
}

export function helloBuild(frames: string[]): string {
  for (const f of frames) {
    if (frameType(f) == SESSION_HELLO) { return helloFrameBuild(f); }
  }
  return "";
}

export function startedButSilentNote(workspaceRoot: string, port: int): string {
  return "joule: started a daemon for " + workspaceRoot + " on 127.0.0.1:" + `${port}` + " but it did not answer in " + `${(SPAWN_WAIT_TICKS + HELLO_WAIT_TICKS) * POLL_MS / 1000}` + "s - it is still running, stop it with joule --stop";
}

export function describeBuild(build: string): string {
  if (build == "") { return "a build too old to say which one"; }
  return "joule " + build;
}

export function buildMismatchNotes(port: int, build: string): string[] {
  let out: string[] = [];
  out.push("joule: this client is joule " + VERSION + ", the daemon on 127.0.0.1:" + `${port}` + " is " + describeBuild(build));
  out.push("joule: a client will not attach to a daemon of another build - the two agree on the frames and not on what they mean, and the session goes quiet");
  out.push("joule: stop that daemon with joule --stop, then start joule again");
  return out;
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

export function connectTicks(recorded: bool): int {
  if (recorded) { return CONNECT_WAIT_TICKS; }
  return PROBE_WAIT_TICKS;
}

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
    client.retryNow();
    process.sleep(POLL_MS);
    i = i + 1;
  }
  let out: ReadyOutcome = { ready: client.socketReady, frames: collected };
  return out;
}

export function waitForDaemonGone(workspaceRoot: string, ticks: int): bool {
  let i = 0;
  while (i < ticks) {
    if (daemonPortOrZero(workspaceRoot) == 0) { return true; }
    process.sleep(POLL_MS);
    i = i + 1;
  }
  return daemonPortOrZero(workspaceRoot) == 0;
}

export function stoppedNote(workspaceRoot: string): string {
  return "joule --stop: the daemon for " + workspaceRoot + " has stopped";
}

export function stillRunningNote(workspaceRoot: string): string {
  return "joule --stop: the daemon for " + workspaceRoot + " acknowledged the request but was still running " + `${STOP_GONE_TICKS * POLL_MS / 1000}` + "s later - it may be finishing an in-flight turn, and a joule started now would attach to it on its way out";
}

export function waitForPortOpen(port: int, ticks: int): bool {
  let i = 0;
  while (i < ticks) {
    if (worthConnectingTo(DAEMON_HOST, port)) { return true; }
    process.sleep(POLL_MS);
    i = i + 1;
  }
  return worthConnectingTo(DAEMON_HOST, port);
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
    let client = new DaemonClient(DAEMON_HOST, port, tmpDir());
    let first: ReadyOutcome = { ready: false, frames: [] };
    if (worthConnectingTo(DAEMON_HOST, port)) {
      client.connect();
      first = waitForReady(client, connectTicks(recorded));
    }

    if (first.ready) {
      let settled = waitForHello(client, first.frames, HELLO_WAIT_TICKS);
      let seen = helloWorkspace(settled);
      if (seen == workspaceRoot || (recorded && seen == "")) {
        let build = helloBuild(settled);
        if (build != VERSION) {
          for (const n of buildMismatchNotes(port, build)) { notes.push(n); }
          client.disconnect();
          let stale: AttachResult = { client: client, spawned: false, pending: [], port: port, notes: notes };
          return stale;
        }
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
    let spawn = child_process.spawnSync(shellProgram(), args);
    if (spawn.status != 0) {
      notes.push(spawnFailureText(daemonBinPath, spawn.status, spawn.stderr));
      client.disconnect();
      let unstarted: AttachResult = { client: client, spawned: false, pending: [], port: port, notes: notes };
      return unstarted;
    }
    waitForPortOpen(port, SPAWN_WAIT_TICKS);
    if (!client.isAttached()) { client.connect(); }
    client.retryNow();
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
    let started = helloBuild(settled);
    if (seen != "" && started != VERSION) {
      for (const n of buildMismatchNotes(port, started)) { notes.push(n); }
      notes.push("joule: that daemon came from " + daemonBinPath + " - this install has a client and a daemon of different builds beside each other");
      client.disconnect();
      let halfUpdated: AttachResult = { client: client, spawned: true, pending: [], port: port, notes: notes };
      return halfUpdated;
    }
    if (!client.socketReady) { notes.push(startedButSilentNote(workspaceRoot, port)); }
    let fresh: AttachResult = { client: client, spawned: true, pending: settled, port: port, notes: notes };
    return fresh;
  }

  notes.push("joule: every port this workspace tried is serving another workspace - stop the stale daemons with joule --stop in their workspaces");
  let exhausted = new DaemonClient(DAEMON_HOST, port, tmpDir());
  let none: AttachResult = { client: exhausted, spawned: false, pending: [], port: port, notes: notes };
  return none;
}

export function runAttachStop(workspaceRoot: string): void {
  let info = readDaemonInfo(workspaceRoot);
  if (info == null) {
    console.log("joule: no daemon is running for " + workspaceRoot);
    return;
  }

  let unreachable = "joule: could not reach the daemon at 127.0.0.1:" + `${info.port}` + " for " + workspaceRoot + " - it may have already crashed or stopped";
  if (!worthConnectingTo(DAEMON_HOST, info.port)) {
    console.log(unreachable);
    return;
  }

  let client = new DaemonClient(DAEMON_HOST, info.port, tmpDir());
  client.connect();
  let ready = waitForReady(client, CONNECT_WAIT_TICKS);
  if (!ready.ready) {
    console.log(unreachable);
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
    if (waitForDaemonGone(workspaceRoot, STOP_GONE_TICKS)) {
      console.log(stoppedNote(workspaceRoot));
    } else {
      console.log(stillRunningNote(workspaceRoot));
    }
    console.log("joule --stop: note - any already-running background task or subagent it started keeps running as its own detached process; stopping the daemon does not stop those (see docs/03-daemon.md)");
  } else {
    console.log("joule --stop: sent the stop request but saw no acknowledgement within " + `${STOP_ACK_TICKS * POLL_MS}` + "ms - it may still be finishing an in-flight turn before it stops");
  }
}

export const REAP_NONE: string = "no daemon was running for this workspace, so nothing is left on the old build";
export const REAP_GONE: string = "this workspace's daemon had already gone; cleared its record";
export const REAP_STOPPED: string = "stopped this workspace's daemon, so the next run cannot attach to the old build";
export const REAP_OTHER: string = "left the daemon on that port alone - it is serving another workspace, so stop it there with joule --stop";
export const REAP_NO_ACK: string = "asked this workspace's daemon to stop but saw no acknowledgement - it may be finishing a turn; stop it with joule --stop if it lingers";

export function sawStopping(frames: string[]): bool {
  for (const f of frames) {
    if (frameType(f) == DAEMON_STOPPING) { return true; }
  }
  return false;
}

export function reapDaemonForUpdate(workspaceRoot: string): string {
  let port = daemonPortOrZero(workspaceRoot);
  if (port == 0) { return REAP_NONE; }

  if (!worthConnectingTo(DAEMON_HOST, port)) {
    removeDaemonInfo(workspaceRoot);
    return REAP_GONE;
  }

  let client = new DaemonClient(DAEMON_HOST, port, tmpDir());
  client.connect();
  let ready = waitForReady(client, CONNECT_WAIT_TICKS);
  if (!ready.ready) {
    client.detach();
    removeDaemonInfo(workspaceRoot);
    return REAP_GONE;
  }

  let settled = waitForHello(client, ready.frames, HELLO_WAIT_TICKS);
  let seen = helloWorkspace(settled);
  if (seen != "" && seen != workspaceRoot) {
    client.detach();
    return REAP_OTHER;
  }

  client.publish(encodeDaemonStop({ v: PROTOCOL_VERSION, seq: 0, type: DAEMON_STOP }));

  let acked = sawStopping(settled);
  let i = 0;
  while (i < STOP_ACK_TICKS && !acked) {
    acked = sawStopping(client.pollInbound());
    if (!acked) { process.sleep(POLL_MS); }
    i = i + 1;
  }
  client.detach();

  if (acked && waitForDaemonGone(workspaceRoot, STOP_GONE_TICKS)) { return REAP_STOPPED; }
  return REAP_NO_ACK;
}
