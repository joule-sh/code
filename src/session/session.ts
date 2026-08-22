import { PROTOCOL_VERSION, TURN_START, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, TURN_END, ERROR, REASON_DONE, REASON_CANCELLED, REASON_ERROR, TurnStartFrame, TextDeltaFrame, ToolCallFrame, ToolResultFrame, TurnEndFrame, ErrorFrame, encodeTurnStart, encodeTextDelta, encodeToolCall, encodeToolResult, encodeTurnEnd, encodeError } from "../protocol/frames.ts";
import { ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL, ROLE_SYSTEM, Message, Provider, ToolRegistry, ApprovalGate, Subscriber } from "./types.ts";

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

  injectSystemContext(text: string): void {
    if (text == "") { return; }
    this.history.push({ role: ROLE_SYSTEM, text: text, toolCallId: "", toolCalls: [] });
  }

  emitDelta(turnId: string, chunk: string): void {
    let frame: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TEXT_DELTA, turnId: turnId, text: chunk };
    this.emit(encodeTextDelta(frame));
  }

  submit(text: string): string {
    let turnId = "t" + `${this.nextTurn}`;
    this.nextTurn = this.nextTurn + 1;
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

      if (this.cancelledTurnId == turnId) {
        endReason = REASON_CANCELLED;
        finished = true;
        continue;
      }

      if (reply.failed) {
        endReason = REASON_ERROR;
        let errFrame: ErrorFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: ERROR, code: reply.errorCode, message: reply.errorMessage };
        this.emit(encodeError(errFrame));
        finished = true;
        continue;
      }

      if (reply.text != "" || reply.calls.length > 0) {
        this.history.push({ role: ROLE_ASSISTANT, text: reply.text, toolCallId: "", toolCalls: reply.calls });
      }

      if (reply.calls.length == 0) {
        finished = true;
        continue;
      }

      for (const call of reply.calls) {
        let decision = this.approval.check(call.callId, call.tool, call.tool, call.args);
        if (!decision.allow) {
          this.history.push({ role: ROLE_TOOL, text: call.tool + ": denied", toolCallId: call.callId, toolCalls: [] });
          continue;
        }

        let callFrame: ToolCallFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TOOL_CALL, turnId: turnId, callId: call.callId, tool: call.tool, args: call.args };
        this.emit(encodeToolCall(callFrame));

        let result = this.tools.run(call.tool, call.args);

        let resultFrame: ToolResultFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TOOL_RESULT, turnId: turnId, callId: call.callId, ok: result.ok, output: result.output, truncated: result.truncated };
        this.emit(encodeToolResult(resultFrame));

        this.history.push({ role: ROLE_TOOL, text: call.tool + ": " + result.output, toolCallId: call.callId, toolCalls: [] });
      }

      step = step + 1;
    }

    let endFrame: TurnEndFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TURN_END, turnId: turnId, reason: endReason };
    this.emit(encodeTurnEnd(endFrame));

    return turnId;
  }
}
