import { jsonStringMemberAt, jsonIntMemberAt, jsonMemberStart } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { ToolResult } from "../session/types.ts";
import { dispatchCoreTool, ok, fail, DEFAULT_RUN_TIMEOUT_MS } from "./dispatch.ts";
import { TaskRunner } from "../tasks/types.ts";
import { ForegroundRunner, formatForegroundResult } from "./run_wait.ts";
import { dispatchPlatformTool } from "./platform_tools.ts";
import { Credential } from "../auth/credentials.ts";

export type PlatformAccess = { server: string, credential: Credential };

const STDIN_FD: int = 0;

function jsonBoolMemberAt(s: string, objStart: int, key: string): bool {
  let at = jsonMemberStart(s, objStart, key);
  if (at < 0) { return false; }
  return s.slice(at, at + 4) == "true";
}

export class ToolsRegistry {
  root: string;
  tasksSlot: TaskRunner[];
  foregroundSlot: ForegroundRunner[];
  platformSlot: PlatformAccess[];

  constructor(root: string) {
    this.root = root;
    this.tasksSlot = [];
    this.foregroundSlot = [];
    this.platformSlot = [];
  }

  setTaskRunner(tasks: TaskRunner): void {
    this.tasksSlot = [tasks];
  }

  setForegroundRunner(runner: ForegroundRunner): void {
    this.foregroundSlot = [runner];
  }

  setPlatformAccess(server: string, credential: Credential): void {
    this.platformSlot = [{ server: server, credential: credential }];
  }

  dispatch(tool: string, args: string): ToolResult {
    if (tool == "web_search" || tool == "web_retrieve") {
      if (this.platformSlot.length == 0) { return fail("not signed in to a Joule Platform account - run /login, then try again"); }
      let access = this.platformSlot[0];
      return dispatchPlatformTool(access.server, access.credential, tool, args);
    }
    if (tool == "run" && jsonBoolMemberAt(args, 0, "background")) {
      if (this.tasksSlot.length == 0) { return fail("background tasks are not available in this session"); }
      let command = jsonStringMemberAt(args, 0, "command");
      return ok(this.tasksSlot[0].startBackgroundRun(command), false);
    }
    if (tool == "run" && this.foregroundSlot.length > 0) {
      let command = jsonStringMemberAt(args, 0, "command");
      let timeoutMs = jsonIntMemberAt(args, 0, "timeout_ms");
      if (timeoutMs <= 0) { timeoutMs = DEFAULT_RUN_TIMEOUT_MS; }
      let r = this.foregroundSlot[0].run(this.root, command, timeoutMs, STDIN_FD);
      let body = formatForegroundResult(r, timeoutMs);
      if (r.abandoned) { return fail(body); }
      return ok(body, r.truncated);
    }
    if (tool == "spawn_agent") {
      if (this.tasksSlot.length == 0) { return fail("subagents are not available in this session"); }
      let task = jsonStringMemberAt(args, 0, "task");
      let steps = jsonIntMemberAt(args, 0, "steps");
      let report = jsonStringMemberAt(args, 0, "report");
      return ok(this.tasksSlot[0].startSubagent(task, steps, report), false);
    }
    if (tool == "run_pipeline") {
      if (this.tasksSlot.length == 0) { return fail("pipelines are not available in this session"); }
      return ok(this.tasksSlot[0].startPipeline(args), false);
    }
    if (tool == "task_status") {
      if (this.tasksSlot.length == 0) { return fail("background tasks are not available in this session"); }
      let id = jsonStringMemberAt(args, 0, "id");
      return ok(this.tasksSlot[0].taskStatus(id), false);
    }
    return dispatchCoreTool(this.root, tool, args);
  }
}
