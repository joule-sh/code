import { PROTOCOL_VERSION, TURN_START, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, TURN_END, ERROR, REASON_DONE, REASON_CANCELLED, REASON_ERROR, frameType, frameSeq } from "../protocol/frames.ts";
import { Message, ProviderReply, ToolCallReq, Provider, ToolRegistry, ApprovalGate, ToolResult, ApprovalDecision, ROLE_SYSTEM } from "./types.ts";
import { Session, SYSTEM_PROMPT } from "./session.ts";

function okReply(text: string, calls: ToolCallReq[]): ProviderReply {
  return { text: text, calls: calls, failed: false, errorCode: "", errorMessage: "", tokens: 0 };
}

function failReply(code: string, message: string): ProviderReply {
  return { text: "", calls: [], failed: true, errorCode: code, errorMessage: message, tokens: 0 };
}

class StepProvider {
  callCount: int;
  lastIdx: int;
  replies: ProviderReply[];
  constructor(replies: ProviderReply[]) {
    this.callCount = 0;
    this.lastIdx = replies.length - 1;
    this.replies = replies;
  }
  ask(history: Message[], onDelta: (text: string) => void): ProviderReply {
    let idx = this.callCount;
    if (idx > this.lastIdx) {
      idx = this.lastIdx;
    }
    let r = this.replies[idx];
    if (this.callCount < this.lastIdx) {
      this.callCount = this.callCount + 1;
    }
    onDelta(r.text);
    return r;
  }
}

class Echoer {
  calls: int;
  constructor() { this.calls = 0; }
  run(tool: string, args: string): ToolResult {
    this.calls = this.calls + 1;
    let r: ToolResult = { ok: true, output: tool + " ran with " + args, truncated: false };
    return r;
  }
}

class FrameCapture {
  frames: string[];
  constructor() { this.frames = []; }
  add(frameJson: string): void { this.frames.push(frameJson); }
}

function allowAll(): ApprovalGate {
  return { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    let d: ApprovalDecision = { allow: true };
    return d;
  } };
}

function typesOf(frames: string[]): string[] {
  let out: string[] = [];
  for (const f of frames) {
    out.push(frameType(f));
  }
  return out;
}

