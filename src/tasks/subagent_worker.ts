import { Message, ROLE_SYSTEM, ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL } from "../session/types.ts";
import { ProviderConfig, ToolSchema, streamChat } from "../providers/openai.ts";
import { subagentToolSchemas } from "../tools/schemas.ts";
import { dispatchCoreTool } from "../tools/dispatch.ts";
import { MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_FULL_AUTO } from "../approval/gate.ts";
import { appendMailbox, findMailboxEntry } from "./mailbox.ts";
import { TAG_DELTA, TAG_TOOLCALL, TAG_TOOLRESULT, TAG_APPROVAL_REQUEST, TAG_ERROR, TAG_DONE, TAG_CANCELLED, encodeSubagentToolCallPayload, encodeSubagentToolResultPayload, encodeSubagentApprovalPayload, encodeSubagentErrorPayload } from "./subagent_protocol.ts";

const MAX_SUBAGENT_STEPS: int = 10;
const APPROVAL_TIMEOUT_MS: int = 120000;
const APPROVAL_POLL_MS: int = 150;

const SUBAGENT_SYSTEM_PROMPT: string = "You are a subagent spawned by another agent to work one scoped task independently. Use the read, write, edit, list, grep, and run tools to make real progress, then reply in plain text summarizing what you did and found. You cannot spawn further subagents. Keep going until the task is actually done or you are certain it cannot be done, rather than stopping after the first step.";

let g_agent_base_url: string = "";
let g_agent_model: string = "";
let g_agent_api_key: string = "";
let g_agent_task: string = "";
let g_agent_root: string = "";
let g_agent_mode: string = "";
let g_agent_out: string = "";
let g_agent_in: string = "";
let g_agent_cancel: string = "";

export function configureSubagent(baseUrl: string, model: string, apiKey: string, task: string, root: string, mode: string, outPath: string, inPath: string, cancelPath: string): void {
  g_agent_base_url = baseUrl;
  g_agent_model = model;
  g_agent_api_key = apiKey;
  g_agent_task = task;
  g_agent_root = root;
  g_agent_mode = mode;
  g_agent_out = outPath;
  g_agent_in = inPath;
  g_agent_cancel = cancelPath;
}

function isReadToolLite(tool: string): bool {
  return tool == "read" || tool == "list" || tool == "grep";
}

function isAlwaysAllowed(list: string[], tool: string): bool {
  for (const t of list) {
    if (t == tool) { return true; }
  }
  return false;
}

function needsAskingLite(mode: string, tool: string): bool {
  if (mode == MODE_FULL_AUTO) { return false; }
  if (mode == MODE_AUTO_EDIT) { return tool == "run"; }
  return true;
}

function isCancelled(): bool {
  return fs.existsSync(g_agent_cancel);
}

function waitForApprovalReply(localCallId: string): string {
  let waited: int = 0;
  while (waited < APPROVAL_TIMEOUT_MS) {
    if (isCancelled()) { return "deny"; }
    let decision = findMailboxEntry(g_agent_in, localCallId);
    if (decision != "") { return decision; }
    process.sleep(APPROVAL_POLL_MS);
    waited = waited + APPROVAL_POLL_MS;
  }
  return "deny";
}

type ApprovalOutcome = { approved: bool, remember: bool };

function checkSubagentApproval(alwaysAllowed: string[], localCallId: string, tool: string, args: string): ApprovalOutcome {
  if (isReadToolLite(tool)) { return { approved: true, remember: false }; }
  if (g_agent_mode == MODE_READ_ONLY) { return { approved: false, remember: false }; }
  if (!needsAskingLite(g_agent_mode, tool)) { return { approved: true, remember: false }; }
  if (isAlwaysAllowed(alwaysAllowed, tool)) { return { approved: true, remember: false }; }

  let summary = tool + " " + args;
  appendMailbox(g_agent_out, TAG_APPROVAL_REQUEST, encodeSubagentApprovalPayload({ callId: localCallId, tool: tool, summary: summary, detail: args, args: args }));

  let decision = waitForApprovalReply(localCallId);
  if (decision == "always") { return { approved: true, remember: true }; }
  return { approved: decision == "allow", remember: false };
}

export function subagentLoop(): int {
  let history: Message[] = [];
  history.push({ role: ROLE_SYSTEM, text: SUBAGENT_SYSTEM_PROMPT, toolCallId: "", toolCalls: [] });
  history.push({ role: ROLE_USER, text: g_agent_task, toolCallId: "", toolCalls: [] });

  let tools: ToolSchema[] = subagentToolSchemas();
  let cfg: ProviderConfig = { baseUrl: g_agent_base_url, model: g_agent_model, apiKey: g_agent_api_key };
  let alwaysAllowed: string[] = [];
  let step: int = 0;
  let localCallSeq: int = 0;

  while (step < MAX_SUBAGENT_STEPS) {
    if (isCancelled()) {
      appendMailbox(g_agent_out, TAG_CANCELLED, "cancelled before step " + `${step}`);
      return step;
    }

    let onDelta = (chunk: string) => { appendMailbox(g_agent_out, TAG_DELTA, chunk); };
    let shouldStop = () => isCancelled();
    let reply = streamChat(cfg, history, tools, onDelta, shouldStop);

    if (isCancelled()) {
      appendMailbox(g_agent_out, TAG_CANCELLED, "cancelled mid-response at step " + `${step}`);
      return step;
    }

    if (reply.failed) {
      appendMailbox(g_agent_out, TAG_ERROR, encodeSubagentErrorPayload({ code: reply.errorCode, message: reply.errorMessage }));
      return step;
    }

    if (reply.text != "" || reply.calls.length > 0) {
      history.push({ role: ROLE_ASSISTANT, text: reply.text, toolCallId: "", toolCalls: reply.calls });
    }

    if (reply.calls.length == 0) {
      appendMailbox(g_agent_out, TAG_DONE, "");
      return step;
    }

    for (const call of reply.calls) {
      localCallSeq = localCallSeq + 1;
      let localCallId = `${localCallSeq}`;
      let outcome = checkSubagentApproval(alwaysAllowed, localCallId, call.tool, call.args);
      if (outcome.remember) { alwaysAllowed.push(call.tool); }

      if (!outcome.approved) {
        history.push({ role: ROLE_TOOL, text: call.tool + ": denied", toolCallId: call.callId, toolCalls: [] });
        continue;
      }

      appendMailbox(g_agent_out, TAG_TOOLCALL, encodeSubagentToolCallPayload({ callId: localCallId, tool: call.tool, args: call.args }));

      let result = dispatchCoreTool(g_agent_root, call.tool, call.args);

      appendMailbox(g_agent_out, TAG_TOOLRESULT, encodeSubagentToolResultPayload({ callId: localCallId, ok: result.ok, output: result.output, truncated: result.truncated }));

      history.push({ role: ROLE_TOOL, text: call.tool + ": " + result.output, toolCallId: call.callId, toolCalls: [] });
    }

    step = step + 1;
  }

  appendMailbox(g_agent_out, TAG_DONE, "");
  return step;
}

export function spawnSubagent(): Promise<int> {
  return Worker.run(() => { return subagentLoop(); });
}
