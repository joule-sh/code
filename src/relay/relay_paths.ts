export function relayRuntimeDir(httpPort: int): string {
  let fromEnv = process.env("JOULE_RELAY_RUNTIME_DIR") ?? "";
  if (fromEnv != "") { return fromEnv; }
  let tmp = process.env("TMPDIR") ?? "/tmp";
  return tmp + "/joule-relay-runtime-" + `${httpPort}`;
}

export function commandsLogPath(runtimeDir: string): string {
  return runtimeDir + "/commands.log";
}

export function resultsLogPath(runtimeDir: string): string {
  return runtimeDir + "/results.log";
}

export function sessionsDir(runtimeDir: string): string {
  return runtimeDir + "/sessions";
}

export function sessionDir(runtimeDir: string, sessionId: string): string {
  return sessionsDir(runtimeDir) + "/" + sessionId;
}

export function toBrowserLogPath(runtimeDir: string, sessionId: string): string {
  return sessionDir(runtimeDir, sessionId) + "/to-browser.log";
}

export function toTerminalLogPath(runtimeDir: string, sessionId: string): string {
  return sessionDir(runtimeDir, sessionId) + "/to-terminal.log";
}

export function isSafeSessionId(sessionId: string): bool {
  if (sessionId == "") { return false; }
  if (sessionId.length > 128) { return false; }
  let i = 0;
  while (i < sessionId.length) {
    let c = sessionId.charAt(i);
    let isDigit = c >= "0" && c <= "9";
    let isLower = c >= "a" && c <= "z";
    let isUpper = c >= "A" && c <= "Z";
    if (!isDigit && !isLower && !isUpper && c != "-") { return false; }
    i = i + 1;
  }
  return true;
}
