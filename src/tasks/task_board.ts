import { PROTOCOL_VERSION, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR, REASON_DONE, REASON_CANCELLED, REASON_ERROR, TextDeltaFrame, ToolCallFrame, ToolResultFrame, ApprovalRequestFrame, TurnEndFrame, ErrorFrame, encodeTextDelta, encodeToolCall, encodeToolResult, encodeApprovalRequest, encodeTurnEnd, encodeError } from "../protocol/frames.ts";
import { Session } from "../session/session.ts";
import { ROLE_USER } from "../session/types.ts";
import { appendMailbox } from "./mailbox.ts";
import { BackgroundRunTask, SubagentTask, PendingAgentApproval } from "./state.ts";
import { TAG_DELTA, TAG_TOOLCALL, TAG_TOOLRESULT, TAG_APPROVAL_REQUEST, TAG_ERROR, TAG_DONE, TAG_CANCELLED, decodeSubagentApprovalPayload, decodeSubagentErrorPayload } from "./subagent_protocol.ts";
import { emitAgentToolCall, emitAgentToolResult, emitAgentApprovalRequest } from "./agent_frames.ts";

const BG_TURN_PREFIX: string = "bg:";
const AGENT_TURN_PREFIX: string = "agent:";

export function backgroundTurnId(id: string): string {
  return BG_TURN_PREFIX + id;
}

export function agentTurnId(id: string): string {
  return AGENT_TURN_PREFIX + id;
}

export function isTaskTurnId(turnId: string): bool {
  if (turnId.length >= BG_TURN_PREFIX.length && turnId.slice(0, BG_TURN_PREFIX.length) == BG_TURN_PREFIX) { return true; }
  if (turnId.length >= AGENT_TURN_PREFIX.length && turnId.slice(0, AGENT_TURN_PREFIX.length) == AGENT_TURN_PREFIX) { return true; }
  return false;
}

export class TaskBoard {
  nextId: int;
  runTasks: BackgroundRunTask[];
  agentTasks: SubagentTask[];
  pendingApprovals: PendingAgentApproval[];

  constructor() {
    this.nextId = 1;
    this.runTasks = [];
    this.agentTasks = [];
    this.pendingApprovals = [];
  }

  freshId(prefix: string): string {
    let id = prefix + `${this.nextId}`;
    this.nextId = this.nextId + 1;
    return id;
  }

  registerRunTask(t: BackgroundRunTask): void {
    this.runTasks.push(t);
  }

  registerAgentTask(t: SubagentTask): void {
    this.agentTasks.push(t);
  }

  findRunTask(id: string): BackgroundRunTask[] {
    for (const t of this.runTasks) {
      if (t.id == id) { return [t]; }
    }
    return [];
  }

  findAgentTask(id: string): SubagentTask[] {
    for (const t of this.agentTasks) {
      if (t.id == id) { return [t]; }
    }
    return [];
  }

  cancel(id: string): string {
    let agent = this.findAgentTask(id);
    if (agent.length > 0) {
      if (agent[0].done) { return "subagent " + id + " has already finished"; }
      fs.writeFileSync(agent[0].cancelPath, "cancel");
      return "cancellation requested for subagent " + id + " - it checks between steps and may take a moment to stop";
    }
    let runTasks = this.findRunTask(id);
    if (runTasks.length > 0) {
      let rt = runTasks[0];
      if (rt.done) { return "background task " + id + " has already finished"; }
      rt.detached = true;
      return "detached from background task " + id + " - its process keeps running and cannot be killed (lumen-lang-org/lumen#6); nothing further from it will be shown here";
    }
    return "no task or subagent with id " + id;
  }

  listText(): string {
    let lines: string[] = [];
    for (const t of this.runTasks) {
      let status = t.done ? "done " + t.lastStatus : (t.detached ? "detached" : "running");
      lines.push("bg    " + t.id + "  " + status + "  " + t.command);
    }
    for (const t of this.agentTasks) {
      let status = t.done ? "done" : "running";
      lines.push("agent " + t.id + "  " + status + "  " + t.taskText);
    }
    if (lines.length == 0) { return "no background tasks or subagents"; }
    let out = "";
    let i = 0;
    while (i < lines.length) {
      if (i > 0) { out = out + "\n"; }
      out = out + lines[i];
      i = i + 1;
    }
    return out;
  }

  hasPendingApproval(): bool {
    return this.pendingApprovals.length > 0;
  }

  activeApprovalText(): string {
    if (this.pendingApprovals.length == 0) { return ""; }
    let a = this.pendingApprovals[0];
    return "agent " + a.agentId + ": " + a.tool + " " + a.summary;
  }

  activeApproval(): PendingAgentApproval[] {
    if (this.pendingApprovals.length == 0) { return []; }
    return [this.pendingApprovals[0]];
  }

  activeApprovalTool(): string {
    let a = this.activeApproval();
    if (a.length == 0) { return ""; }
    return a[0].tool;
  }

  activeApprovalSelected(): int {
    let a = this.activeApproval();
    if (a.length == 0) { return 0; }
    return a[0].selected;
  }

  activeApprovalHasOptionRows(): bool {
    let a = this.activeApproval();
    if (a.length == 0) { return false; }
    return a[0].hasOptionRows();
  }

