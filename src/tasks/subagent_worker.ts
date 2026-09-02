import { Message, ROLE_SYSTEM, ROLE_USER, ROLE_ASSISTANT, ROLE_TOOL } from "../session/types.ts";
import { ProviderConfig, ToolSchema, streamChat } from "../providers/openai.ts";
import { subagentToolSchemas } from "../tools/schemas.ts";
import { dispatchCoreTool } from "../tools/dispatch.ts";
import { MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_SAFE_AUTO, MODE_FULL_AUTO } from "../approval/gate.ts";
import { classifyCommand } from "../approval/command_safety.ts";
import { jsonStringMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { appendMailbox, findMailboxEntry } from "./mailbox.ts";
import { TAG_DELTA, TAG_TOOLCALL, TAG_TOOLRESULT, TAG_APPROVAL_REQUEST, TAG_ERROR, TAG_DONE, TAG_CANCELLED, encodeSubagentToolCallPayload, encodeSubagentToolResultPayload, encodeSubagentApprovalPayload, encodeSubagentErrorPayload } from "./subagent_protocol.ts";

const DEFAULT_SUBAGENT_STEPS: int = 10;
const MAX_SUBAGENT_STEPS: int = 40;
const APPROVAL_TIMEOUT_MS: int = 120000;
const APPROVAL_POLL_MS: int = 150;

const SUBAGENT_SYSTEM_PROMPT: string = "You are a subagent spawned by another agent to work one scoped task independently. Use the read, write, edit, list, grep, and run tools to make real progress, then reply in plain text summarizing what you did and found. You cannot spawn further subagents. Keep going until the task is actually done or you are certain it cannot be done, rather than stopping after the first step.";

export function clampSteps(asked: int): int {
  if (asked <= 0) { return DEFAULT_SUBAGENT_STEPS; }
  if (asked > MAX_SUBAGENT_STEPS) { return MAX_SUBAGENT_STEPS; }
  return asked;
}

// The report contract is a directive to the model, not a schema the daemon
// validates: the final reply has to be one JSON object of the asked shape and
// nothing else, so the caller can route on it instead of parsing prose.
export function withReportDirective(prompt: string, report: string): string {
  if (report == "") { return prompt; }
  return prompt + " Your FINAL reply - the one with no tool calls - must be exactly one"
    + " JSON object of this shape and nothing else, no prose before or after: " + report;
}

export function looksLikeLoneJson(text: string): bool {
  let t = text.trim();
  if (t.length < 2) { return false; }
  return t.startsWith("{") && t.endsWith("}");
}

let g_agent_base_url: string = "";
let g_agent_model: string = "";
let g_agent_api_key: string = "";
let g_agent_task: string = "";
let g_agent_root: string = "";
let g_agent_mode: string = "";
let g_agent_out: string = "";
let g_agent_in: string = "";
let g_agent_cancel: string = "";
let g_agent_steps: int = 0;
let g_agent_report: string = "";

export function configureSubagent(baseUrl: string, model: string, apiKey: string, task: string, root: string, mode: string, outPath: string, inPath: string, cancelPath: string, steps: int, report: string): void {
  g_agent_base_url = baseUrl;
  g_agent_model = model;
  g_agent_api_key = apiKey;
  g_agent_task = task;
  g_agent_root = root;
  g_agent_mode = mode;
  g_agent_out = outPath;
  g_agent_in = inPath;
  g_agent_cancel = cancelPath;
  g_agent_steps = clampSteps(steps);
  g_agent_report = report;
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

// The same reading of the mode the session's own gate has. A subagent that
// asks about a write its parent would have made unattended is not being
// careful, it is asking on the parent's behalf about a decision the parent
// already made.
export function needsAskingLite(mode: string, tool: string): bool {
  if (mode == MODE_FULL_AUTO) { return false; }
  if (mode == MODE_SAFE_AUTO) { return tool == "run"; }
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
  // In safe-auto the parent runs a command the classifier calls safe without
  // asking, so a subagent running the same command must not ask either.
  if (g_agent_mode == MODE_SAFE_AUTO && tool == "run"
    && classifyCommand(jsonStringMemberAt(args, 0, "command"), g_agent_root).autoRun) {
    return { approved: true, remember: false };
  }
  if (isAlwaysAllowed(alwaysAllowed, tool)) { return { approved: true, remember: false }; }

  let summary = tool + " " + args;
  appendMailbox(g_agent_out, TAG_APPROVAL_REQUEST, encodeSubagentApprovalPayload({ callId: localCallId, tool: tool, summary: summary, detail: args, args: args }));

  let decision = waitForApprovalReply(localCallId);
  if (decision == "always") { return { approved: true, remember: true }; }
  return { approved: decision == "allow", remember: false };
}

export function subagentLoop(): int {
  let history: Message[] = [];
  history.push({ role: ROLE_SYSTEM, text: withReportDirective(SUBAGENT_SYSTEM_PROMPT, g_agent_report), toolCallId: "", toolCalls: [] });
  history.push({ role: ROLE_USER, text: g_agent_task, toolCallId: "", toolCalls: [] });

  let tools: ToolSchema[] = subagentToolSchemas();
  let cfg: ProviderConfig = { baseUrl: g_agent_base_url, model: g_agent_model, apiKey: g_agent_api_key };
  let alwaysAllowed: string[] = [];
  let step: int = 0;
  let localCallSeq: int = 0;
  let budget: int = clampSteps(g_agent_steps);
  let corrected: bool = false;

  while (step < budget) {
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
      // A report contract that came back as prose gets one correction and one
      // extra step - once - so a near-miss becomes routable instead of noise.
      if (g_agent_report != "" && !looksLikeLoneJson(reply.text) && !corrected) {
        corrected = true;
        budget = budget + 1;
        history.push({ role: ROLE_USER, text: "Reply again with exactly one JSON object of this shape and nothing else: " + g_agent_report, toolCallId: "", toolCalls: [] });
        step = step + 1;
        continue;
      }
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
