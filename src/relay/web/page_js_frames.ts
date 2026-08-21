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

function diffLinesJs(oldText, newText) {
  var a = oldText.split("\\n");
  var b = newText.split("\\n");
  if (a.length > 4000 || b.length > 4000) { return null; }

  var start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) { start++; }
  var endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  var midA = a.slice(start, endA);
  var midB = b.slice(start, endB);
  if (midA.length * midB.length > 1000000) { return null; }

  var w = midB.length + 1;
  var table = new Array((midA.length + 1) * w).fill(0);
  for (var i = midA.length - 1; i >= 0; i--) {
    for (var j = midB.length - 1; j >= 0; j--) {
      table[i * w + j] = midA[i] === midB[j]
        ? table[(i + 1) * w + j + 1] + 1
        : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }

  var rows = [];
  for (var n = 0; n < start; n++) { rows.push({ kind: "same", text: a[n], a: n + 1, b: n + 1 }); }
  var ii = 0, jj = 0;
  while (ii < midA.length && jj < midB.length) {
    if (midA[ii] === midB[jj]) {
      rows.push({ kind: "same", text: midA[ii], a: start + ii + 1, b: start + jj + 1 });
      ii++; jj++;
    } else if (table[(ii + 1) * w + jj] >= table[ii * w + jj + 1]) {
      rows.push({ kind: "del", text: midA[ii], a: start + ii + 1, b: 0 });
      ii++;
    } else {
      rows.push({ kind: "add", text: midB[jj], a: 0, b: start + jj + 1 });
      jj++;
    }
  }
  while (ii < midA.length) { rows.push({ kind: "del", text: midA[ii], a: start + ii + 1, b: 0 }); ii++; }
  while (jj < midB.length) { rows.push({ kind: "add", text: midB[jj], a: 0, b: start + jj + 1 }); jj++; }
  for (var m = 0; m < a.length - endA; m++) {
    rows.push({ kind: "same", text: a[endA + m], a: endA + m + 1, b: endB + m + 1 });
  }
  return rows;
}

function diffCountsJs(rows) {
  var added = 0, removed = 0;
  for (var k = 0; k < rows.length; k++) {
    if (rows[k].kind === "add") { added++; }
    if (rows[k].kind === "del") { removed++; }
  }
  return { added: added, removed: removed };
}

var ESC = String.fromCharCode(27);
var ANSI_RESET = ESC + "[0m";
var ANSI_DIM = ESC + "[38;2;120;120;125m";
var ANSI_RED = ESC + "[38;2;229;72;77m";
var ANSI_GREEN = ESC + "[38;2;110;190;115m";

function diffGutterJs(row) {
  return row.kind === "add" ? row.b : row.a;
}

function padLeftNumJs(n, width) {
  var s = "" + n;
  while (s.length < width) { s = " " + s; }
  return s;
}

function renderDiffRowsJs(rows) {
  if (rows.length === 0) { return ""; }
  var width = 2;
  for (var i = 0; i < rows.length; i++) {
    var s = "" + diffGutterJs(rows[i]);
    if (s.length > width) { width = s.length; }
  }
  var lines = [];
  for (var j = 0; j < rows.length; j++) {
    var r = rows[j];
    var gutter = ANSI_DIM + padLeftNumJs(diffGutterJs(r), width) + ANSI_RESET;
    if (r.kind === "add") {
      lines.push(gutter + " " + ANSI_GREEN + "+ " + r.text + ANSI_RESET);
    } else if (r.kind === "del") {
      lines.push(gutter + " " + ANSI_RED + "- " + r.text + ANSI_RESET);
    } else {
      lines.push(gutter + "   " + r.text);
    }
  }
  return lines.join("\\n");
}

var DIFF_DISPLAY_MAX_ROWS = 400;

function diffableToolPathJs(tool, args) {
  if (tool !== "edit" && tool !== "write") { return ""; }
  try {
    var p = JSON.parse(args);
    if (p === null || typeof p !== "object") { return ""; }
    return typeof p.path === "string" ? p.path : "";
  } catch (e) {
    return "";
  }
}

function diffBlockForCallJs(tool, args) {
  var p;
  try {
    p = JSON.parse(args);
  } catch (e) {
    return "";
  }
  var oldText = "";
  var newText = "";
  if (tool === "edit") {
    oldText = typeof p.old_text === "string" ? p.old_text : "";
    newText = typeof p.new_text === "string" ? p.new_text : "";
  } else {
    newText = typeof p.content === "string" ? p.content : "";
  }
  var rows = diffLinesJs(oldText, newText);
  if (rows === null) { return ""; }
  if (rows.length > DIFF_DISPLAY_MAX_ROWS) { return ""; }
  var counts = diffCountsJs(rows);
  if (counts.added === 0 && counts.removed === 0) { return ""; }
  var body = renderDiffRowsJs(rows);
  if (body === "") { return ""; }
  return "\\n" + body;
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

function renderFrameText(frameJson, prevKind) {
  var f = decodeFrame(frameJson);
  if (f === null) { return ""; }
  var kind = f.type;

  if (kind === TEXT_DELTA) {
    var deltaText = typeof f.text === "string" ? f.text : "";
    if (prevKind !== TEXT_DELTA) { return "\\n" + deltaText; }
    return deltaText;
  }
  if (kind === TOOL_CALL) {
    var diffPath = diffableToolPathJs(f.tool, f.args);
    if (diffPath !== "") {
      return "\\n  -> " + f.tool + " " + diffPath + diffBlockForCallJs(f.tool, f.args);
    }
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
