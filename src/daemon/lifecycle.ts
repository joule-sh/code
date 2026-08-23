import { sessionKeyFor } from "../session/persistence.ts";
import { detectRunningExePath } from "../update/install_detect.ts";

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

export function readDaemonInfoAt(infoPath: string): DaemonInfo | null {
  if (!fs.existsSync(infoPath)) { return null; }
  return parseDaemonInfo(fs.readFileSync(infoPath));
}

export function writeDaemonInfoAt(infoPath: string, workspace: string, port: int): void {
  let dir = path.dirname(infoPath);
  if (dir != "" && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, true);
  }
  let info: DaemonInfo = { workspace: workspace, port: port, startedAt: `${Date.now()}` };
  fs.writeFileSync(infoPath, JSON.stringify(info));
}

export function removeDaemonInfoAt(infoPath: string): void {
  if (fs.existsSync(infoPath)) {
    fs.unlinkSync(infoPath);
  }
}

export function readDaemonInfo(workspaceRoot: string): DaemonInfo | null {
  return readDaemonInfoAt(daemonInfoPath(workspaceRoot));
}

export function writeDaemonInfo(workspaceRoot: string, port: int): void {
  writeDaemonInfoAt(daemonInfoPath(workspaceRoot), workspaceRoot, port);
}

export function removeDaemonInfo(workspaceRoot: string): void {
  removeDaemonInfoAt(daemonInfoPath(workspaceRoot));
}

export function portFromWorkspace(workspaceRoot: string, base: int, spread: int): int {
  let key = sessionKeyFor(workspaceRoot);
  let sum = 0;
  let i = 0;
  while (i < key.length) {
    sum = sum + key.charCodeAt(i);
    i = i + 1;
  }
  return base + (sum % spread);
}

export function daemonBinNameFor(runningExePath: string): string {
  if (runningExePath == "") { return "bin/joule-daemon"; }
  return path.dirname(runningExePath) + "/joule-daemon";
}

export function defaultDaemonBinPath(): string {
  return daemonBinNameFor(detectRunningExePath());
}

export function daemonSpawnCommand(workspaceRoot: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string {
  let resumeEnv = "";
  if (resumeFlag) { resumeEnv = "JOULE_DAEMON_RESUME=1 "; }
  return "cd " + workspaceRoot + " && JOULE_DAEMON_PORT=" + `${port}` + " " + resumeEnv + "nohup " + daemonBinPath + " >" + logPath + " 2>&1 & disown";
}

export function daemonSpawnArgs(workspaceRoot: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string[] {
  return ["-c", daemonSpawnCommand(workspaceRoot, port, logPath, resumeFlag, daemonBinPath)];
}

export function daemonLogPath(workspaceRoot: string): string {
  return daemonInfoDir() + "/" + sessionKeyFor(workspaceRoot) + ".log";
}
