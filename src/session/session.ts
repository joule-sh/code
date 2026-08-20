import { PROTOCOL_VERSION, TURN_START, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, TURN_END, ERROR, REASON_DONE, REASON_CANCELLED, REASON_ERROR, TurnStartFrame, TextDeltaFrame, ToolCallFrame, ToolResultFrame, TurnEndFrame, ErrorFrame, encodeTurnStart, encodeTextDelta, encodeToolCall, encodeToolResult, encodeTurnEnd, encodeError } from "../protocol/frames.ts";
import { ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL, Message, Provider, ToolRegistry, ApprovalGate, Subscriber } from "./types.ts";

const MAX_STEPS: int = 8;

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

  historyText(): string {
    let out = "";
    for (const m of this.history) {
      out = out + m.role + ": " + m.text + "\n";
    }
    return out;
  }

  emitDelta(turnId: string, chunk: string): void {
    let frame: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TEXT_DELTA, turnId: turnId, text: chunk };
    this.emit(encodeTextDelta(frame));
  }

  submit(text: string): string {
    let turnId = "t" + `${this.nextTurn}`;
    this.nextTurn = this.nextTurn + 1;
    this.history.push({ role: ROLE_USER, text: text });

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

      let reply = this.provider.ask(this.historyText(), (chunk: string) => { this.emitDelta(turnId, chunk); });

      if (reply.failed) {
        endReason = REASON_ERROR;
        let errFrame: ErrorFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: ERROR, code: reply.errorCode, message: reply.errorMessage };
        this.emit(encodeError(errFrame));
        finished = true;
        continue;
      }

      if (reply.text != "") {
        this.history.push({ role: ROLE_ASSISTANT, text: reply.text });
      }

      if (reply.calls.length == 0) {
        finished = true;
        continue;
      }

      for (const call of reply.calls) {
        let decision = this.approval.check(call.tool, call.tool + " " + call.args);
        if (!decision.allow) {
          this.history.push({ role: ROLE_TOOL, text: call.tool + ": denied" });
          continue;
        }

        let callFrame: ToolCallFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TOOL_CALL, turnId: turnId, callId: call.callId, tool: call.tool, args: call.args };
        this.emit(encodeToolCall(callFrame));

        let result = this.tools.run(call.tool, call.args);

        let resultFrame: ToolResultFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TOOL_RESULT, turnId: turnId, callId: call.callId, ok: result.ok, output: result.output, truncated: result.truncated };
        this.emit(encodeToolResult(resultFrame));

        this.history.push({ role: ROLE_TOOL, text: call.tool + ": " + result.output });
      }

      step = step + 1;
    }

    let endFrame: TurnEndFrame = { v: PROTOCOL_VERSION, seq: this.takeSeq(), type: TURN_END, turnId: turnId, reason: endReason };
    this.emit(encodeTurnEnd(endFrame));

    return turnId;
  }
}
