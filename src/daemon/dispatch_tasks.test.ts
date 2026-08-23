import { Session } from "../session/session.ts";
import { Message, ProviderReply, Provider, ToolResult, ToolRegistry, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { TaskManager } from "../tasks/manager.ts";
import { handleTasksRequest } from "./dispatch_tasks.ts";
import { PROTOCOL_VERSION, TasksRequestFrame, encodeTasksRequest, TASKS_RESPONSE, decodeTasksResponse, frameType } from "../protocol/frames.ts";

class Echoer {
  run(tool: string, args: string): ToolResult {
    let r: ToolResult = { ok: true, output: "", truncated: false };
    return r;
  }
}

class EchoProvider {
  ask(history: Message[], onDelta: (text: string) => void): ProviderReply {
    let r: ProviderReply = { text: "ok", calls: [], failed: false, errorCode: "", errorMessage: "", tokens: 0 };
    return r;
  }
}

function allowAll(): ApprovalGate {
  return { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    let d: ApprovalDecision = { allow: true };
    return d;
  } };
}

function newSession(): Session {
  let ep = new EchoProvider();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => ep.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  return new Session("/repo", "agent", provider, tools, allowAll());
}

function newTasks(): TaskManager {
  return new TaskManager("/repo", { baseUrl: "http://x", model: "m", apiKey: "k" }, () => "auto-edit");
}

class FrameCapture {
  frames: string[];
  constructor() { this.frames = []; }
  add(frameJson: string): void { this.frames.push(frameJson); }
}

function lastFrame(cap: FrameCapture): string {
  return cap.frames[cap.frames.length - 1];
}

test("a tasks.request frame with no arg answers with the task board's listing text", () => {
  let session = newSession();
  let tasks = newTasks();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: TasksRequestFrame = { v: PROTOCOL_VERSION, seq: 0, type: "tasks.request", arg: "" };
  handleTasksRequest(session, tasks, encodeTasksRequest(f));

  expect(frameType(lastFrame(cap)) == TASKS_RESPONSE);
  let resp = decodeTasksResponse(lastFrame(cap));
  expect(resp != null);
  if (resp != null) { expect(resp.text == tasks.listText()); }
});

test("a tasks.request frame with an unrecognised arg answers with usage text", () => {
  let session = newSession();
  let tasks = newTasks();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: TasksRequestFrame = { v: PROTOCOL_VERSION, seq: 0, type: "tasks.request", arg: "bogus" };
  handleTasksRequest(session, tasks, encodeTasksRequest(f));

  let resp = decodeTasksResponse(lastFrame(cap));
  expect(resp != null);
  if (resp != null) { expect(resp.text.indexOf("usage:") >= 0); }
});

test("a tasks.request cancel frame for an unknown id answers via the task board's own cancel text", () => {
  let session = newSession();
  let tasks = newTasks();
  let cap = new FrameCapture();
  session.subscribe((f: string) => cap.add(f));

  let f: TasksRequestFrame = { v: PROTOCOL_VERSION, seq: 0, type: "tasks.request", arg: "cancel bgrun-9" };
  handleTasksRequest(session, tasks, encodeTasksRequest(f));

  let resp = decodeTasksResponse(lastFrame(cap));
  expect(resp != null);
  if (resp != null) { expect(resp.text == tasks.cancel("bgrun-9")); }
});
