import { sessionKeyFor } from "../session/persistence.ts";
import { detectRunningExePath } from "../update/install_detect.ts";
import { powershellQuoteSingle } from "../tools/shell_quote.ts";
import { exeSuffix, homeDir, isWindows, shellArgs } from "../vendor/platform/platform.ts";

export type DaemonInfo = { workspace: string, port: int, startedAt: string };

export function daemonInfoDir(): string {
  let home = homeDir();
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

export function daemonPortOrZero(workspaceRoot: string): int {
  let infoPath = daemonInfoPath(workspaceRoot);
  if (!fs.existsSync(infoPath)) { return 0; }
  try {
    let info = JSON.parse<DaemonInfo>(fs.readFileSync(infoPath));
    return info.port;
  } catch {
    return 0;
  }
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
  let name = "joule-daemon" + exeSuffix();
  if (runningExePath == "") { return "bin/" + name; }
  return path.dirname(runningExePath) + "/" + name;
}

export function defaultDaemonBinPath(): string {
  return daemonBinNameFor(detectRunningExePath());
}

export function posixDaemonSpawnCommand(workspaceRoot: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string {
  let resumeEnv = "";
  if (resumeFlag) { resumeEnv = "JOULE_DAEMON_RESUME=1 "; }
  return "(cd " + workspaceRoot + " && JOULE_DAEMON_PORT=" + `${port}` + " " + resumeEnv + "nohup " + daemonBinPath + ") >" + logPath + " 2>&1 </dev/null &";
}

export function windowsDaemonStartCommand(workspaceRoot: string, logPath: string, daemonBinPath: string): string {
  return "Start-Process -FilePath " + powershellQuoteSingle(daemonBinPath)
    + " -WorkingDirectory " + powershellQuoteSingle(workspaceRoot)
    + " -WindowStyle Hidden"
    + " -RedirectStandardOutput " + powershellQuoteSingle(logPath)
    + " -RedirectStandardError " + powershellQuoteSingle(daemonErrorLogPath(logPath));
}

export function windowsDaemonSpawnCommand(workspaceRoot: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string {
  let resumeValue = "";
  if (resumeFlag) { resumeValue = "1"; }
  return "$ErrorActionPreference = 'Stop'; "
    + "$env:JOULE_DAEMON_PORT = '" + `${port}` + "'; "
    + "$env:JOULE_DAEMON_RESUME = '" + resumeValue + "'; "
    + "Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden"
    + " -ArgumentList '-NoProfile','-NonInteractive','-Command',"
    + powershellQuoteSingle(windowsDaemonStartCommand(workspaceRoot, logPath, daemonBinPath));
}

export function daemonSpawnCommand(workspaceRoot: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string {
  if (isWindows()) {
    return windowsDaemonSpawnCommand(workspaceRoot, port, logPath, resumeFlag, daemonBinPath);
  }
  return posixDaemonSpawnCommand(workspaceRoot, port, logPath, resumeFlag, daemonBinPath);
}

export function daemonSpawnArgs(workspaceRoot: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string[] {
  return shellArgs(daemonSpawnCommand(workspaceRoot, port, logPath, resumeFlag, daemonBinPath));
}

export function daemonLogPath(workspaceRoot: string): string {
  return daemonInfoDir() + "/" + sessionKeyFor(workspaceRoot) + ".log";
}

export function daemonErrorLogPath(logPath: string): string {
  return logPath + ".err";
}
