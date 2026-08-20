import { PROTOCOL_VERSION, TURN_START, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, TURN_END, REASON_DONE, TurnStartFrame, TextDeltaFrame, ToolCallFrame, ToolResultFrame, TurnEndFrame, encodeTurnStart, encodeTextDelta, encodeToolCall, encodeToolResult, encodeTurnEnd } from "../protocol/frames.ts";

export function fixtureScript(): string[] {
  let out: string[] = [];

  let start: TurnStartFrame = { v: PROTOCOL_VERSION, seq: 1, type: TURN_START, turnId: "t1", prompt: "add a health endpoint and a test for it" };
  out.push(encodeTurnStart(start));

  let delta: TextDeltaFrame = { v: PROTOCOL_VERSION, seq: 2, type: TEXT_DELTA, turnId: "t1", text: "No health route yet. I'll add GET /health and a test for it." };
  out.push(encodeTextDelta(delta));

  let write: ToolCallFrame = { v: PROTOCOL_VERSION, seq: 3, type: TOOL_CALL, turnId: "t1", callId: "c1", tool: "write", args: "src/routes/health.ts" };
  out.push(encodeToolCall(write));

  let writeResult: ToolResultFrame = { v: PROTOCOL_VERSION, seq: 4, type: TOOL_RESULT, turnId: "t1", callId: "c1", ok: true, output: "wrote 12 lines", truncated: false };
  out.push(encodeToolResult(writeResult));

  let run: ToolCallFrame = { v: PROTOCOL_VERSION, seq: 5, type: TOOL_CALL, turnId: "t1", callId: "c2", tool: "run", args: "npm test" };
  out.push(encodeToolCall(run));

  let runResult: ToolResultFrame = { v: PROTOCOL_VERSION, seq: 6, type: TOOL_RESULT, turnId: "t1", callId: "c2", ok: true, output: "2 passed, 0 failed", truncated: false };
  out.push(encodeToolResult(runResult));

  let end: TurnEndFrame = { v: PROTOCOL_VERSION, seq: 7, type: TURN_END, turnId: "t1", reason: REASON_DONE };
  out.push(encodeTurnEnd(end));

  return out;
}
