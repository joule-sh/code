import { TOOL_CALL, TOOL_RESULT, frameType } from "../protocol/frames.ts";
import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL, Message, ProviderReply, ToolCallReq, Provider, ToolRegistry, ToolResult, ApprovalGate, ApprovalDecision } from "./types.ts";
import { Session } from "./session.ts";
import { UNREPORTED_TEXT, contractProblem } from "./history_guard.ts";

function okReply(text: string, calls: ToolCallReq[]): ProviderReply {
  return { text: text, calls: calls, failed: false, errorCode: "", errorMessage: "", tokens: 0 };
}

function call(id: string, tool: string): ToolCallReq {
  return { callId: id, tool: tool, args: "{}" };
}

class Seen {
  problems: string[];
  asks: int;
  replies: ProviderReply[];
  constructor(replies: ProviderReply[]) {
    this.problems = [];
    this.asks = 0;
    this.replies = replies;
  }
  ask(history: Message[], onDelta: (text: string) => void): ProviderReply {
    this.problems.push(contractProblem(history));
    let idx = this.asks;
    if (idx >= this.replies.length) { idx = this.replies.length - 1; }
    this.asks = this.asks + 1;
    return this.replies[idx];
  }
  worstProblem(): string {
    for (const p of this.problems) {
      if (p != "") { return p; }
    }
    return "";
  }
}

class Echoer {
  run(tool: string, args: string): ToolResult {
    return { ok: true, output: tool + " ran", truncated: false };
  }
}

class FrameCapture {
  frames: string[];
  constructor() { this.frames = []; }
  add(f: string): void { this.frames.push(f); }
  countOf(kind: string, callId: string): int {
    let n = 0;
    for (const f of this.frames) {
      if (frameType(f) == kind && jsonStringMemberAt(f, 0, "callId") == callId) { n = n + 1; }
    }
    return n;
  }
}

function allowAll(): ApprovalGate {
  return { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    return { allow: true };
  } };
}

function newSession(seen: Seen, tools: ToolRegistry): Session {
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => seen.ask(h, d) };
  return new Session("/repo", "agent", provider, tools, allowAll());
}

function echoTools(): ToolRegistry {
  let echoer = new Echoer();
  return { run: (t: string, a: string) => echoer.run(t, a) };
}

function noteCount(history: Message[], needle: string): int {
  let n = 0;
  for (const m of history) {
    if (m.role == ROLE_USER && m.text.indexOf(needle) >= 0) { n = n + 1; }
  }
  return n;
}

test("a background task that finishes while an approval is pending does not wedge its note into the tool block", () => {
  let seen = new Seen([okReply("checking", [call("c1", "run")]), okReply("done", [])]);
  let session = newSession(seen, echoTools());
  session.approval = { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    session.note("[background task bgrun-1 (serve) finished: exit 1, 0 lines]");
    return { allow: true };
  } };

  session.submit("start a server and check it");

  expect(seen.worstProblem() == "");
  expect(contractProblem(session.history) == "");
  expect(noteCount(session.history, "bgrun-1") == 1);
});

test("the deferred note lands after the tool block, not before it, so nothing is lost", () => {
  let seen = new Seen([okReply("checking", [call("c1", "run")]), okReply("done", [])]);
  let session = newSession(seen, echoTools());
  session.approval = { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    session.note("[background task bgrun-1 finished]");
    return { allow: true };
  } };
  session.submit("go");

  let toolAt = -1;
  let noteAt = -1;
  let i = 0;
  while (i < session.history.length) {
    if (session.history[i].role == ROLE_TOOL && session.history[i].toolCallId == "c1") { toolAt = i; }
    if (session.history[i].text.indexOf("bgrun-1") >= 0) { noteAt = i; }
    i = i + 1;
  }
  expect(toolAt > 0);
  expect(noteAt > toolAt);
});

test("a system briefing injected while an approval is pending waits for the tool block to close", () => {
  let seen = new Seen([okReply("checking", [call("c1", "run")]), okReply("done", [])]);
  let session = newSession(seen, echoTools());
  session.approval = { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    session.injectSystemContext("you are now in plan mode");
    return { allow: true };
  } };
  session.submit("go");

  expect(seen.worstProblem() == "");
  expect(contractProblem(session.history) == "");
});

test("a turn cancelled between a tool call and its result closes the call rather than leaving it open", () => {
  let seen = new Seen([okReply("two things", [call("c1", "run"), call("c2", "run")]), okReply("done", [])]);
  let session = newSession(seen, echoTools());
  session.approval = { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    if (callId == "c1") { session.cancel("t1"); }
    return { allow: true };
  } };

  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });
  session.submit("go");

  expect(contractProblem(session.history) == "");
  expect(cap.countOf(TOOL_RESULT, "c2") == 1);
  expect(cap.countOf(TOOL_CALL, "c2") == 1);
  let closed = false;
  for (const m of session.history) {
    if (m.toolCallId == "c2" && m.text.indexOf(UNREPORTED_TEXT) > 0) { closed = true; }
  }
  expect(closed);
});

test("a tool whose result is an error with no output still answers its call", () => {
  let seen = new Seen([okReply("running", [call("c1", "run")]), okReply("done", [])]);
  let tools: ToolRegistry = { run: (t: string, a: string): ToolResult => {
    return { ok: false, output: "", truncated: false };
  } };
  let session = newSession(seen, tools);
  session.submit("go");

  expect(contractProblem(session.history) == "");
  expect(seen.worstProblem() == "");
  let answeredIt = false;
  for (const m of session.history) {
    if (m.role == ROLE_TOOL && m.toolCallId == "c1") { answeredIt = true; }
  }
  expect(answeredIt);
});

test("a session resumed onto a history that already carries a dangling call repairs it on the next turn", () => {
  let seen = new Seen([okReply("fine now", [])]);
  let session = newSession(seen, echoTools());

  session.history.push({ role: ROLE_USER, text: "check the server", toolCallId: "", toolCalls: [] });
  session.history.push({ role: ROLE_ASSISTANT, text: "let me verify", toolCallId: "", toolCalls: [call("dead", "run")] });
  expect(contractProblem(session.history) != "");

  session.submit("are you there");
  expect(seen.worstProblem() == "");
  expect(contractProblem(session.history) == "");

  let kept = false;
  for (const m of session.history) {
    if (m.role == ROLE_ASSISTANT && m.text == "let me verify") { kept = true; }
  }
  expect(kept);
});

test("every turn after a repair keeps working, so one interrupted turn does not kill the session", () => {
  let seen = new Seen([okReply("ok", [])]);
  let session = newSession(seen, echoTools());
  session.history.push({ role: ROLE_ASSISTANT, text: "gone", toolCallId: "", toolCalls: [call("dead", "run")] });

  session.submit("one");
  session.submit("two");
  session.submit("three");
  expect(seen.asks == 3);
  expect(seen.worstProblem() == "");
});
