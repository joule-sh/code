import { BackgroundRunTask, SubagentTask, PendingAgentApproval } from "./state.ts";

test("a fresh BackgroundRunTask starts not done, not detached, zero lines, no status", () => {
  let t = new BackgroundRunTask("bgrun-1", "npm test", "/tmp/state-test-bg.log");
  expect(t.id == "bgrun-1");
  expect(t.command == "npm test");
  expect(!t.done);
  expect(!t.detached);
  expect(t.lineCount == 0);
  expect(t.lastStatus == "");
  expect(t.startedAt > 0);
});

test("a fresh SubagentTask starts not done, with empty accumulated text and no final note", () => {
  let t = new SubagentTask("agent-1", "fix the bug", "/tmp/state-test-out.log", "/tmp/state-test-in.log", "/tmp/state-test-cancel.flag", "auto-edit");
  expect(t.id == "agent-1");
  expect(t.taskText == "fix the bug");
  expect(t.mode == "auto-edit");
  expect(!t.done);
  expect(t.accumulated == "");
  expect(t.finalNote == "");
});

test("PendingAgentApproval carries the fields it was constructed with", () => {
  let p = new PendingAgentApproval("agent-1", "3", "run", "run npm test");
  expect(p.agentId == "agent-1");
  expect(p.localCallId == "3");
  expect(p.tool == "run");
  expect(p.summary == "run npm test");
});

test("a fresh PendingAgentApproval starts on the first option with no option rows on screen", () => {
  let p = new PendingAgentApproval("agent-1", "3", "run", "run npm test");
  expect(p.selected == 0);
  expect(!p.hasOptionRows());
  p.setOptionRows(7);
  expect(p.hasOptionRows());
  expect(p.firstOptionRow == 7);
});

test("PendingAgentApproval moveSelection walks the option list and reports whether the highlight moved", () => {
  let p = new PendingAgentApproval("agent-1", "3", "run", "run npm test");
  expect(p.moveSelection(1, 3));
  expect(p.selected == 1);
  expect(p.moveSelection(1, 3));
  expect(p.selected == 2);
  expect(p.moveSelection(-1, 3));
  expect(p.selected == 1);
});

test("PendingAgentApproval moveSelection clamps at both ends rather than wrapping", () => {
  let p = new PendingAgentApproval("agent-1", "3", "run", "run npm test");
  expect(!p.moveSelection(-1, 3));
  expect(p.selected == 0);
  p.moveSelection(2, 3);
  expect(p.selected == 2);
  expect(!p.moveSelection(1, 3));
  expect(p.selected == 2);
});

test("PendingAgentApproval select jumps straight to an index and ignores an out-of-range one", () => {
  let p = new PendingAgentApproval("agent-1", "3", "run", "run npm test");
  p.select(2, 3);
  expect(p.selected == 2);
  p.select(5, 3);
  expect(p.selected == 2);
  p.select(-1, 3);
  expect(p.selected == 2);
});
