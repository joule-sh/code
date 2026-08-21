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

  constructor(agentId: string, localCallId: string, tool: string, summary: string) {
    this.agentId = agentId;
    this.localCallId = localCallId;
    this.tool = tool;
    this.summary = summary;
  }
}
