import { PROTOCOL_VERSION, TEXT_DELTA, TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR, frameType, decodeTurnEnd, REASON_DONE, REASON_CANCELLED, REASON_ERROR } from "../protocol/frames.ts";
import { Message, Provider, ToolRegistry, ApprovalGate, ApprovalDecision, ProviderReply, ToolResult, ROLE_SYSTEM } from "../session/types.ts";
import { Session } from "../session/session.ts";
import { BackgroundRunTask, SubagentTask } from "./state.ts";
import { TaskBoard, backgroundTurnId, agentTurnId, isTaskTurnId } from "./task_board.ts";
import { appendMailbox, findMailboxEntry } from "./mailbox.ts";
import { encodeSubagentToolCallPayload, encodeSubagentToolResultPayload, encodeSubagentApprovalPayload, encodeSubagentErrorPayload } from "./subagent_protocol.ts";

function freshPath(name: string): string {
  let p = "/tmp/task-board-test-" + name + ".log";
  fs.writeFileSync(p, "");
  return p;
}

function freshMissingPath(name: string): string {
  let p = "/tmp/task-board-test-" + name + ".flag";
  if (fs.existsSync(p)) { fs.rmSync(p, false); }
  return p;
}

function noopProvider(): Provider {
  return { ask: (h: Message[], d: (text: string) => void): ProviderReply => {
    return { text: "", calls: [], failed: false, errorCode: "", errorMessage: "" };
  } };
}

function noopTools(): ToolRegistry {
  return { run: (t: string, a: string): ToolResult => {
    return { ok: true, output: "", truncated: false };
  } };
}

function allowAll(): ApprovalGate {
  return { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    return { allow: true };
  } };
}

class FrameCapture {
  frames: string[];
  constructor() { this.frames = []; }
  add(frameJson: string): void { this.frames.push(frameJson); }
}

function freshSession(): Session {
  return new Session("/repo", "agent", noopProvider(), noopTools(), allowAll());
}

test("backgroundTurnId and agentTurnId prefix distinctly, isTaskTurnId recognizes both", () => {
  expect(backgroundTurnId("bgrun-1") == "bg:bgrun-1");
  expect(agentTurnId("agent-1") == "agent:agent-1");
  expect(isTaskTurnId("bg:bgrun-1"));
  expect(isTaskTurnId("agent:agent-1"));
  expect(!isTaskTurnId("t1"));
  expect(!isTaskTurnId(""));
});

test("freshId increments with the given prefix", () => {
  let b = new TaskBoard();
  expect(b.freshId("bgrun-") == "bgrun-1");
  expect(b.freshId("bgrun-") == "bgrun-2");
  expect(b.freshId("agent-") == "agent-3");
});

test("listText with nothing registered says so", () => {
  let b = new TaskBoard();
  expect(b.listText() == "no background tasks or subagents");
});

test("listText shows one line per registered task, running vs done", () => {
  let b = new TaskBoard();
  let rt = new BackgroundRunTask("bgrun-1", "npm test", freshPath("list-run"));
  b.registerRunTask(rt);
  let at = new SubagentTask("agent-1", "fix the bug", freshPath("list-a-out"), freshPath("list-a-in"), freshPath("list-a-cancel"), "auto-edit");
  b.registerAgentTask(at);
  let text = b.listText();
  expect(text.indexOf("bgrun-1") >= 0);
  expect(text.indexOf("running") >= 0);
  expect(text.indexOf("npm test") >= 0);
  expect(text.indexOf("agent-1") >= 0);
  expect(text.indexOf("fix the bug") >= 0);
});

test("cancel on an unknown id says so", () => {
  let b = new TaskBoard();
  expect(b.cancel("nope") == "no task or subagent with id nope");
});

test("cancel on a running background task marks it detached and writes a message", () => {
  let b = new TaskBoard();
  let rt = new BackgroundRunTask("bgrun-1", "sleep 100", freshPath("cancel-run"));
  b.registerRunTask(rt);
  let msg = b.cancel("bgrun-1");
  expect(msg.indexOf("detached") >= 0);
  expect(rt.detached);
});

test("cancel on an already-finished background task says so instead of detaching again", () => {
  let b = new TaskBoard();
  let rt = new BackgroundRunTask("bgrun-1", "echo hi", freshPath("cancel-run-done"));
  rt.done = true;
  b.registerRunTask(rt);
  let msg = b.cancel("bgrun-1");
  expect(msg.indexOf("already finished") >= 0);
});

test("cancel on a running subagent writes the cancel flag file", () => {
  let b = new TaskBoard();
  let cancelPath = freshMissingPath("cancel-agent-flag");
  let at = new SubagentTask("agent-1", "task", freshPath("cancel-agent-out"), freshPath("cancel-agent-in"), cancelPath, "auto-edit");
  b.registerAgentTask(at);
  expect(!fs.existsSync(cancelPath));
  let msg = b.cancel("agent-1");
  expect(msg.indexOf("cancellation requested") >= 0);
  expect(fs.existsSync(cancelPath));
});

