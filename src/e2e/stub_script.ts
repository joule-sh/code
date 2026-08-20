const READ_ARG_PATH: string = "README.md";
const RUN_FIX_COMMAND: string = "echo 'Added a health check note.' >> README.md";

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
  let args = toolCallArgs([strField("command", RUN_FIX_COMMAND)]);
  let fragment = toolCallFragmentJson(0, "call_run_1", "run", args);
  return textDeltaChunk("No health route yet. I will fix it.")
    + toolCallChunk(fragment)
    + finishChunk("tool_calls")
    + DONE_LINE;
}

function finalStepBody(): string {
  return textDeltaChunk("Done.") + finishChunk("stop") + DONE_LINE;
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

test("finalStepBody closes the turn with a stop finish reason", () => {
  let body = finalStepBody();
  expect(body.indexOf("\"finish_reason\":\"stop\"") >= 0);
  expect(body.indexOf("tool_calls") < 0);
});

test("scriptedResponseBody clamps out-of-range steps to the final body", () => {
  expect(scriptedResponseBody(5) == finalStepBody());
  expect(scriptedResponseBody(-1) == readStepBody());
});
