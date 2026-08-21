import { TaskBoard } from "./task_board.ts";
import { BackgroundRunTask, SubagentTask } from "./state.ts";

function runTask(id: string): BackgroundRunTask {
  return new BackgroundRunTask(id, "npm test", "/tmp/joule-count-" + id + ".log");
}

function agentTask(id: string): SubagentTask {
  return new SubagentTask(id, "fix the bug", "/tmp/joule-count-" + id + "-out.log", "/tmp/joule-count-" + id + "-in.log", "/tmp/joule-count-" + id + "-cancel.flag", "auto-edit");
}

test("a board with nothing on it reports no running tasks", () => {
  let b = new TaskBoard();
  expect(b.runningCount() == 0);
});

test("background runs and subagents are counted together while they are in flight", () => {
  let b = new TaskBoard();
  b.registerRunTask(runTask("bgrun-1"));
  expect(b.runningCount() == 1);
  b.registerAgentTask(agentTask("agent-1"));
  expect(b.runningCount() == 2);
  b.registerRunTask(runTask("bgrun-2"));
  expect(b.runningCount() == 3);
});

test("a finished background run stops counting as running", () => {
  let b = new TaskBoard();
  let t = runTask("bgrun-1");
  b.registerRunTask(t);
  expect(b.runningCount() == 1);
  t.done = true;
  expect(b.runningCount() == 0);
});

test("a detached background run stops counting, since nothing more from it will be shown", () => {
  let b = new TaskBoard();
  let t = runTask("bgrun-1");
  b.registerRunTask(t);
  t.detached = true;
  expect(b.runningCount() == 0);
});

test("a finished subagent stops counting as running", () => {
  let b = new TaskBoard();
  let a = agentTask("agent-1");
  b.registerAgentTask(a);
  expect(b.runningCount() == 1);
  a.done = true;
  expect(b.runningCount() == 0);
});

test("only the still-running half of a mixed board is counted", () => {
  let b = new TaskBoard();
  let done = runTask("bgrun-1");
  let detached = runTask("bgrun-2");
  let live = runTask("bgrun-3");
  let finishedAgent = agentTask("agent-1");
  let liveAgent = agentTask("agent-2");
  b.registerRunTask(done);
  b.registerRunTask(detached);
  b.registerRunTask(live);
  b.registerAgentTask(finishedAgent);
  b.registerAgentTask(liveAgent);
  expect(b.runningCount() == 5);
  done.done = true;
  detached.detached = true;
  finishedAgent.done = true;
  expect(b.runningCount() == 2);
});
