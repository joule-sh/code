import { ROLE_ASSISTANT, ROLE_TOOL, Message, ToolCallReq } from "./types.ts";

export const UNREPORTED_TEXT: string = "did not complete - the turn ended before this call reported a result";

export const CONTRACT_MESSAGE: string = "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)";

export const ORPHAN_MESSAGE: string = "A tool message must answer a 'tool_call_id' from the assistant message before it. (tool message with no preceding tool_calls)";

function held(s: string): string {
  return "" + s;
}

function recoveredCallId(at: int, index: int): string {
  return "call_unnamed_" + `${at}` + "_" + `${index}`;
}

function indexOfString(list: string[], want: string): int {
  let i = 0;
  while (i < list.length) {
    if (list[i] == want) { return i; }
    i = i + 1;
  }
  return -1;
}

export function namedCalls(calls: ToolCallReq[], at: int): ToolCallReq[] {
  let out: ToolCallReq[] = [];
  let i = 0;
  while (i < calls.length) {
    let id = held(calls[i].callId);
    if (id == "") { id = recoveredCallId(at, i); }
    out.push({ callId: id, tool: held(calls[i].tool), args: held(calls[i].args) });
    i = i + 1;
  }
  return out;
}

export function closingToolMessage(callId: string, tool: string): Message {
  return { role: ROLE_TOOL, text: tool + ": " + UNREPORTED_TEXT, toolCallId: held(callId), toolCalls: [] };
}

function answersOneOf(calls: ToolCallReq[], answered: string[], toolCallId: string): string {
  if (toolCallId == "") {
    if (answered.length >= calls.length) { return ""; }
    return calls[answered.length].callId;
  }
  let i = 0;
  while (i < calls.length) {
    if (calls[i].callId == toolCallId && indexOfString(answered, toolCallId) < 0) {
      return calls[i].callId;
    }
    i = i + 1;
  }
  return "";
}

export function contractProblem(history: Message[]): string {
  let i = 0;
  while (i < history.length) {
    let m = history[i];
    if (m.role == ROLE_TOOL) { return ORPHAN_MESSAGE; }
    if (m.role != ROLE_ASSISTANT || m.toolCalls.length == 0) {
      i = i + 1;
      continue;
    }
    let answered: string[] = [];
    let j = i + 1;
    while (j < history.length && answered.length < m.toolCalls.length) {
      if (history[j].role != ROLE_TOOL) { break; }
      let hit = answersOneOf(m.toolCalls, answered, history[j].toolCallId);
      if (hit == "") { return CONTRACT_MESSAGE; }
      answered.push(hit);
      j = j + 1;
    }
    if (answered.length < m.toolCalls.length) { return CONTRACT_MESSAGE; }
    i = j;
  }
  return "";
}

export function repairHistory(history: Message[]): Message[] {
  let out: Message[] = [];
  let i = 0;
  while (i < history.length) {
    let m = history[i];
    if (m.role == ROLE_TOOL) { i = i + 1; continue; }
    if (m.role != ROLE_ASSISTANT || m.toolCalls.length == 0) {
      out.push(m);
      i = i + 1;
      continue;
    }

    let calls = namedCalls(m.toolCalls, i);
    out.push({ role: m.role, text: m.text, toolCallId: "", toolCalls: calls });

    let answered: string[] = [];
    let carried: Message[] = [];
    let j = i + 1;
    while (j < history.length && answered.length < calls.length) {
      let n = history[j];
      if (n.role == ROLE_ASSISTANT) { break; }
      if (n.role == ROLE_TOOL) {
        let hit = answersOneOf(calls, answered, n.toolCallId);
        if (hit != "") {
          out.push({ role: ROLE_TOOL, text: n.text, toolCallId: hit, toolCalls: [] });
          answered.push(hit);
        }
        j = j + 1;
        continue;
      }
      carried.push(n);
      j = j + 1;
    }

    let k = 0;
    while (k < calls.length) {
      if (indexOfString(answered, calls[k].callId) < 0) {
        out.push(closingToolMessage(calls[k].callId, calls[k].tool));
      }
      k = k + 1;
    }
    for (const c of carried) { out.push(c); }
    i = j;
  }
  return out;
}
