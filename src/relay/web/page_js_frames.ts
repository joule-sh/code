export const PAGE_JS_FRAMES: string = `
var PROTOCOL_VERSION = 1;
var SESSION_HELLO = "session.hello";
var TURN_START = "turn.start";
var TEXT_DELTA = "text.delta";
var TOOL_CALL = "tool.call";
var TOOL_RESULT = "tool.result";
var APPROVAL_REQUEST = "approval.request";
var TURN_END = "turn.end";
var ERROR_FRAME = "error";
var INPUT_FRAME = "input";
var CANCEL_FRAME = "cancel";
var APPROVAL_REPLY_FRAME = "approval.reply";
var RESUME_FRAME = "resume";
var REASON_DONE = "done";
var REASON_CANCELLED = "cancelled";
var REASON_ERROR = "error";
var DECISION_ALLOW = "allow";
var DECISION_DENY = "deny";
var DECISION_ALWAYS = "always";

function decodeFrame(text) {
  try {
    var parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") { return null; }
    return parsed;
  } catch (e) {
    return null;
  }
}

function frameOfType(type, fields) {
  var out = { v: PROTOCOL_VERSION, seq: 0, type: type };
  for (var key in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      out[key] = fields[key];
    }
  }
  return out;
}

function encodeInputFrame(text) {
  return JSON.stringify(frameOfType(INPUT_FRAME, { text: text }));
}

function encodeCancelFrame(turnId) {
  return JSON.stringify(frameOfType(CANCEL_FRAME, { turnId: turnId }));
}

function encodeApprovalReplyFrame(callId, decision) {
  return JSON.stringify(frameOfType(APPROVAL_REPLY_FRAME, { callId: callId, decision: decision }));
}

function encodeResumeFrame(since) {
  return JSON.stringify(frameOfType(RESUME_FRAME, { since: since }));
}

function fixtureScript() {
  var out = [];
  out.push(JSON.stringify({ v: PROTOCOL_VERSION, seq: 1, type: TURN_START, turnId: "t1", prompt: "add a health endpoint and a test for it" }));
  out.push(JSON.stringify({ v: PROTOCOL_VERSION, seq: 2, type: TEXT_DELTA, turnId: "t1", text: "No health route yet. I'll add GET /health and a test for it." }));
  out.push(JSON.stringify({ v: PROTOCOL_VERSION, seq: 3, type: TOOL_CALL, turnId: "t1", callId: "c1", tool: "write", args: "src/routes/health.ts" }));
  out.push(JSON.stringify({ v: PROTOCOL_VERSION, seq: 4, type: TOOL_RESULT, turnId: "t1", callId: "c1", ok: true, output: "wrote 12 lines", truncated: false }));
  out.push(JSON.stringify({ v: PROTOCOL_VERSION, seq: 5, type: TOOL_CALL, turnId: "t1", callId: "c2", tool: "run", args: "npm test" }));
  out.push(JSON.stringify({ v: PROTOCOL_VERSION, seq: 6, type: TOOL_RESULT, turnId: "t1", callId: "c2", ok: true, output: "2 passed, 0 failed", truncated: false }));
  out.push(JSON.stringify({ v: PROTOCOL_VERSION, seq: 7, type: TURN_END, turnId: "t1", reason: REASON_DONE }));
  return out;
}

function renderFrameText(frameJson) {
  var f = decodeFrame(frameJson);
  if (f === null) { return ""; }
  var kind = f.type;

  if (kind === TEXT_DELTA) {
    return typeof f.text === "string" ? f.text : "";
  }
  if (kind === TOOL_CALL) {
    return "\\n  -> " + f.tool + " " + f.args;
  }
  if (kind === TOOL_RESULT) {
    var status = f.ok ? "ok" : "failed";
    var out = f.output;
    if (f.truncated) { out = out + " (truncated)"; }
    return "\\n     " + status + ": " + out;
  }
  if (kind === APPROVAL_REQUEST) {
    return "\\n  ? " + f.summary + " [" + f.detail + "] (y/n/a)";
  }
  if (kind === TURN_END) {
    if (f.reason === REASON_CANCELLED) { return "\\n(cancelled)\\n"; }
    if (f.reason === REASON_ERROR) { return "\\n(error)\\n"; }
    return "\\n";
  }
  if (kind === ERROR_FRAME) {
    return "\\n! " + f.code + ": " + f.message;
  }
  return "";
}

function isKnownFrameType(t) {
  if (t === SESSION_HELLO || t === TURN_START || t === TEXT_DELTA || t === TOOL_CALL) { return true; }
  if (t === TOOL_RESULT || t === APPROVAL_REQUEST || t === TURN_END || t === ERROR_FRAME) { return true; }
  return false;
}
`;
