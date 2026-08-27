import { isWindows } from "../vendor/platform/platform.ts";
import { sseEvents } from "./stub_http.ts";

const READ_ARG_PATH: string = "README.md";
const POSIX_RUN_FIX_COMMAND: string = "echo 'Added a health check note.' >> README.md";
const WINDOWS_RUN_FIX_COMMAND: string = "Add-Content -Path README.md -Value 'Added a health check note.'";

// The scripted model writes for the shell it is about to be run in, the way a
// real one would. Windows PowerShell's >> is Out-File, and Out-File writes
// UTF-16 there, so the POSIX line appends the note in a form nothing that
// reads the file as UTF-8 can find - the tool exits 0 and the check that the
// call landed on disk fails on the encoding rather than on the call.
export function runFixCommand(): string {
  if (isWindows()) { return WINDOWS_RUN_FIX_COMMAND; }
  return POSIX_RUN_FIX_COMMAND;
}
const ALWAYS_SCRIPT: string = "always";
const POSIX_RUN_AGAIN_COMMAND: string = "echo 'Checked the health note again.' >> README.md";
const WINDOWS_RUN_AGAIN_COMMAND: string = "Add-Content -Path README.md -Value 'Checked the health note again.'";

export function runAgainCommand(): string {
  if (isWindows()) { return WINDOWS_RUN_AGAIN_COMMAND; }
  return POSIX_RUN_AGAIN_COMMAND;
}
const SKILLS_SCRIPT: string = "skills";
const SKILLS_RUN_COMMAND: string = "sh .claude/skills/deploy/deploy.sh";
const TRANSCRIPT_SCRIPT: string = "transcript";
const TRANSCRIPT_READ_PATH: string = "server.js";
const TRANSCRIPT_RUN_COMMAND: string = "sh noisy.sh";
const WRAP_SCRIPT: string = "wrap";
const SLOW_SCRIPT: string = "slow";
export const SLOW_DELTA_COUNT: int = 6;
export const WRAP_PROSE: string = "I read the server and the handler it registers, and the only thing missing is a health route, so I will add one now and then run the whole test suite to be sure nothing else moved while I was in there.";
export const WRAP_RUN_COMMAND: string = "npm run build --silent && npm test -- --reporter=verbose --runInBand tests/health.spec.js tests/routes.spec.js";

function sseEventCount(body: string): int {
  return sseEvents(body).length;
}

function joinComma(parts: string[]): string {
  let out = "";
  let i: int = 0;
  while (i < parts.length) {
    if (i > 0) { out = out + ","; }
    out = out + parts[i];
    i = i + 1;
  }
  return out;
}

function jsonObj(pairs: string[]): string {
  return "{" + joinComma(pairs) + "}";
}

function jsonArr(items: string[]): string {
  return "[" + joinComma(items) + "]";
}

function field(key: string, jsonValue: string): string {
  return JSON.stringify(key) + ":" + jsonValue;
}

function strField(key: string, value: string): string {
  return field(key, JSON.stringify(value));
}

function sseLine(payloadJson: string): string {
  return "data: " + payloadJson + "\n\n";
}

function choiceEnvelope(deltaJson: string, finishReason: string): string {
  let finishJson = "null";
  if (finishReason != "") { finishJson = JSON.stringify(finishReason); }
  let choice = jsonObj([
    field("index", "0"),
    field("delta", deltaJson),
    field("finish_reason", finishJson),
  ]);
  return jsonObj([field("choices", jsonArr([choice]))]);
}

function textDeltaChunk(text: string): string {
  let delta = jsonObj([strField("content", text)]);
  return sseLine(choiceEnvelope(delta, ""));
}

function toolCallArgs(pairs: string[]): string {
  return jsonObj(pairs);
}

function toolCallFragmentJson(index: int, id: string, name: string, argsJson: string): string {
  let fn = jsonObj([
    strField("name", name),
    strField("arguments", argsJson),
  ]);
  return jsonObj([
    field("index", `${index}`),
    strField("id", id),
    strField("type", "function"),
    field("function", fn),
  ]);
}

function toolCallChunk(fragmentJson: string): string {
  let delta = jsonObj([field("tool_calls", jsonArr([fragmentJson]))]);
  return sseLine(choiceEnvelope(delta, ""));
}

function finishChunk(reason: string): string {
  return sseLine(choiceEnvelope("{}", reason));
}

const DONE_LINE: string = "data: [DONE]\n\n";

