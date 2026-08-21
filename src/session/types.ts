export const ROLE_USER: string = "user";
export const ROLE_ASSISTANT: string = "assistant";
export const ROLE_TOOL: string = "tool";
export const ROLE_SYSTEM: string = "system";

export type ToolCallReq = { callId: string, tool: string, args: string };

export type Message = { role: string, text: string, toolCallId: string, toolCalls: ToolCallReq[] };

export type ProviderReply = { text: string, calls: ToolCallReq[], failed: bool, errorCode: string, errorMessage: string, tokens: int };

export type Provider = { ask: (history: Message[], onDelta: (text: string) => void) => ProviderReply };

export type ToolResult = { ok: bool, output: string, truncated: bool };

export type ToolRegistry = { run: (tool: string, args: string) => ToolResult };

export type ApprovalDecision = { allow: bool };

export type ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string) => ApprovalDecision };

export type Subscriber = (frameJson: string) => void;
