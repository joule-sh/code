import { Session } from "../session/session.ts";
import { TaskManager } from "../tasks/manager.ts";
import { PROTOCOL_VERSION, tasksRequestFrameArg, TASKS_RESPONSE, TasksResponseFrame, encodeTasksResponse } from "../protocol/frames.ts";

const CANCEL_ARG_PREFIX: string = "cancel ";

function cancelIdFromArg(arg: string): string {
  if (arg.length <= CANCEL_ARG_PREFIX.length) { return ""; }
  if (arg.slice(0, CANCEL_ARG_PREFIX.length) != CANCEL_ARG_PREFIX) { return ""; }
  return arg.slice(CANCEL_ARG_PREFIX.length, arg.length).trim();
}

function tasksResponseText(tasks: TaskManager, arg: string): string {
  if (arg == "") { return tasks.listText(); }
  let cancelId = cancelIdFromArg(arg);
  if (cancelId != "") { return tasks.cancel(cancelId); }
  return "usage: /tasks or /tasks cancel <id>";
}

export function handleTasksRequest(session: Session, tasks: TaskManager, frameJson: string): void {
  let arg = tasksRequestFrameArg(frameJson);
  let resp: TasksResponseFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: TASKS_RESPONSE, text: tasksResponseText(tasks, arg) };
  session.emit(encodeTasksResponse(resp));
}
