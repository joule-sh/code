import { TaskManager } from "../tasks/manager.ts";
import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";

export function tryDispatchTaskApprovalReply(tasks: TaskManager, frameJson: string): bool {
  let callId = jsonStringMemberAt(frameJson, 0, "callId");
  if (callId == "") { return false; }
  let active = tasks.activeApprovalCallId();
  if (active == "" || active != callId) { return false; }
  let decision = jsonStringMemberAt(frameJson, 0, "decision");
  tasks.answerActiveApproval(decision);
  return true;
}
