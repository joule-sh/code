import { Message, ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL, ROLE_SYSTEM } from "../session/types.ts";
import { hasContinueFlag, renderResumedTranscript, decideResume } from "./resume.ts";

function history(): Message[] {
  let msgs: Message[] = [
    { role: ROLE_SYSTEM, text: "sys prompt", toolCallId: "", toolCalls: [] },
    { role: ROLE_USER, text: "read a.ts", toolCallId: "", toolCalls: [] },
    { role: ROLE_ASSISTANT, text: "", toolCallId: "", toolCalls: [{ callId: "c1", tool: "read", args: "a.ts" }] },
    { role: ROLE_TOOL, text: "read: contents of a.ts", toolCallId: "c1", toolCalls: [] },
    { role: ROLE_ASSISTANT, text: "done reading", toolCallId: "", toolCalls: [] },
  ];
  return msgs;
}

test("hasContinueFlag finds --continue among other args", () => {
  expect(hasContinueFlag(["prog", "--continue"]));
  expect(hasContinueFlag(["prog", "foo", "--continue"]));
});

test("hasContinueFlag is false when the flag is absent", () => {
  expect(!hasContinueFlag(["prog"]));
  expect(!hasContinueFlag(["prog", "foo"]));
});

test("renderResumedTranscript skips the system message", () => {
  let out = renderResumedTranscript(history());
  expect(out.indexOf("sys prompt") < 0);
});

test("renderResumedTranscript shows user and assistant text", () => {
  let out = renderResumedTranscript(history());
  expect(out.indexOf("read a.ts") >= 0);
  expect(out.indexOf("done reading") >= 0);
});

test("renderResumedTranscript summarizes a tool-call-only assistant turn instead of showing empty text", () => {
  let out = renderResumedTranscript(history());
  expect(out.indexOf("requested 1 tool call") >= 0);
});

test("renderResumedTranscript shows a compact line for tool results", () => {
  let out = renderResumedTranscript(history());
  expect(out.indexOf("contents of a.ts") >= 0);
});

test("renderResumedTranscript's header counts only non-system messages", () => {
  let out = renderResumedTranscript(history());
  expect(out.indexOf("4 messages") >= 0);
});

test("decideResume without --continue returns no history and no note", () => {
  let empty: Message[] = [];
  let outcome = decideResume(false, false, empty);
  expect(outcome.history == null);
  expect(outcome.note == "");
});

test("decideResume with --continue but no saved file returns no history and a note", () => {
  let empty: Message[] = [];
  let outcome = decideResume(true, false, empty);
  expect(outcome.history == null);
  expect(outcome.note.indexOf("no previous session") >= 0);
});

test("decideResume with --continue but an empty saved history behaves like no file", () => {
  let empty: Message[] = [];
  let outcome = decideResume(true, true, empty);
  expect(outcome.history == null);
  expect(outcome.note.indexOf("no previous session") >= 0);
});

test("decideResume with --continue and a real saved file returns the history and a transcript note", () => {
  let outcome = decideResume(true, true, history());
  expect(outcome.history != null);
  if (outcome.history != null) {
    expect(outcome.history.length == 5);
  }
  expect(outcome.note.indexOf("resumed previous session") >= 0);
});