test("a new session's history starts with exactly one system message", () => {
  let sp = new StepProvider([okReply("hi there", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let session = new Session("/repo", "agent", provider, tools, allowAll());

  expect(session.history.length == 1);
  expect(session.history[0].role == ROLE_SYSTEM);
  expect(session.history[0].text == SYSTEM_PROMPT);
});

test("the system message is not duplicated across multiple turns", () => {
  let sp = new StepProvider([okReply("first", []), okReply("second", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let session = new Session("/repo", "agent", provider, tools, allowAll());

  session.submit("hello");
  session.submit("hello again");

  let systemCount = 0;
  for (const m of session.history) {
    if (m.role == ROLE_SYSTEM) {
      systemCount = systemCount + 1;
    }
  }
  expect(systemCount == 1);
  expect(session.history[0].role == ROLE_SYSTEM);
});

test("injectSystemContext appends a second system message right after the base prompt", () => {
  let sp = new StepProvider([okReply("hi", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let session = new Session("/repo", "agent", provider, tools, allowAll());

  session.injectSystemContext("project instructions: build with make build");

  expect(session.history.length == 2);
  expect(session.history[0].text == SYSTEM_PROMPT);
  expect(session.history[1].role == ROLE_SYSTEM);
  expect(session.history[1].text == "project instructions: build with make build");
});

test("injectSystemContext called twice keeps project instructions ahead of user memory, both ahead of the conversation", () => {
  let sp = new StepProvider([okReply("hi", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let session = new Session("/repo", "agent", provider, tools, allowAll());

  session.injectSystemContext("project instructions here");
  session.injectSystemContext("user memory here");
  session.submit("hello");

  expect(session.history[0].text == SYSTEM_PROMPT);
  expect(session.history[1].text == "project instructions here");
  expect(session.history[2].text == "user memory here");
  expect(session.history[3].role == "user");
});

test("injectSystemContext is silent (a no-op) when given empty text, matching an absent JOULE.md or empty memory", () => {
  let sp = new StepProvider([okReply("hi", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let session = new Session("/repo", "agent", provider, tools, allowAll());

  session.injectSystemContext("");

  expect(session.history.length == 1);
});

test("a plain answer: turn.start, text.delta, turn.end done", () => {
  let sp = new StepProvider([okReply("hi there", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let cap = new FrameCapture();
  let session = new Session("/repo", "agent", provider, tools, allowAll());
  session.subscribe((frameJson: string) => { cap.add(frameJson); });
  session.submit("hello");

  let kinds = typesOf(cap.frames);
  expect(kinds.length == 3);
  expect(kinds[0] == TURN_START);
  expect(kinds[1] == TEXT_DELTA);
  expect(kinds[2] == TURN_END);

  expect(session.history.length == 3);
  expect(session.history[0].role == ROLE_SYSTEM);
  expect(session.history[1].role == "user");
  expect(session.history[2].role == "assistant");
  expect(session.history[2].text == "hi there");
});

test("one tool call then an answer", () => {
  let calls: ToolCallReq[] = [{ callId: "c1", tool: "read_file", args: "a.ts" }];
  let sp = new StepProvider([okReply("", calls), okReply("done reading", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let cap = new FrameCapture();
  let session = new Session("/repo", "agent", provider, tools, allowAll());
  session.subscribe((frameJson: string) => { cap.add(frameJson); });
  session.submit("read a.ts");

  let kinds = typesOf(cap.frames);
  expect(kinds[0] == TURN_START);
  expect(kinds[kinds.length - 1] == TURN_END);
  let hasCall = false;
  let hasResult = false;
  for (const k of kinds) {
    if (k == TOOL_CALL) { hasCall = true; }
    if (k == TOOL_RESULT) { hasResult = true; }
  }
  expect(hasCall);
  expect(hasResult);

  expect(session.history.length == 5);
  expect(session.history[0].role == ROLE_SYSTEM);
  expect(session.history[1].role == "user");
  expect(session.history[2].role == "assistant");
  expect(session.history[3].role == "tool");
  expect(session.history[4].role == "assistant");
});

test("two sequential tool calls before the answer", () => {
  let c1: ToolCallReq[] = [{ callId: "c1", tool: "read_file", args: "a.ts" }];
  let c2: ToolCallReq[] = [{ callId: "c2", tool: "read_file", args: "b.ts" }];
  let sp = new StepProvider([okReply("", c1), okReply("", c2), okReply("both read", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let cap = new FrameCapture();
  let session = new Session("/repo", "agent", provider, tools, allowAll());
  session.subscribe((frameJson: string) => { cap.add(frameJson); });
  session.submit("read both");

  let kinds = typesOf(cap.frames);
  let callCount = 0;
  for (const k of kinds) {
    if (k == TOOL_CALL) { callCount = callCount + 1; }
  }
  expect(callCount == 2);
  expect(kinds[kinds.length - 1] == TURN_END);
  expect(session.history.length == 7);
});

test("the step cap ends the turn with error, not an infinite loop", () => {
  let calls: ToolCallReq[] = [{ callId: "c1", tool: "loop_tool", args: "" }];
  let sp = new StepProvider([okReply("", calls)]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let cap = new FrameCapture();
  let session = new Session("/repo", "agent", provider, tools, allowAll());
  session.subscribe((frameJson: string) => { cap.add(frameJson); });
  session.submit("go forever");

  let kinds = typesOf(cap.frames);
  expect(kinds[kinds.length - 1] == TURN_END);
});

test("cancel set for the upcoming turn ends it immediately, never calling the provider", () => {
  let sp = new StepProvider([okReply("should never be seen", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let cap = new FrameCapture();
  let session = new Session("/repo", "agent", provider, tools, allowAll());
  session.subscribe((frameJson: string) => { cap.add(frameJson); });
  session.cancel("t1");
  session.submit("hello");

  let kinds = typesOf(cap.frames);
  expect(kinds.length == 2);
  expect(kinds[0] == TURN_START);
  expect(kinds[1] == TURN_END);
  expect(sp.callCount == 0);
});

class MidStreamCanceller {
  sessionSlot: Session[];
  constructor() {
    this.sessionSlot = [];
  }
  setSession(s: Session): void {
    this.sessionSlot = [s];
  }
  ask(history: Message[], onDelta: (text: string) => void): ProviderReply {
    onDelta("partial");
    if (this.sessionSlot.length > 0) {
      this.sessionSlot[0].cancel("t1");
    }
    return okReply("partial", []);
  }
}

test("cancel requested mid-stream still ends the turn as cancelled, not done", () => {
  let canceller = new MidStreamCanceller();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => canceller.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let cap = new FrameCapture();
  let session = new Session("/repo", "agent", provider, tools, allowAll());
  canceller.setSession(session);
  session.subscribe((frameJson: string) => { cap.add(frameJson); });
  session.submit("hello");

  let kinds = typesOf(cap.frames);
  expect(kinds[kinds.length - 1] == TURN_END);
  let last = cap.frames[cap.frames.length - 1];
  expect(last.indexOf("cancelled") >= 0);
});

test("a provider error ends the turn with error, and does not throw", () => {
  let sp = new StepProvider([failReply("E_TIMEOUT", "the provider timed out")]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let cap = new FrameCapture();
  let session = new Session("/repo", "agent", provider, tools, allowAll());
  session.subscribe((frameJson: string) => { cap.add(frameJson); });
  session.submit("hello");

  let kinds = typesOf(cap.frames);
  let hasError = false;
  for (const k of kinds) {
    if (k == ERROR) { hasError = true; }
  }
  expect(hasError);
  expect(kinds[kinds.length - 1] == TURN_END);
});

test("a denied tool call is recorded in history but not run", () => {
  let calls: ToolCallReq[] = [{ callId: "c1", tool: "run_shell", args: "rm -rf /" }];
  let denyAll: ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    let d: ApprovalDecision = { allow: false };
    return d;
  } };
  let sp = new StepProvider([okReply("", calls), okReply("stopped", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let cap = new FrameCapture();
  let session = new Session("/repo", "agent", provider, tools, denyAll);
  session.subscribe((frameJson: string) => { cap.add(frameJson); });
  session.submit("delete everything");

  let kinds = typesOf(cap.frames);
  let hasCall = false;
  for (const k of kinds) {
    if (k == TOOL_CALL) { hasCall = true; }
  }
  expect(!hasCall);
  expect(session.history[3].text.indexOf("denied") >= 0);
});

test("seq is monotonic across a whole turn", () => {
  let calls: ToolCallReq[] = [{ callId: "c1", tool: "read_file", args: "a.ts" }];
  let sp = new StepProvider([okReply("", calls), okReply("done", [])]);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => sp.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  let cap = new FrameCapture();
  let session = new Session("/repo", "agent", provider, tools, allowAll());
  session.subscribe((frameJson: string) => { cap.add(frameJson); });
  session.submit("read a.ts");

  let last = 0;
  for (const f of cap.frames) {
    let s = frameSeq(f);
    expect(s > last);
    last = s;
  }
});
