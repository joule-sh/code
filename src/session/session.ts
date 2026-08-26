import { PROTOCOL_VERSION, TURN_START, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, TURN_END, ERROR, REASON_DONE, REASON_CANCELLED, REASON_ERROR, TurnStartFrame, TextDeltaFrame, ToolCallFrame, ToolResultFrame, TurnEndFrame, ErrorFrame, encodeTurnStart, encodeTextDelta, encodeToolCall, encodeToolResult, encodeTurnEnd, encodeError } from "../protocol/frames.ts";
import { ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL, ROLE_SYSTEM, Message, ToolCallReq, ToolResult, Provider, ToolRegistry, ApprovalGate, Subscriber } from "./types.ts";
import { UNREPORTED_TEXT, namedCalls, closingToolMessage, repairHistory } from "./history_guard.ts";

const MAX_STEPS: int = 8;

export const SYSTEM_PROMPT: string = "You are joule, an agentic coding terminal. You operate directly on the user's own machine through the read, write, edit, list, grep, and run tools, and every tool call you make, along with its full result, renders live in the user's terminal before your reply appears. That means the user has already seen the raw file contents, command output, or write confirmation you just produced. Do not quote or restate that output verbatim in your response. Reference what you read or did, explain what it means, or act on it next, unless the user explicitly asks you to show them the content again. Keep replies focused on your conclusions and next steps, not on repeating what already scrolled past.";

export class Session {
  workspaceRoot: string;
  mode: string;
  provider: Provider;
  tools: ToolRegistry;
  approval: ApprovalGate;
  subscribers: Subscriber[];
  history: Message[];
  deferred: Message[];
  answering: bool;
  nextSeq: int;
  nextTurn: int;
  cancelledTurnId: string;

  constructor(workspaceRoot: string, mode: string, provider: Provider, tools: ToolRegistry, approval: ApprovalGate) {
    this.workspaceRoot = workspaceRoot;
    this.mode = mode;
    this.provider = provider;
    this.tools = tools;
    this.approval = approval;
    this.subscribers = [];
    this.history = [];
    this.history.push({ role: ROLE_SYSTEM, text: SYSTEM_PROMPT, toolCallId: "", toolCalls: [] });
    this.deferred = [];
    this.answering = false;
    this.nextSeq = 1;
    this.nextTurn = 1;
    this.cancelledTurnId = "";
  }

  subscribe(sub: Subscriber): void {
    this.subscribers.push(sub);
  }

  emit(frameJson: string): void {
    for (const sub of this.subscribers) {
      sub(frameJson);
    }
  }

  takeSeq(): int {
    let s = this.nextSeq;
    this.nextSeq = this.nextSeq + 1;
    return s;
  }

  cancel(turnId: string): void {
    this.cancelledTurnId = turnId;
  }

  appendMessage(m: Message): void {
    if (this.answering) {
      this.deferred.push(m);
      return;
    }
    this.history.push(m);
  }

  flushDeferred(): void {
    for (const m of this.deferred) {
      this.history.push(m);
    }
    this.deferred = [];
  }

  injectSystemContext(text: string): void {
    if (text == "") { return; }
    this.appendMessage({ role: ROLE_SYSTEM, text: text, toolCallId: "", toolCalls: [] });
  }

  note(text: string): void {
    if (text == "") { return; }
    this.appendMessage({ role: ROLE_USER, text: text, toolCallId: "", toolCalls: [] });
  }

  emitDelta(turnId: string, chunk: string): void {
    let frame: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TEXT_DELTA, turnId: turnId, text: chunk };
    this.emit(encodeTextDelta(frame));
  }

  emitToolCall(turnId: string, call: ToolCallReq): void {
    let frame: ToolCallFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TOOL_CALL, turnId: turnId, callId: call.callId, tool: call.tool, args: call.args };
    this.emit(encodeToolCall(frame));
  }

  emitToolResult(turnId: string, callId: string, r: ToolResult): void {
    let frame: ToolResultFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TOOL_RESULT, turnId: turnId, callId: callId, ok: r.ok, output: r.output, truncated: r.truncated };
    this.emit(encodeToolResult(frame));
  }

  runOneCall(turnId: string, call: ToolCallReq): void {
    let decision = this.approval.check(call.callId, call.tool, call.tool, call.args);
    if (!decision.allow) {
      this.history.push({ role: ROLE_TOOL, text: call.tool + ": denied", toolCallId: call.callId, toolCalls: [] });
      return;
    }

    this.emitToolCall(turnId, call);

    let result = this.tools.run(call.tool, call.args);
    this.emitToolResult(turnId, call.callId, result);
    this.history.push({ role: ROLE_TOOL, text: call.tool + ": " + result.output, toolCallId: call.callId, toolCalls: [] });
  }

  closeRemainingCalls(turnId: string, calls: ToolCallReq[], from: int): void {
    let i = from;
    while (i < calls.length) {
      this.emitToolCall(turnId, calls[i]);
      this.emitToolResult(turnId, calls[i].callId, { ok: false, output: UNREPORTED_TEXT, truncated: false });
      this.history.push(closingToolMessage(calls[i].callId, calls[i].tool));
      i = i + 1;
    }
  }

  answerCalls(turnId: string, calls: ToolCallReq[]): void {
    this.answering = true;
    let done = 0;
    while (done < calls.length) {
      if (this.cancelledTurnId == turnId) { break; }
      this.runOneCall(turnId, calls[done]);
      done = done + 1;
    }
    this.closeRemainingCalls(turnId, calls, done);
    this.answering = false;
    this.flushDeferred();
  }

  submit(text: string): string {
    let turnId = "t" + `${this.nextTurn}`;
    this.nextTurn = this.nextTurn + 1;
    this.history = repairHistory(this.history);
    this.history.push({ role: ROLE_USER, text: text, toolCallId: "", toolCalls: [] });

    let startFrame: TurnStartFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TURN_START, turnId: turnId, prompt: text };
    this.emit(encodeTurnStart(startFrame));

    let step = 0;
    let finished = false;
    let endReason = REASON_DONE;

    while (!finished) {
      if (this.cancelledTurnId == turnId) {
        endReason = REASON_CANCELLED;
        finished = true;
        continue;
      }
      if (step >= MAX_STEPS) {
        endReason = REASON_ERROR;
        finished = true;
        continue;
      }

      let reply = this.provider.ask(this.history, (chunk: string) => { this.emitDelta(turnId, chunk); });

      if (reply.failed) {
        endReason = REASON_ERROR;
        let errFrame: ErrorFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: ERROR, code: reply.errorCode, message: reply.errorMessage };
        this.emit(encodeError(errFrame));
        finished = true;
        continue;
      }

      if (reply.calls.length == 0) {
        if (reply.text != "") {
          this.history.push({ role: ROLE_ASSISTANT, text: reply.text, toolCallId: "", toolCalls: [] });
        }
        if (this.cancelledTurnId == turnId) { endReason = REASON_CANCELLED; }
        finished = true;
        continue;
      }

      let calls = namedCalls(reply.calls, this.history.length);
      this.history.push({ role: ROLE_ASSISTANT, text: reply.text, toolCallId: "", toolCalls: calls });
      this.answerCalls(turnId, calls);

      step = step + 1;
    }

    let endFrame: TurnEndFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TURN_END, turnId: turnId, reason: endReason };
    this.emit(encodeTurnEnd(endFrame));

    return turnId;
  }
}
