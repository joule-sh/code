import { ApprovalDecision } from "../session/types.ts";

export const MODE_READ_ONLY: string = "read-only";
export const MODE_AUTO_EDIT: string = "auto-edit";
export const MODE_FULL_AUTO: string = "full-auto";

export const REPLY_ALLOW: string = "allow";
export const REPLY_DENY: string = "deny";
export const REPLY_ALWAYS: string = "always";

const DEFAULT_POLL_MS: int = 100;

function isReadTool(tool: string): bool {
  return tool == "read" || tool == "list" || tool == "grep";
}

export class Gate {
  mode: string;
  timeoutMs: int;
  pollMs: int;
  alwaysAllowed: string[];
  repliedCallIds: string[];
  repliedDecisions: string[];
  onRequest: (callId: string, tool: string, summary: string, args: string) => void;
  onPoll: () => void;

  constructor(mode: string, timeoutMs: int, onRequest: (callId: string, tool: string, summary: string, args: string) => void, onPoll: () => void) {
    this.mode = mode;
    this.timeoutMs = timeoutMs;
    this.pollMs = DEFAULT_POLL_MS;
    this.alwaysAllowed = [];
    this.repliedCallIds = [];
    this.repliedDecisions = [];
    this.onRequest = onRequest;
    this.onPoll = onPoll;
  }

  setOnPoll(onPoll: () => void): void {
    this.onPoll = onPoll;
  }

  reply(callId: string, decision: string): void {
    let i = 0;
    while (i < this.repliedCallIds.length) {
      if (this.repliedCallIds[i] == callId) {
        return;
      }
      i = i + 1;
    }
    this.repliedCallIds.push(callId);
    this.repliedDecisions.push(decision);
  }

  findReply(callId: string): string {
    let i = 0;
    while (i < this.repliedCallIds.length) {
      if (this.repliedCallIds[i] == callId) {
        return this.repliedDecisions[i];
      }
      i = i + 1;
    }
    return "";
  }

  isAlwaysAllowed(tool: string): bool {
    for (const t of this.alwaysAllowed) {
      if (t == tool) {
        return true;
      }
    }
    return false;
  }

  needsAsking(tool: string): bool {
    if (isReadTool(tool)) {
      return false;
    }
    if (this.mode == MODE_FULL_AUTO) {
      return false;
    }
    if (this.mode == MODE_AUTO_EDIT) {
      return tool == "run";
    }
    return true;
  }

  check(callId: string, tool: string, summary: string, args: string): ApprovalDecision {
    if (isReadTool(tool)) {
      return { allow: true };
    }

    if (this.mode == MODE_READ_ONLY) {
      return { allow: false };
    }

    if (!this.needsAsking(tool)) {
      return { allow: true };
    }

    if (this.isAlwaysAllowed(tool)) {
      return { allow: true };
    }

    this.onRequest(callId, tool, summary, args);

    let waited = 0;
    while (waited < this.timeoutMs) {
      let decision = this.findReply(callId);
      if (decision != "") {
        if (decision == REPLY_ALWAYS) {
          this.alwaysAllowed.push(tool);
          return { allow: true };
        }
        if (decision == REPLY_ALLOW) {
          return { allow: true };
        }
        return { allow: false };
      }
      this.onPoll();
      process.sleep(this.pollMs);
      waited = waited + this.pollMs;
    }
    return { allow: false };
  }
}
