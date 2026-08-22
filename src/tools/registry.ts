import { jsonStringMemberAt, jsonMemberStart } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { ToolResult } from "../session/types.ts";
import { dispatchCoreTool, ok, fail } from "./dispatch.ts";
import { TaskRunner } from "../tasks/types.ts";

function jsonBoolMemberAt(s: string, objStart: int, key: string): bool {
  let at = jsonMemberStart(s, objStart, key);
  if (at < 0) { return false; }
  return s.slice(at, at + 4) == "true";
}

export class ToolsRegistry {
  root: string;
  tasksSlot: TaskRunner[];

  constructor(root: string) {
    this.root = root;
    this.tasksSlot = [];
  }

  setTaskRunner(tasks: TaskRunner): void {
    this.tasksSlot = [tasks];
  }

  dispatch(tool: string, args: string): ToolResult {
    if (tool == "run" && jsonBoolMemberAt(args, 0, "background")) {
      if (this.tasksSlot.length == 0) { return fail("background tasks are not available in this session"); }
      let command = jsonStringMemberAt(args, 0, "command");
      return ok(this.tasksSlot[0].startBackgroundRun(command), false);
    }
    if (tool == "spawn_agent") {
      if (this.tasksSlot.length == 0) { return fail("subagents are not available in this session"); }
      let task = jsonStringMemberAt(args, 0, "task");
      return ok(this.tasksSlot[0].startSubagent(task), false);
    }
    if (tool == "task_status") {
      if (this.tasksSlot.length == 0) { return fail("background tasks are not available in this session"); }
      let id = jsonStringMemberAt(args, 0, "id");
      return ok(this.tasksSlot[0].taskStatus(id), false);
    }
    return dispatchCoreTool(this.root, tool, args);
  }
}