test("hasPendingApproval, activeApprovalText and answerActiveApproval work FIFO across two agents", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });

  let a1 = new SubagentTask("agent-1", "task one", freshPath("fifo-a1-out"), freshPath("fifo-a1-in"), freshPath("fifo-a1-cancel"), "auto-edit");
  let a2 = new SubagentTask("agent-2", "task two", freshPath("fifo-a2-out"), freshPath("fifo-a2-in"), freshPath("fifo-a2-cancel"), "auto-edit");
  b.registerAgentTask(a1);
  b.registerAgentTask(a2);

  expect(!b.hasPendingApproval());

  b.applyAgentEntry(session, a1, "APPROVAL_REQUEST", encodeSubagentApprovalPayload({ callId: "1", tool: "run", summary: "run npm test", detail: "run npm test", args: "{}" }));
  b.applyAgentEntry(session, a2, "APPROVAL_REQUEST", encodeSubagentApprovalPayload({ callId: "1", tool: "write", summary: "write a.ts", detail: "write a.ts", args: "{}" }));

  expect(b.hasPendingApproval());
  expect(b.activeApprovalText().indexOf("agent-1") >= 0);
  expect(b.activeApprovalText().indexOf("run npm test") >= 0);

  b.answerActiveApproval("allow");
  expect(findMailboxEntry(a1.inPath, "1") == "allow");
  expect(b.activeApprovalText().indexOf("agent-2") >= 0);

  b.answerActiveApproval("deny");
  expect(findMailboxEntry(a2.inPath, "1") == "deny");
  expect(!b.hasPendingApproval());
});

test("answerActiveApproval on an empty queue is a safe no-op", () => {
  let b = new TaskBoard();
  b.answerActiveApproval("allow");
  expect(!b.hasPendingApproval());
});

test("pollRunTasks streams LINE entries as text.delta frames under the bg: turnId", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });

  let mailboxPath = freshPath("poll-run-lines");
  let rt = new BackgroundRunTask("bgrun-1", "echo hi", mailboxPath);
  b.registerRunTask(rt);

  appendMailbox(mailboxPath, "LINE", "first line");
  appendMailbox(mailboxPath, "LINE", "second line");
  b.pollRunTasks(session);

  expect(cap.frames.length == 2);
  expect(frameType(cap.frames[0]) == TEXT_DELTA);
  expect(cap.frames[0].indexOf("bg:bgrun-1") >= 0);
  expect(cap.frames[0].indexOf("first line") >= 0);
  expect(!rt.done);
  expect(rt.lineCount == 2);
});

test("pollRunTasks on DONE emits a tool.result then a turn.end and marks the task finished", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });

  let mailboxPath = freshPath("poll-run-done");
  let rt = new BackgroundRunTask("bgrun-1", "echo hi", mailboxPath);
  b.registerRunTask(rt);

  appendMailbox(mailboxPath, "LINE", "hi");
  appendMailbox(mailboxPath, "EXIT", "0");
  appendMailbox(mailboxPath, "DONE", "lines=1");
  b.pollRunTasks(session);

  expect(rt.done);
  let kinds: string[] = [];
  for (const f of cap.frames) { kinds.push(frameType(f)); }
  expect(kinds[0] == TEXT_DELTA);
  expect(kinds[1] == TOOL_RESULT);
  expect(kinds[2] == TURN_END);
  expect(cap.frames[1].indexOf("exit 0") >= 0);
});

test("pollRunTasks skips a detached task entirely, even with new output waiting", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });

  let mailboxPath = freshPath("poll-run-detached");
  let rt = new BackgroundRunTask("bgrun-1", "echo hi", mailboxPath);
  rt.detached = true;
  b.registerRunTask(rt);
  appendMailbox(mailboxPath, "LINE", "should not be seen");
  b.pollRunTasks(session);

  expect(cap.frames.length == 0);
});

test("applyAgentEntry DELTA accumulates text and emits a text.delta under the agent: turnId", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });
  let at = new SubagentTask("agent-1", "task", freshPath("apply-delta-out"), freshPath("apply-delta-in"), freshPath("apply-delta-cancel"), "auto-edit");

  b.applyAgentEntry(session, at, "DELTA", "hello ");
  b.applyAgentEntry(session, at, "DELTA", "world");

  expect(at.accumulated == "hello world");
  expect(cap.frames.length == 2);
  expect(frameType(cap.frames[1]) == TEXT_DELTA);
  expect(cap.frames[1].indexOf("agent:agent-1") >= 0);
  expect(!at.done);
});

test("applyAgentEntry TOOLCALL and TOOLRESULT decode and prefix the callId with the agent id", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });
  let at = new SubagentTask("agent-1", "task", freshPath("apply-tc-out"), freshPath("apply-tc-in"), freshPath("apply-tc-cancel"), "auto-edit");

  b.applyAgentEntry(session, at, "TOOLCALL", encodeSubagentToolCallPayload({ callId: "1", tool: "run", args: "{\"command\":\"ls\"}" }));
  b.applyAgentEntry(session, at, "TOOLRESULT", encodeSubagentToolResultPayload({ callId: "1", ok: true, output: "a.ts", truncated: false }));

  expect(cap.frames.length == 2);
  expect(frameType(cap.frames[0]) == TOOL_CALL);
  expect(cap.frames[0].indexOf("agent-1:1") >= 0);
  expect(frameType(cap.frames[1]) == TOOL_RESULT);
  expect(cap.frames[1].indexOf("agent-1:1") >= 0);
  expect(cap.frames[1].indexOf("a.ts") >= 0);
});

