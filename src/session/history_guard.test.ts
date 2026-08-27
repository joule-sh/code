import { ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL, ROLE_SYSTEM, Message, ToolCallReq } from "./types.ts";
import { UNREPORTED_TEXT, CONTRACT_MESSAGE, namedCalls, closingToolMessage, contractProblem, repairHistory } from "./history_guard.ts";

function said(role: string, text: string): Message {
  return { role: role, text: text, toolCallId: "", toolCalls: [] };
}

function asked(text: string, calls: ToolCallReq[]): Message {
  return { role: ROLE_ASSISTANT, text: text, toolCallId: "", toolCalls: calls };
}

function answered(callId: string, text: string): Message {
  return { role: ROLE_TOOL, text: text, toolCallId: callId, toolCalls: [] };
}

function call(id: string, tool: string): ToolCallReq {
  return { callId: id, tool: tool, args: "{}" };
}

test("a history whose every tool call is answered satisfies the contract", () => {
  let h: Message[] = [
    said(ROLE_SYSTEM, "prompt"),
    said(ROLE_USER, "start a server"),
    asked("", [call("c1", "run")]),
    answered("c1", "run: exit 0"),
    said(ROLE_ASSISTANT, "started"),
  ];
  expect(contractProblem(h) == "");
  expect(repairHistory(h).length == h.length);
});

test("an assistant message whose tool call is never answered is what the provider refuses", () => {
  let h: Message[] = [
    said(ROLE_USER, "check it"),
    asked("let me verify", [call("c1", "run")]),
  ];
  expect(contractProblem(h) == CONTRACT_MESSAGE);
});

test("a background task note landing inside the tool block is the same refusal, with no interruption anywhere", () => {
  let h: Message[] = [
    said(ROLE_USER, "check it"),
    asked("let me verify", [call("c1", "run")]),
    said(ROLE_USER, "[background task bgrun-1 (serve) finished: exit 1, 0 lines]"),
    answered("c1", "run: exit 0"),
  ];
  expect(contractProblem(h) != "");
});

test("repair moves the interleaved note past the tool block instead of dropping it", () => {
  let note = "[background task bgrun-1 (serve) finished: exit 1, 0 lines]";
  let h: Message[] = [
    said(ROLE_USER, "check it"),
    asked("let me verify", [call("c1", "run")]),
    said(ROLE_USER, note),
    answered("c1", "run: exit 0"),
  ];
  let fixed = repairHistory(h);
  expect(contractProblem(fixed) == "");
  expect(fixed.length == 4);
  expect(fixed[2].role == ROLE_TOOL);
  expect(fixed[2].toolCallId == "c1");
  expect(fixed[3].role == ROLE_USER);
  expect(fixed[3].text == note);
});

test("repair closes an unanswered call rather than dropping the turn that made it", () => {
  let h: Message[] = [
    said(ROLE_USER, "check it"),
    asked("let me verify", [call("c1", "run")]),
  ];
  let fixed = repairHistory(h);
  expect(contractProblem(fixed) == "");
  expect(fixed.length == 3);
  expect(fixed[1].role == ROLE_ASSISTANT);
  expect(fixed[1].text == "let me verify");
  expect(fixed[2].role == ROLE_TOOL);
  expect(fixed[2].toolCallId == "c1");
  expect(fixed[2].text.indexOf(UNREPORTED_TEXT) > 0);
});

test("repair closes only the calls that went unanswered, keeping the ones that landed", () => {
  let h: Message[] = [
    asked("", [call("c1", "run"), call("c2", "read")]),
    answered("c1", "run: exit 0"),
  ];
  let fixed = repairHistory(h);
  expect(contractProblem(fixed) == "");
  expect(fixed.length == 3);
  expect(fixed[1].text == "run: exit 0");
  expect(fixed[2].toolCallId == "c2");
  expect(fixed[2].text.indexOf(UNREPORTED_TEXT) > 0);
});

test("repair is idempotent, so a session repaired every turn does not grow closers", () => {
  let h: Message[] = [said(ROLE_USER, "go"), asked("", [call("c1", "run")])];
  let once = repairHistory(h);
  let twice = repairHistory(once);
  expect(twice.length == once.length);
  expect(contractProblem(twice) == "");
});

test("a tool message answering nothing is dropped rather than sent on", () => {
  let h: Message[] = [said(ROLE_USER, "go"), answered("ghost", "run: exit 0")];
  expect(contractProblem(h) != "");
  let fixed = repairHistory(h);
  expect(contractProblem(fixed) == "");
  expect(fixed.length == 1);
});

test("a call the stream never named gets an id, so its answer can be matched to it", () => {
  let calls = namedCalls([call("", "run"), call("c2", "read")], 7);
  expect(calls[0].callId != "");
  expect(calls[0].callId != calls[1].callId);
  expect(calls[1].callId == "c2");
});

test("repair names an unnamed call on both sides, because a tool message with no id answers nothing", () => {
  let h: Message[] = [asked("", [call("", "run")]), answered("", "run: exit 0")];
  let fixed = repairHistory(h);
  expect(contractProblem(fixed) == "");
  expect(fixed[0].toolCalls[0].callId != "");
  expect(fixed[1].toolCallId == fixed[0].toolCalls[0].callId);
  expect(fixed[1].text == "run: exit 0");
});

test("a closing message names the tool, so the record says which call never reported", () => {
  let m = closingToolMessage("c1", "run");
  expect(m.role == ROLE_TOOL);
  expect(m.toolCallId == "c1");
  expect(m.text.indexOf("run") == 0);
});

test("two assistant turns in a row each keep their own block", () => {
  let h: Message[] = [
    asked("first", [call("c1", "run")]),
    asked("second", [call("c2", "run")]),
    answered("c2", "run: exit 0"),
  ];
  let fixed = repairHistory(h);
  expect(contractProblem(fixed) == "");
  expect(fixed.length == 4);
  expect(fixed[1].toolCallId == "c1");
  expect(fixed[1].text.indexOf(UNREPORTED_TEXT) > 0);
  expect(fixed[3].text == "run: exit 0");
});
