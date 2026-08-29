import { ensureAttached, sessionNameFlag } from "./attach_lifecycle.ts";
import { hasContinueFlag } from "../terminal/resume.ts";
import { workspaceRoot as currentWorkspaceRoot } from "../vendor/platform/platform.ts";

export const ENSURE_COMMAND: string = "daemon-ensure";

export function hasEnsureCommand(argv: string[]): bool {
  for (const a of argv) {
    if (a == ENSURE_COMMAND) { return true; }
  }
  return false;
}

export function boolText(b: bool): string {
  if (b) { return "true"; }
  return "false";
}

export function jsonString(s: string): string {
  let out = "\"";
  let i = 0;
  while (i < s.length) {
    let c = s.charAt(i);
    if (c == "\"" || c == "\\") { out = out + "\\"; }
    out = out + c;
    i = i + 1;
  }
  return out + "\"";
}

export function ensureReport(ready: bool, workspace: string, port: int, spawned: bool): string {
  return "{\"ok\":" + boolText(ready)
    + ",\"workspace\":" + jsonString(workspace)
    + ",\"port\":" + `${port}`
    + ",\"spawned\":" + boolText(spawned) + "}";
}

export function runDaemonEnsure(argv: string[]): void {
  let workspaceRoot = currentWorkspaceRoot();
  let result = ensureAttached(workspaceRoot, sessionNameFlag(argv), hasContinueFlag(argv));
  let ready = result.client.socketReady;
  let port = result.client.port;
  result.client.detach();
  for (const n of result.notes) { console.log(n); }
  console.log(ensureReport(ready, workspaceRoot, port, result.spawned));
  if (!ready) {
    process.exit(1);
  }
}

test("ensureReport is one line of JSON naming the port and whether it spawned", () => {
  let line = ensureReport(true, "/home/a/proj", 8412, false);
  expect(line == "{\"ok\":true,\"workspace\":\"/home/a/proj\",\"port\":8412,\"spawned\":false}");
});

test("ensureReport escapes a workspace path containing a quote or a backslash", () => {
  let line = ensureReport(false, "/tmp/od\"d\\path", 1, true);
  expect(line == "{\"ok\":false,\"workspace\":\"/tmp/od\\\"d\\\\path\",\"port\":1,\"spawned\":true}");
});

test("hasEnsureCommand finds the subcommand among other args", () => {
  expect(hasEnsureCommand(["joule", "daemon-ensure"]));
  expect(!hasEnsureCommand(["joule", "attach"]));
});
