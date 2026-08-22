import { sessionKeyFor } from "../session/persistence.ts";

export const ATTACH_PREFIX: string = "/attach/";
export const ATTACH_SUFFIX: string = "/ws";

export function daemonRuntimeDir(workspaceRoot: string): string {
  let home = process.env("HOME") ?? "";
  return home + "/.config/joule-code/daemon/" + sessionKeyFor(workspaceRoot);
}

export function inboxDir(runtimeDir: string): string {
  return runtimeDir + "/inbox";
}

export function inboxPath(runtimeDir: string, connId: string): string {
  return inboxDir(runtimeDir) + "/" + connId + ".in";
}

export function broadcastLogPath(runtimeDir: string): string {
  return runtimeDir + "/broadcast.log";
}

export function attachPath(connId: string): string {
  return ATTACH_PREFIX + connId + ATTACH_SUFFIX;
}

export function connIdFromPath(pathname: string): string {
  if (!pathname.startsWith(ATTACH_PREFIX)) { return ""; }
  if (!pathname.endsWith(ATTACH_SUFFIX)) { return ""; }
  if (pathname.length <= ATTACH_PREFIX.length + ATTACH_SUFFIX.length) { return ""; }
  return pathname.slice(ATTACH_PREFIX.length, pathname.length - ATTACH_SUFFIX.length);
}

export function isSafeConnId(connId: string): bool {
  if (connId == "") { return false; }
  if (connId.length > 128) { return false; }
  let i = 0;
  while (i < connId.length) {
    let c = connId.charAt(i);
    let isDigit = c >= "0" && c <= "9";
    let isLower = c >= "a" && c <= "z";
    let isUpper = c >= "A" && c <= "Z";
    if (!isDigit && !isLower && !isUpper && c != "-") { return false; }
    i = i + 1;
  }
  return true;
}