test("applyAgentEntry APPROVAL_REQUEST emits a card and queues a pending approval", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });
  let at = new SubagentTask("agent-1", "task", freshPath("apply-ar-out"), freshPath("apply-ar-in"), freshPath("apply-ar-cancel"), "auto-edit");

  b.applyAgentEntry(session, at, "APPROVAL_REQUEST", encodeSubagentApprovalPayload({ callId: "1", tool: "run", summary: "run rm -rf x", detail: "run rm -rf x", args: "{}" }));

  expect(frameType(cap.frames[0]) == APPROVAL_REQUEST);
  expect(cap.frames[0].indexOf("agent-1:1") >= 0);
  expect(b.hasPendingApproval());
});

test("applyAgentEntry ERROR marks the task done, emits error then turn.end, and reports into session history", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });
  let historyBefore = session.history.length;
  let at = new SubagentTask("agent-1", "the task", freshPath("apply-err-out"), freshPath("apply-err-in"), freshPath("apply-err-cancel"), "auto-edit");

  b.applyAgentEntry(session, at, "ERROR", encodeSubagentErrorPayload({ code: "E_STREAM", message: "connection reset" }));

  expect(at.done);
  expect(frameType(cap.frames[0]) == ERROR);
  let endFrame = decodeTurnEnd(cap.frames[1]);
  expect(endFrame != null);
  expect(endFrame!.reason == REASON_ERROR);
  expect(session.history.length == historyBefore + 1);
  let last = session.history[session.history.length - 1];
  expect(last.text.indexOf("agent-1") >= 0);
  expect(last.text.indexOf("connection reset") >= 0);
});

test("applyAgentEntry CANCELLED marks done, reports the partial accumulated text", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });
  let at = new SubagentTask("agent-1", "the task", freshPath("apply-cancel-out"), freshPath("apply-cancel-in"), freshPath("apply-cancel-cancel"), "auto-edit");
  at.accumulated = "partial progress so far";

  b.applyAgentEntry(session, at, "CANCELLED", "cancelled before step 2");

  expect(at.done);
  let endFrame = decodeTurnEnd(cap.frames[cap.frames.length - 1]);
  expect(endFrame!.reason == REASON_CANCELLED);
  let last = session.history[session.history.length - 1];
  expect(last.text.indexOf("partial progress so far") >= 0);
});

test("applyAgentEntry DONE marks done, reports the full accumulated text into history", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });
  let at = new SubagentTask("agent-1", "the task", freshPath("apply-done-out"), freshPath("apply-done-in"), freshPath("apply-done-cancel"), "auto-edit");
  at.accumulated = "the subagent's full final answer";

  b.applyAgentEntry(session, at, "DONE", "");

  expect(at.done);
  let endFrame = decodeTurnEnd(cap.frames[cap.frames.length - 1]);
  expect(endFrame!.reason == REASON_DONE);
  let last = session.history[session.history.length - 1];
  expect(last.text.indexOf("the subagent's full final answer") >= 0);
  expect(last.text.indexOf("the task") >= 0);
});

test("pollAgentTasks skips a task already marked done", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });
  let mailboxPath = freshPath("poll-agent-done-skip");
  let at = new SubagentTask("agent-1", "task", mailboxPath, freshPath("poll-agent-done-skip-in"), freshPath("poll-agent-done-skip-cancel"), "auto-edit");
  at.done = true;
  b.registerAgentTask(at);
  appendMailbox(mailboxPath, "DELTA", "should not be seen");

  b.pollAgentTasks(session);
  expect(cap.frames.length == 0);
});

test("poll drains both run tasks and agent tasks together", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let cap = new FrameCapture();
  session.subscribe((f: string) => { cap.add(f); });

  let runPath = freshPath("poll-both-run");
  let rt = new BackgroundRunTask("bgrun-1", "echo hi", runPath);
  b.registerRunTask(rt);
  appendMailbox(runPath, "LINE", "output line");

  let agentOut = freshPath("poll-both-agent-out");
  let at = new SubagentTask("agent-1", "task", agentOut, freshPath("poll-both-agent-in"), freshPath("poll-both-agent-cancel"), "auto-edit");
  b.registerAgentTask(at);
  appendMailbox(agentOut, "DELTA", "agent progress");

  b.poll(session);

  expect(cap.frames.length == 2);
  let turnIds: string[] = [];
  for (const f of cap.frames) {
    if (f.indexOf("bg:bgrun-1") >= 0) { turnIds.push("bg"); }
    if (f.indexOf("agent:agent-1") >= 0) { turnIds.push("agent"); }
  }
  expect(turnIds.length == 2);
});
