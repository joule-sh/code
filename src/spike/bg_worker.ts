import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { Message, ProviderReply, ROLE_SYSTEM, ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL } from "../session/types.ts";
import { ProviderConfig, ToolSchema, streamChat } from "../providers/openai.ts";
import { RUN_SCHEMA } from "../tools/schemas.ts";
import { run } from "../tools/run.ts";
import { appendMailbox } from "./mailbox.ts";

const MAX_AGENT_STEPS: int = 4;

let g_run_command: string = "";
let g_run_mailbox: string = "";

export function configureBackgroundRun(command: string, mailboxPath: string): void {
  g_run_command = command;
  g_run_mailbox = mailboxPath;
}

export function backgroundRunLoop(): int {
  let args: string[] = ["-c", g_run_command];
  let cp = child_process.spawn("sh", args);
  let count: int = 0;
  while (true) {
    let line = cp.readLine();
    if (line == "") { break; }
    appendMailbox(g_run_mailbox, "LINE", line);
    count = count + 1;
  }
  cp.close();
  appendMailbox(g_run_mailbox, "DONE", "lines=" + `${count}`);
  return count;
}

let g_agent_url_turn1: string = "";
let g_agent_url_turn2: string = "";
let g_agent_model: string = "";
let g_agent_task: string = "";
let g_agent_root: string = "";
let g_agent_mailbox: string = "";

export function configureSubagent(urlTurn1: string, urlTurn2: string, model: string, task: string, root: string, mailboxPath: string): void {
  g_agent_url_turn1 = urlTurn1;
  g_agent_url_turn2 = urlTurn2;
  g_agent_model = model;
  g_agent_task = task;
  g_agent_root = root;
  g_agent_mailbox = mailboxPath;
}

function toolResultSummary(status: int, stdout: string): string {
  return "exit " + `${status}` + " " + stdout;
}

export function subagentLoop(): int {
  let history: Message[] = [];
  history.push({ role: ROLE_SYSTEM, text: "You are a background subagent. Use the run tool once, then report back in plain text.", toolCallId: "", toolCalls: [] });
  history.push({ role: ROLE_USER, text: g_agent_task, toolCallId: "", toolCalls: [] });

  let tools: ToolSchema[] = [RUN_SCHEMA];
  let step: int = 0;
  let done = false;

  while (!done && step < MAX_AGENT_STEPS) {
    let url = step == 0 ? g_agent_url_turn1 : g_agent_url_turn2;
    let cfg: ProviderConfig = { baseUrl: url, model: g_agent_model, apiKey: "" };
    let onDelta = (chunk: string) => { appendMailbox(g_agent_mailbox, "DELTA", chunk); };
    let shouldStop = () => false;
    let reply: ProviderReply = streamChat(cfg, history, tools, onDelta, shouldStop);

    if (reply.failed) {
      appendMailbox(g_agent_mailbox, "ERROR", reply.errorCode + " " + reply.errorMessage);
      done = true;
      continue;
    }

    if (reply.text != "" || reply.calls.length > 0) {
      history.push({ role: ROLE_ASSISTANT, text: reply.text, toolCallId: "", toolCalls: reply.calls });
    }

    if (reply.calls.length == 0) {
      appendMailbox(g_agent_mailbox, "FINAL", reply.text);
      done = true;
      continue;
    }

    for (const call of reply.calls) {
      appendMailbox(g_agent_mailbox, "TOOLCALL", call.tool + " " + call.args);
      let command = jsonStringMemberAt(call.args, 0, "command");
      let result = run(g_agent_root, command, 5000);
      let summary = toolResultSummary(result.status, result.stdout);
      appendMailbox(g_agent_mailbox, "TOOLRESULT", summary);
      history.push({ role: ROLE_TOOL, text: call.tool + ": " + summary, toolCallId: call.callId, toolCalls: [] });
    }

    step = step + 1;
  }

  return step;
}
