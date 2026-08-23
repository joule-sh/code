import { appendMailbox, findMailboxEntry } from "../tasks/mailbox.ts";
import { commandsLogPath, resultsLogPath } from "./relay_paths.ts";

export const RPC_TIMEOUT_MS: int = 5000;
export const RPC_POLL_MS: int = 15;

export type StoreCaller = (commandJson: string) => string;

export function remoteStoreCaller(runtimeDir: string): StoreCaller {
  return (commandJson: string) => callStore(runtimeDir, commandJson);
}

export function callStore(runtimeDir: string, commandJson: string): string {
  let reqId = crypto.randomUUID();
  appendMailbox(commandsLogPath(runtimeDir), reqId, commandJson);
  return waitForResult(runtimeDir, reqId, RPC_TIMEOUT_MS);
}

export function waitForResult(runtimeDir: string, reqId: string, timeoutMs: int): string {
  let waited: int = 0;
  while (waited < timeoutMs) {
    let found = findMailboxEntry(resultsLogPath(runtimeDir), reqId);
    if (found != "") { return found; }
    process.sleep(RPC_POLL_MS);
    waited = waited + RPC_POLL_MS;
  }
  return "";
}
