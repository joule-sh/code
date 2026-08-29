import { sessionKeyFor } from "../session/persistence.ts";
import { detectRunningExePath } from "../update/install_detect.ts";
import { shellQuoteSingle, powershellQuoteSingle } from "../tools/shell_quote.ts";
import { exeSuffix, homeDir, isWindows, shellArgs } from "../vendor/platform/platform.ts";

export type DaemonInfo = { workspace: string, session: string, port: int, startedAt: string };

export function daemonInfoDir(): string {
  let home = homeDir();
  return home + "/.config/joule-code/daemon";
}

export function daemonInfoPath(workspaceRoot: string, sessionName: string): string {
  return daemonInfoDir() + "/" + sessionKeyFor(workspaceRoot, sessionName) + ".json";
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

export function writeDaemonInfoAt(infoPath: string, workspace: string, sessionName: string, port: int): void {
  let dir = path.dirname(infoPath);
  if (dir != "" && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, true);
  }
  let info: DaemonInfo = { workspace: workspace, session: sessionName, port: port, startedAt: `${Date.now()}` };
  fs.writeFileSync(infoPath, JSON.stringify(info));
}

export function removeDaemonInfoAt(infoPath: string): void {
  if (fs.existsSync(infoPath)) {
    fs.unlinkSync(infoPath);
  }
}

export function readDaemonInfo(workspaceRoot: string, sessionName: string): DaemonInfo | null {
  return readDaemonInfoAt(daemonInfoPath(workspaceRoot, sessionName));
}

export function writeDaemonInfo(workspaceRoot: string, sessionName: string, port: int): void {
  writeDaemonInfoAt(daemonInfoPath(workspaceRoot, sessionName), workspaceRoot, sessionName, port);
}

export function daemonPortOrZero(workspaceRoot: string, sessionName: string): int {
  let infoPath = daemonInfoPath(workspaceRoot, sessionName);
  if (!fs.existsSync(infoPath)) { return 0; }
  try {
    let info = JSON.parse<DaemonInfo>(fs.readFileSync(infoPath));
    return info.port;
  } catch {
    return 0;
  }
}

export function removeDaemonInfo(workspaceRoot: string, sessionName: string): void {
  removeDaemonInfoAt(daemonInfoPath(workspaceRoot, sessionName));
}

export function portFromWorkspace(workspaceRoot: string, sessionName: string, base: int, spread: int): int {
  let key = sessionKeyFor(workspaceRoot, sessionName);
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

export function posixDaemonSpawnCommand(workspaceRoot: string, sessionName: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string {
  let resumeEnv = "";
  if (resumeFlag) { resumeEnv = "JOULE_DAEMON_RESUME=1 "; }
  let sessionEnv = "";
  if (sessionName != "") { sessionEnv = "JOULE_SESSION_NAME=" + shellQuoteSingle(sessionName) + " "; }
  return "(cd " + workspaceRoot + " && JOULE_DAEMON_PORT=" + `${port}` + " " + sessionEnv + resumeEnv + "nohup " + daemonBinPath + ") >" + logPath + " 2>&1 </dev/null &";
}

export function windowsDaemonStartCommand(workspaceRoot: string, logPath: string, daemonBinPath: string): string {
  return "Start-Process -FilePath " + powershellQuoteSingle(daemonBinPath)
    + " -WorkingDirectory " + powershellQuoteSingle(workspaceRoot)
    + " -WindowStyle Hidden"
    + " -RedirectStandardOutput " + powershellQuoteSingle(logPath)
    + " -RedirectStandardError " + powershellQuoteSingle(daemonErrorLogPath(logPath));
}

export function windowsDaemonSpawnCommand(workspaceRoot: string, sessionName: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string {
  let resumeValue = "";
  if (resumeFlag) { resumeValue = "1"; }
  return "$ErrorActionPreference = 'Stop'; "
    + "$env:JOULE_DAEMON_PORT = '" + `${port}` + "'; "
    + "$env:JOULE_SESSION_NAME = " + powershellQuoteSingle(sessionName) + "; "
    + "$env:JOULE_DAEMON_RESUME = '" + resumeValue + "'; "
    + "Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden"
    + " -ArgumentList '-NoProfile','-NonInteractive','-Command',"
    + powershellQuoteSingle(windowsDaemonStartCommand(workspaceRoot, logPath, daemonBinPath));
}

export function daemonSpawnCommand(workspaceRoot: string, sessionName: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string {
  if (isWindows()) {
    return windowsDaemonSpawnCommand(workspaceRoot, sessionName, port, logPath, resumeFlag, daemonBinPath);
  }
  return posixDaemonSpawnCommand(workspaceRoot, sessionName, port, logPath, resumeFlag, daemonBinPath);
}

export function daemonSpawnArgs(workspaceRoot: string, sessionName: string, port: int, logPath: string, resumeFlag: bool, daemonBinPath: string): string[] {
  return shellArgs(daemonSpawnCommand(workspaceRoot, sessionName, port, logPath, resumeFlag, daemonBinPath));
}

export function daemonLogPath(workspaceRoot: string, sessionName: string): string {
  return daemonInfoDir() + "/" + sessionKeyFor(workspaceRoot, sessionName) + ".log";
}

export function daemonErrorLogPath(logPath: string): string {
  return logPath + ".err";
}