function readStepBody(): string {
  let args = toolCallArgs([strField("path", READ_ARG_PATH)]);
  let fragment = toolCallFragmentJson(0, "call_read_1", "read", args);
  return textDeltaChunk("Let me check the README first.")
    + toolCallChunk(fragment)
    + finishChunk("tool_calls")
    + DONE_LINE;
}

function runStepBody(): string {
  let args = toolCallArgs([strField("command", runFixCommand())]);
  let fragment = toolCallFragmentJson(0, "call_run_1", "run", args);
  return textDeltaChunk("No health route yet. I will fix it.")
    + toolCallChunk(fragment)
    + finishChunk("tool_calls")
    + DONE_LINE;
}

function runAgainStepBody(): string {
  let args = toolCallArgs([strField("command", runAgainCommand())]);
  let fragment = toolCallFragmentJson(0, "call_run_2", "run", args);
  return textDeltaChunk("Let me confirm the note landed.")
    + toolCallChunk(fragment)
    + finishChunk("tool_calls")
    + DONE_LINE;
}

function finalStepBody(): string {
  return textDeltaChunk("Done.") + finishChunk("stop") + DONE_LINE;
}

function transcriptReadStepBody(): string {
  let args = toolCallArgs([strField("path", TRANSCRIPT_READ_PATH)]);
  let fragment = toolCallFragmentJson(0, "call_read_1", "read", args);
  return textDeltaChunk("Let me read the server before I start it.")
    + toolCallChunk(fragment)
    + finishChunk("tool_calls")
    + DONE_LINE;
}

function transcriptRunStepBody(): string {
  let args = toolCallArgs([strField("command", TRANSCRIPT_RUN_COMMAND)]);
  let fragment = toolCallFragmentJson(0, "call_run_1", "run", args);
  return textDeltaChunk("It looks fine. I will start it and watch what it prints.")
    + toolCallChunk(fragment)
    + finishChunk("tool_calls")
    + DONE_LINE;
}

function wrapStepBody(): string {
  let args = toolCallArgs([strField("command", WRAP_RUN_COMMAND)]);
  let fragment = toolCallFragmentJson(0, "call_run_wrap", "run", args);
  return textDeltaChunk(WRAP_PROSE)
    + toolCallChunk(fragment)
    + finishChunk("tool_calls")
    + DONE_LINE;
}

function slowDeltas(prefix: string): string {
  let out = "";
  let i: int = 0;
  while (i < SLOW_DELTA_COUNT) {
    out = out + textDeltaChunk(prefix + `${i}` + " ");
    i = i + 1;
  }
  return out;
}

function slowRunStepBody(): string {
  let args = toolCallArgs([strField("command", runFixCommand())]);
  let fragment = toolCallFragmentJson(0, "call_run_slow", "run", args);
  return slowDeltas("thinking ")
    + toolCallChunk(fragment)
    + finishChunk("tool_calls")
    + DONE_LINE;
}

function slowFinalStepBody(): string {
  return slowDeltas("wrapping ") + finishChunk("stop") + DONE_LINE;
}

function skillsRunStepBody(): string {
  let args = toolCallArgs([strField("command", SKILLS_RUN_COMMAND)]);
  let fragment = toolCallFragmentJson(0, "call_run_1", "run", args);
  return textDeltaChunk("The skill says to run its deploy script.")
    + toolCallChunk(fragment)
    + finishChunk("tool_calls")
    + DONE_LINE;
}

export function scriptedResponseBodyFor(script: string, step: int): string {
  if (script == ALWAYS_SCRIPT) {
    if (step <= 0) { return runStepBody(); }
    if (step == 1) { return runAgainStepBody(); }
    return finalStepBody();
  }
  if (script == SKILLS_SCRIPT) {
    if (step <= 0) { return skillsRunStepBody(); }
    return finalStepBody();
  }
  if (script == SLOW_SCRIPT) {
    if (step <= 0) { return slowRunStepBody(); }
    return slowFinalStepBody();
  }
  if (script == WRAP_SCRIPT) {
    if (step <= 0) { return wrapStepBody(); }
    return finalStepBody();
  }
  if (script != TRANSCRIPT_SCRIPT) { return scriptedResponseBody(step); }
  if (step <= 0) { return transcriptReadStepBody(); }
  if (step == 1) { return transcriptRunStepBody(); }
  return finalStepBody();
}

export function scriptedResponseBody(step: int): string {
  let clamped = step;
  if (clamped < 0) { clamped = 0; }
  if (clamped > 2) { clamped = 2; }
  if (clamped == 0) { return readStepBody(); }
  if (clamped == 1) { return runStepBody(); }
  return finalStepBody();
}