  activeApprovalOptionRows(): int {
    let a = this.activeApproval();
    if (a.length == 0) { return -1; }
    return a[0].firstOptionRow;
  }

  moveActiveApprovalSelection(delta: int, count: int): bool {
    let a = this.activeApproval();
    if (a.length == 0) { return false; }
    return a[0].moveSelection(delta, count);
  }

  setLatestApprovalOptionRows(first: int): void {
    if (this.pendingApprovals.length == 0) { return; }
    this.pendingApprovals[this.pendingApprovals.length - 1].setOptionRows(first);
  }

  answerActiveApproval(decision: string): void {
    if (this.pendingApprovals.length == 0) { return; }
    let a = this.pendingApprovals[0];
    this.pendingApprovals = this.pendingApprovals.slice(1);
    let agent = this.findAgentTask(a.agentId);
    if (agent.length == 0) { return; }
    appendMailbox(agent[0].inPath, a.localCallId, decision);
  }

  pollRunTasks(session: Session): void {
    for (const t of this.runTasks) {
      if (t.done || t.detached) { continue; }
      let entries = t.reader.drainNew();
      for (const e of entries) {
        if (e.tag == "LINE") {
          t.lineCount = t.lineCount + 1;
          let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TEXT_DELTA, turnId: backgroundTurnId(t.id), text: e.payload };
          session.emit(encodeTextDelta(f));
        } else if (e.tag == "EXIT") {
          t.lastStatus = "exit " + e.payload;
        } else if (e.tag == "DONE") {
          t.done = true;
          let summary = (t.lastStatus == "" ? "finished" : t.lastStatus) + ", " + `${t.lineCount}` + " lines";
          let rf: ToolResultFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TOOL_RESULT, turnId: backgroundTurnId(t.id), callId: t.id, ok: t.lastStatus == "" || t.lastStatus == "exit 0", output: summary, truncated: false };
          session.emit(encodeToolResult(rf));
          let ef: TurnEndFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TURN_END, turnId: backgroundTurnId(t.id), reason: REASON_DONE };
          session.emit(encodeTurnEnd(ef));
        }
      }
    }
  }

  pollAgentTasks(session: Session): void {
    for (const t of this.agentTasks) {
      if (t.done) { continue; }
      let entries = t.reader.drainNew();
      for (const e of entries) {
        this.applyAgentEntry(session, t, e.tag, e.payload);
      }
    }
  }

  applyAgentEntry(session: Session, t: SubagentTask, tag: string, payload: string): void {
    let turnId = agentTurnId(t.id);
    if (tag == TAG_DELTA) {
      t.accumulated = t.accumulated + payload;
      let f: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TEXT_DELTA, turnId: turnId, text: payload };
      session.emit(encodeTextDelta(f));
      return;
    }
    if (tag == TAG_TOOLCALL) {
      emitAgentToolCall(session, t, turnId, payload);
      return;
    }
    if (tag == TAG_TOOLRESULT) {
      emitAgentToolResult(session, t, turnId, payload);
      return;
    }
    if (tag == TAG_APPROVAL_REQUEST) {
      let probe = decodeSubagentApprovalPayload(payload);
      if (!probe.found) { return; }
      this.pendingApprovals.push(new PendingAgentApproval(t.id, probe.value.callId, probe.value.tool, probe.value.summary));
      emitAgentApprovalRequest(session, t, turnId, payload);
      return;
    }
    if (tag == TAG_ERROR) {
      let d = decodeSubagentErrorPayload(payload);
      let message = d.found ? d.value.message : payload;
      t.done = true;
      t.finalNote = "subagent " + t.id + " failed: " + message;
      let f: ErrorFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: ERROR, code: "E_SUBAGENT", message: message };
      session.emit(encodeError(f));
      let ef: TurnEndFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TURN_END, turnId: turnId, reason: REASON_ERROR };
      session.emit(encodeTurnEnd(ef));
      this.reportAgentResult(session, t);
      return;
    }
    if (tag == TAG_CANCELLED) {
      t.done = true;
      t.finalNote = "subagent " + t.id + " was cancelled: " + payload + (t.accumulated == "" ? "" : " (partial result: " + t.accumulated + ")");
      let ef: TurnEndFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TURN_END, turnId: turnId, reason: REASON_CANCELLED };
      session.emit(encodeTurnEnd(ef));
      this.reportAgentResult(session, t);
      return;
    }
    if (tag == TAG_DONE) {
      t.done = true;
      t.finalNote = "subagent " + t.id + " finished: " + t.accumulated;
      let ef: TurnEndFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TURN_END, turnId: turnId, reason: REASON_DONE };
      session.emit(encodeTurnEnd(ef));
      this.reportAgentResult(session, t);
      return;
    }
  }

  reportAgentResult(session: Session, t: SubagentTask): void {
    session.history.push({ role: ROLE_USER, text: "[subagent " + t.id + " report - task: " + t.taskText + "]\n" + t.finalNote, toolCallId: "", toolCalls: [] });
  }

  poll(session: Session): void {
    this.pollRunTasks(session);
    this.pollAgentTasks(session);
  }
}
