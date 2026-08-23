import { TaskManager } from "../tasks/manager.ts";
import { PendingAgentApproval } from "../tasks/state.ts";
import { tryDispatchTaskApprovalReply } from "./dispatch_task_approval.ts";
import { PROTOCOL_VERSION, ApprovalReplyFrame, encodeApprovalReply } from "../protocol/frames.ts";

function newTasks(): TaskManager {
  return new TaskManager("/repo", { baseUrl: "http://x", model: "m", apiKey: "k" }, () => "auto-edit");
}

test("an approval.reply matching the task board's active approval is consumed and clears it", () => {
  let tasks = newTasks();
  tasks.board.pendingApprovals.push(new PendingAgentApproval("agent-1", "call-9", "run", "do a thing"));

  let f: ApprovalReplyFrame = { v: PROTOCOL_VERSION, seq: 0, type: "approval.reply", callId: "call-9", decision: "allow" };
  let consumed = tryDispatchTaskApprovalReply(tasks, encodeApprovalReply(f));

  expect(consumed);
  expect(!tasks.hasPendingApproval());
});

test("an approval.reply with no matching task-board approval is not consumed", () => {
  let tasks = newTasks();
  let f: ApprovalReplyFrame = { v: PROTOCOL_VERSION, seq: 0, type: "approval.reply", callId: "call-1", decision: "allow" };
  let consumed = tryDispatchTaskApprovalReply(tasks, encodeApprovalReply(f));
  expect(!consumed);
});

test("an empty callId is never treated as a match", () => {
  let tasks = newTasks();
  let f: ApprovalReplyFrame = { v: PROTOCOL_VERSION, seq: 0, type: "approval.reply", callId: "", decision: "allow" };
  let consumed = tryDispatchTaskApprovalReply(tasks, encodeApprovalReply(f));
  expect(!consumed);
});