test("readStepBody proposes reading README.md", () => {
  let body = readStepBody();
  expect(body.indexOf("\"name\":\"read\"") >= 0);
  expect(body.indexOf("README.md") >= 0);
  expect(body.indexOf("data: [DONE]") >= 0);
});

test("runStepBody proposes running the fix command", () => {
  let body = runStepBody();
  expect(body.indexOf("\"name\":\"run\"") >= 0);
  expect(body.indexOf("Added a health check note.") >= 0);
  expect(body.indexOf("\"finish_reason\":\"tool_calls\"") >= 0);
});

test("the fix command appends the note in a form the shell it runs in leaves readable", () => {
  expect(runFixCommand().indexOf("Added a health check note.") >= 0);
  if (isWindows()) {
    expect(runFixCommand().indexOf("Add-Content") >= 0);
    expect(runFixCommand().indexOf(">>") < 0);
  } else {
    expect(runFixCommand().indexOf(">> README.md") >= 0);
  }
});

test("finalStepBody closes the turn with a stop finish reason", () => {
  let body = finalStepBody();
  expect(body.indexOf("\"finish_reason\":\"stop\"") >= 0);
  expect(body.indexOf("tool_calls") < 0);
});

test("scriptedResponseBody clamps out-of-range steps to the final body", () => {
  expect(scriptedResponseBody(5) == finalStepBody());
  expect(scriptedResponseBody(-1) == readStepBody());
});

test("the transcript script reads a file and then runs a command that prints a lot", () => {
  let read = scriptedResponseBodyFor("transcript", 0);
  expect(read.indexOf("server.js") >= 0);
  let run = scriptedResponseBodyFor("transcript", 1);
  expect(run.indexOf("sh noisy.sh") >= 0);
  expect(scriptedResponseBodyFor("transcript", 2) == finalStepBody());
});

test("the skills script proposes running the script a skill carries, so it meets the approval gate", () => {
  let run = scriptedResponseBodyFor("skills", 0);
  expect(run.indexOf(".claude/skills/deploy/deploy.sh") >= 0);
  expect(run.indexOf("\"name\":\"run\"") >= 0);
  expect(scriptedResponseBodyFor("skills", 1) == finalStepBody());
});

test("the always script asks to run twice, so the second call meets a session that already decided", () => {
  let first = scriptedResponseBodyFor("always", 0);
  expect(first == runStepBody());
  let again = scriptedResponseBodyFor("always", 1);
  expect(again.indexOf("\"name\":\"run\"") >= 0);
  expect(again.indexOf(runAgainCommand()) >= 0);
  expect(again != first);
  expect(scriptedResponseBodyFor("always", 2) == finalStepBody());
});

test("an unnamed script is the one every other harness drives", () => {
  expect(scriptedResponseBodyFor("", 0) == readStepBody());
  expect(scriptedResponseBodyFor("", 1) == runStepBody());
});

test("wrapStepBody carries prose and a command that both outrun an 80 column terminal", () => {
  expect(WRAP_PROSE.length > 80);
  expect(WRAP_RUN_COMMAND.length > 80);
  let body = wrapStepBody();
  expect(body.indexOf("\"name\":\"run\"") >= 0);
  expect(body.indexOf("data: [DONE]") >= 0);
});

test("the wrap script answers its first step with the long prose and its next with the close", () => {
  expect(scriptedResponseBodyFor("wrap", 0) == wrapStepBody());
  expect(scriptedResponseBodyFor("wrap", 1) == finalStepBody());
});

test("the slow script streams several deltas before it asks to run anything", () => {
  let first = scriptedResponseBodyFor("slow", 0);
  expect(sseEventCount(first) == SLOW_DELTA_COUNT + 3);
  expect(first.indexOf("thinking 0 ") >= 0);
  expect(first.indexOf("thinking " + `${SLOW_DELTA_COUNT - 1}` + " ") >= 0);
  expect(first.indexOf(runFixCommand()) > first.indexOf("thinking 0 "));
  expect(first.indexOf("\"name\":\"run\"") >= 0);
});

test("the slow script keeps streaming after the approval, then closes the turn", () => {
  let second = scriptedResponseBodyFor("slow", 1);
  expect(sseEventCount(second) == SLOW_DELTA_COUNT + 2);
  expect(second.indexOf("wrapping 0 ") >= 0);
  expect(second.indexOf("\"finish_reason\":\"stop\"") >= 0);
  expect(second.indexOf("tool_calls") < 0);
});
