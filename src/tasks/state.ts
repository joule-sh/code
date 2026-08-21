import { MailboxReader } from "./mailbox.ts";

export class BackgroundRunTask {
  id: string;
  command: string;
  mailboxPath: string;
  reader: MailboxReader;
  startedAt: i64;
  done: bool;
  detached: bool;
  lineCount: int;
  lastStatus: string;

  constructor(id: string, command: string, mailboxPath: string) {
    this.id = id;
    this.command = command;
    this.mailboxPath = mailboxPath;
    this.reader = new MailboxReader(mailboxPath);
    this.startedAt = Date.now();
    this.done = false;
    this.detached = false;
    this.lineCount = 0;
    this.lastStatus = "";
  }
}

export class SubagentTask {
  id: string;
  taskText: string;
  outPath: string;
  inPath: string;
  cancelPath: string;
  mode: string;
  reader: MailboxReader;
  startedAt: i64;
  done: bool;
  accumulated: string;
  finalNote: string;

  constructor(id: string, taskText: string, outPath: string, inPath: string, cancelPath: string, mode: string) {
    this.id = id;
    this.taskText = taskText;
    this.outPath = outPath;
    this.inPath = inPath;
    this.cancelPath = cancelPath;
    this.mode = mode;
    this.reader = new MailboxReader(outPath);
    this.startedAt = Date.now();
    this.done = false;
    this.accumulated = "";
    this.finalNote = "";
  }
}

export class PendingAgentApproval {
  agentId: string;
  localCallId: string;
  tool: string;
  summary: string;
  selected: int;
  firstOptionRow: int;

  constructor(agentId: string, localCallId: string, tool: string, summary: string) {
    this.agentId = agentId;
    this.localCallId = localCallId;
    this.tool = tool;
    this.summary = summary;
    this.selected = 0;
    this.firstOptionRow = -1;
  }

  setOptionRows(first: int): void {
    this.firstOptionRow = first;
  }

  hasOptionRows(): bool {
    return this.firstOptionRow >= 0;
  }

  moveSelection(delta: int, count: int): bool {
    let next = this.selected + delta;
    if (next < 0) {
      next = 0;
    }
    if (next > count - 1) {
      next = count - 1;
    }
    if (next == this.selected) {
      return false;
    }
    this.selected = next;
    return true;
  }

  select(index: int, count: int): void {
    if (index < 0 || index >= count) {
      return;
    }
    this.selected = index;
  }
}
