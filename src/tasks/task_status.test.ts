import { Message, Provider, ToolRegistry, ApprovalGate, ApprovalDecision, ProviderReply, ToolResult, ROLE_USER } from "../session/types.ts";
import { Session } from "../session/session.ts";
import { BackgroundRunTask, SubagentTask } from "./state.ts";
import { TaskBoard } from "./task_board.ts";
import { appendMailbox } from "./mailbox.ts";
import { buildRunTaskStatus, buildAgentTaskStatus, MAX_STATUS_OUTPUT_LINES } from "./task_status.ts";

function freshPath(name: string): string {
  let p = "/tmp/task-status-test-" + name + ".log";
  fs.writeFileSync(p, "");
  return p;
}

function noopProvider(): Provider {
  return { ask: (h: Message[], d: (text: string) => void): ProviderReply => {
    return { text: "", calls: [], failed: false, errorCode: "", errorMessage: "", tokens: 0 };
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

function freshSession(): Session {
  return new Session("/repo", "agent", noopProvider(), noopTools(), allowAll());
}

function containsExact(lines: string[], needle: string): bool {
  for (const line of lines) {
    if (line == needle) { return true; }
  }
  return false;
}

test("buildRunTaskStatus reports running with recent output for a task still in progress", () => {
  let p = freshPath("running");
  let rt = new BackgroundRunTask("bgrun-1", "npm run dev", p);
  appendMailbox(p, "LINE", "compiling...");
  appendMailbox(p, "LINE", "ready on port 3000");
  let text = buildRunTaskStatus(rt);
  expect(text.indexOf("bgrun-1") >= 0);
  expect(text.indexOf("running") >= 0);
  expect(text.indexOf("compiling...") >= 0);
  expect(text.indexOf("ready on port 3000") >= 0);
});

test("buildRunTaskStatus reports the exit status once a task has finished", () => {
  let p = freshPath("finished");
  let rt = new BackgroundRunTask("bgrun-2", "npm test", p);
  appendMailbox(p, "LINE", "1 failing");
  rt.done = true;
  rt.lastStatus = "exit 1";
  rt.lineCount = 1;
  let text = buildRunTaskStatus(rt);
  expect(text.indexOf("finished, exit 1") >= 0);
  expect(text.indexOf("1 failing") >= 0);
});

test("buildRunTaskStatus caps recent output to the last MAX_STATUS_OUTPUT_LINES lines and marks it truncated", () => {
  let p = freshPath("bounded");
  let rt = new BackgroundRunTask("bgrun-3", "npm run dev", p);
  let total = MAX_STATUS_OUTPUT_LINES + 20;
  let i = 0;
  while (i < total) {
    appendMailbox(p, "LINE", "L" + `${i}`);
    i = i + 1;
  }
  let text = buildRunTaskStatus(rt);
  let lines = text.split("\n");
  expect(text.indexOf("truncated") >= 0);
  expect(!containsExact(lines, "L0"));
  expect(!containsExact(lines, "L19"));
  expect(containsExact(lines, "L20"));
  expect(containsExact(lines, "L" + `${total - 1}`));
});

test("buildAgentTaskStatus reports running with accumulated output, then the final note once done", () => {
  let t = new SubagentTask("agent-1", "investigate the flaky test", "/tmp/none-out.log", "/tmp/none-in.log", "/tmp/none-cancel.flag", "auto-edit");
  t.accumulated = "looking at the test file now";
  let running = buildAgentTaskStatus(t);
  expect(running.indexOf("running") >= 0);
  expect(running.indexOf("looking at the test file now") >= 0);

  t.done = true;
  t.finalNote = "subagent agent-1 finished: found the race condition";
  let finished = buildAgentTaskStatus(t);
  expect(finished.indexOf("finished - subagent agent-1 finished: found the race condition") >= 0);
});

test("TaskBoard.taskStatusText reports not found for an unknown id", () => {
  let b = new TaskBoard();
  let text = b.taskStatusText("bgrun-999");
  expect(text == "no task or subagent with id bgrun-999");
});

test("TaskBoard.taskStatusText finds a registered run task by id and a registered agent task by id", () => {
  let b = new TaskBoard();
  let runPath = freshPath("board-run");
  let rt = new BackgroundRunTask("bgrun-4", "npm run dev", runPath);
  appendMailbox(runPath, "LINE", "listening on 5173");
  b.registerRunTask(rt);

  let agentTask = new SubagentTask("agent-2", "refactor the parser", "/tmp/none-out2.log", "/tmp/none-in2.log", "/tmp/none-cancel2.flag", "auto-edit");
  b.registerAgentTask(agentTask);

  let runText = b.taskStatusText("bgrun-4");
  expect(runText.indexOf("listening on 5173") >= 0);
  let agentText = b.taskStatusText("agent-2");
  expect(agentText.indexOf("agent-2") >= 0);
});

test("pollRunTasks pushes a short finish summary into session history on DONE, without the full log", () => {
  let b = new TaskBoard();
  let session = freshSession();
  let startingHistoryLen = session.history.length;
  let p = freshPath("proactive-done");
  let rt = new BackgroundRunTask("bgrun-5", "npm run build", p);
  b.registerRunTask(rt);

  appendMailbox(p, "LINE", "a very specific compile error line");
  appendMailbox(p, "EXIT", "2");
  appendMailbox(p, "DONE", "lines=1");
  b.pollRunTasks(session);

  expect(session.history.length == startingHistoryLen + 1);
  let last = session.history[session.history.length - 1];
  expect(last.role == ROLE_USER);
  expect(last.text.indexOf("bgrun-5") >= 0);
  expect(last.text.indexOf("task_status") >= 0);
  expect(last.text.indexOf("a very specific compile error line") < 0);
});
