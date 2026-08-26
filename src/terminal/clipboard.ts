import { WINDOWS, envOr, isWindows, shellProgram, shellArgs, tempDir, chmodPath, pathListSeparator } from "../vendor/platform/platform.ts";
import { shellQuoteSingle, powershellQuoteSingle } from "../tools/shell_quote.ts";
import { osc52Sequence } from "./osc52.ts";

export const MACOS: string = "darwin";

export const COPY_TOOL: string = "tool";
export const COPY_TERMINAL: string = "terminal";
export const COPY_NOWHERE: string = "nowhere";

export type CopyPlan = { remote: bool, tool: string };

export function isRemoteSession(sshConnection: string, sshTty: string): bool {
  return sshConnection.trim() != "" || sshTty.trim() != "";
}

export function hasDisplay(display: string, wayland: string): bool {
  return display.trim() != "" || wayland.trim() != "";
}

export function toolCandidates(platform: string, wayland: string): string[] {
  if (platform == MACOS) { return ["pbcopy"]; }
  if (platform == WINDOWS) { return ["clip.exe"]; }
  if (wayland.trim() != "") { return ["wl-copy", "xclip", "xsel"]; }
  return ["xclip", "xsel", "wl-copy"];
}

export function needsDisplay(platform: string): bool {
  return platform != MACOS && platform != WINDOWS;
}

export function chooseTool(platform: string, display: string, wayland: string, onPath: (name: string) => bool): string {
  if (needsDisplay(platform) && !hasDisplay(display, wayland)) { return ""; }
  let names = toolCandidates(platform, wayland);
  let i = 0;
  while (i < names.length) {
    if (onPath(names[i])) { return names[i]; }
    i = i + 1;
  }
  return "";
}

export function toolScript(tool: string, filePath: string): string {
  if (tool == "clip.exe") {
    return "Set-Clipboard -Value ([System.IO.File]::ReadAllText(" + powershellQuoteSingle(filePath) + "))";
  }
  let quoted = shellQuoteSingle(filePath);
  if (tool == "pbcopy") { return "pbcopy < " + quoted; }
  if (tool == "wl-copy") { return "wl-copy < " + quoted + " >/dev/null 2>&1"; }
  if (tool == "xclip") { return "xclip -selection clipboard -i " + quoted + " >/dev/null 2>&1"; }
  if (tool == "xsel") { return "xsel --clipboard --input < " + quoted + " >/dev/null 2>&1"; }
  return "";
}

export function planText(plan: CopyPlan): string {
  if (plan.tool != "") { return "copy runs " + plan.tool + " here, so no terminal setting can block it"; }
  if (plan.remote) { return "over ssh, so copy is handed to your terminal (OSC 52) - it may refuse"; }
  return "no clipboard command here, so copy is handed to the terminal (OSC 52)";
}

function existsOnDisk(candidate: string): bool {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

export function onPathNow(name: string): bool {
  let separator = isWindows() ? "\\" : "/";
  let dirs = envOr("PATH", "").split(pathListSeparator());
  let i = 0;
  while (i < dirs.length) {
    if (dirs[i].trim() != "" && existsOnDisk(dirs[i] + separator + name)) { return true; }
    i = i + 1;
  }
  return false;
}

export function currentPlan(): CopyPlan {
  if (isRemoteSession(envOr("SSH_CONNECTION", ""), envOr("SSH_TTY", ""))) {
    let remote: CopyPlan = { remote: true, tool: "" };
    return remote;
  }
  let found = chooseTool(process.platform(), envOr("DISPLAY", ""), envOr("WAYLAND_DISPLAY", ""), onPathNow);
  let local: CopyPlan = { remote: false, tool: found };
  return local;
}

export function writeThroughTool(tool: string, text: string): bool {
  let script = toolScript(tool, "");
  if (script == "") { return false; }
  let handoff = tempDir() + "/joule-clip-" + crypto.randomUUID();
  try {
    fs.writeFileSync(handoff, text);
  } catch {
    return false;
  }
  chmodPath(handoff, 0o600);
  let ran = child_process.spawnSync(shellProgram(), shellArgs(toolScript(tool, handoff)));
  if (fs.existsSync(handoff)) { fs.unlinkSync(handoff); }
  return ran.status == 0;
}

export function copySelection(text: string): string {
  if (text == "") { return COPY_NOWHERE; }
  let plan = currentPlan();
  if (plan.tool == "") {
    process.stdout().write(osc52Sequence(text));
    return COPY_TERMINAL;
  }
  if (writeThroughTool(plan.tool, text)) { return COPY_TOOL; }
  return COPY_NOWHERE;
}
