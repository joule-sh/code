var FRAMES_GENERATED_FROM = "src/relay/web/page_js_frames.ts + src/relay/web/page_js_view.ts";

var PROTOCOL_VERSION = 1;
var SESSION_HELLO = "session.hello";
var TURN_START = "turn.start";
var TEXT_DELTA = "text.delta";
var TOOL_CALL = "tool.call";
var TOOL_RESULT = "tool.result";
var APPROVAL_REQUEST = "approval.request";
var TURN_END = "turn.end";
var ERROR_FRAME = "error";
var NOTICE_FRAME = "notice";
var LEVEL_INFO = "info";
var LEVEL_WARN = "warn";
var INPUT_FRAME = "input";
var CANCEL_FRAME = "cancel";
var APPROVAL_REPLY_FRAME = "approval.reply";
var APPROVAL_REPLY_RESULT = "approval.reply.result";
var RESUME_FRAME = "resume";
var MODE_SET_FRAME = "mode.set";
var MODEL_SET_FRAME = "model.set";
var REASON_DONE = "done";
var REASON_CANCELLED = "cancelled";
var REASON_ERROR = "error";
var DECISION_ALLOW = "allow";
var DECISION_DENY = "deny";
var DECISION_ALWAYS = "always";
var MODE_CHANGED = "mode.changed";
var MODEL_CHANGED = "model.changed";
var TASKS_RESPONSE = "tasks.response";
var DAEMON_STOPPING = "daemon.stopping";
var SHARE_STARTED = "share.started";
var SHARE_FAILED = "share.failed";

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
  var a = oldText.split("\n");
  var b = newText.split("\n");
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
var ANSI_REVERSE = ESC + "[7m";

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
  return lines.join("\n");
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
  return "\n" + body;
}

var TOOL_OUTPUT_COLLAPSE_HEAD_LINES = 6;
var TOOL_OUTPUT_COLLAPSE_MIN_LINES = 10;

function planToolOutputCollapseJs(output) {
  var rows = output.split("\n");
  if (rows.length <= TOOL_OUTPUT_COLLAPSE_MIN_LINES) {
    return { head: output, body: "", hidden: 0 };
  }
  return {
    head: rows.slice(0, TOOL_OUTPUT_COLLAPSE_HEAD_LINES).join("\n"),
    body: rows.slice(TOOL_OUTPUT_COLLAPSE_HEAD_LINES).join("\n"),
    hidden: rows.length - TOOL_OUTPUT_COLLAPSE_HEAD_LINES
  };
}

var APPROVAL_OPTION_ALLOW = 0;
var APPROVAL_OPTION_ALWAYS = 1;
var APPROVAL_OPTION_DENY = 2;
var APPROVAL_OPTION_COUNT = 3;
var APPROVAL_OPTION_INDENT = "    ";
var APPROVAL_MARKER_ON = "> ";
var APPROVAL_MARKER_OFF = "  ";

function approvalOptionLabelJs(index, tool) {
  if (index === APPROVAL_OPTION_ALWAYS) { return "2. Yes, and don't ask again for " + tool + " this session"; }
  if (index === APPROVAL_OPTION_DENY) { return "3. No"; }
  return "1. Yes";
}

function approvalOptionRowJs(index, selected, tool) {
  var label = approvalOptionLabelJs(index, tool);
  if (index === selected) {
    return APPROVAL_OPTION_INDENT + ANSI_REVERSE + APPROVAL_MARKER_ON + label + ANSI_RESET;
  }
  return APPROVAL_OPTION_INDENT + ANSI_DIM + APPROVAL_MARKER_OFF + label + ANSI_RESET;
}

function approvalOptionsBlockJs(tool, selected) {
  var out = "";
  for (var i = 0; i < APPROVAL_OPTION_COUNT; i++) {
    out += "\n" + approvalOptionRowJs(i, selected, tool);
  }
  return out;
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

function encodeModeSetFrame(mode) {
  return JSON.stringify(frameOfType(MODE_SET_FRAME, { mode: mode }));
}

function encodeModelSetFrame(model) {
  return JSON.stringify(frameOfType(MODEL_SET_FRAME, { model: model }));
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
    if (prevKind !== TEXT_DELTA) { return "\n" + deltaText; }
    return deltaText;
  }
  if (kind === TOOL_CALL) {
    var diffPath = diffableToolPathJs(f.tool, f.args);
    if (diffPath !== "") {
      return "\n  -> " + f.tool + " " + diffPath + diffBlockForCallJs(f.tool, f.args);
    }
    return "\n  -> " + f.tool + " " + f.args;
  }
  if (kind === TOOL_RESULT) {
    var status = f.ok ? "ok" : "failed";
    var out = f.output;
    if (f.truncated) { out = out + " (truncated)"; }
    return "\n     " + status + ": " + out;
  }
  if (kind === APPROVAL_REQUEST) {
    var approvalDiff = diffBlockForCallJs(f.tool, f.args);
    return "\n  ? " + f.summary + " [" + f.detail + "] " + approvalDiff + approvalOptionsBlockJs(f.tool, APPROVAL_OPTION_ALLOW);
  }
  if (kind === TURN_END) {
    if (f.reason === REASON_CANCELLED) { return "\n(cancelled)\n"; }
    if (f.reason === REASON_ERROR) { return "\n(error)\n"; }
    return "\n";
  }
  if (kind === ERROR_FRAME) {
    return "\n! " + f.code + ": " + f.message;
  }
  if (kind === NOTICE_FRAME) {
    if (f.level === LEVEL_WARN) { return "\n! " + f.message; }
    return "\n" + f.message;
  }
  if (kind === APPROVAL_REPLY_RESULT) {
    if (f.applied) { return ""; }
    return "\n  (a reply for that approval arrived after it was already decided: " + f.decision + ")";
  }
  return "";
}

function isKnownFrameType(t) {
  if (t === SESSION_HELLO || t === TURN_START || t === TEXT_DELTA || t === TOOL_CALL) { return true; }
  if (t === TOOL_RESULT || t === APPROVAL_REQUEST || t === TURN_END || t === ERROR_FRAME) { return true; }
  if (t === APPROVAL_REPLY_RESULT || t === NOTICE_FRAME) { return true; }
  return false;
}

function noticeLineClass(level) {
  return level === LEVEL_WARN ? "line-warn" : "line-notice";
}

function isDaemonBroadcastType(t) {
  if (t === MODE_CHANGED || t === MODEL_CHANGED || t === TASKS_RESPONSE) { return true; }
  if (t === DAEMON_STOPPING || t === SHARE_STARTED || t === SHARE_FAILED) { return true; }
  return false;
}

var VIEW_ESC = String.fromCharCode(27);
var VIEW_BEL = String.fromCharCode(7);
var VIEW_META_INLINE_MAX = 60;

function ansiStateJs() {
  return { fg: -1, bg: -1, bold: false, dim: false, italic: false, underline: false, inverse: false };
}

function ansiResetJs(state) {
  state.fg = -1;
  state.bg = -1;
  state.bold = false;
  state.dim = false;
  state.italic = false;
  state.underline = false;
  state.inverse = false;
}

function ansiNearestJs(r, g, b, mid, high) {
  var index = 0;
  if (r >= mid) { index += 1; }
  if (g >= mid) { index += 2; }
  if (b >= mid) { index += 4; }
  if (r >= high || g >= high || b >= high) { index += 8; }
  return index;
}

function ansi256IndexJs(n) {
  if (isNaN(n) || n < 0 || n > 255) { return -1; }
  if (n < 16) { return n; }
  if (n >= 232) { return n >= 244 ? 15 : 8; }
  var cube = n - 16;
  return ansiNearestJs(Math.floor(cube / 36) % 6, Math.floor(cube / 6) % 6, cube % 6, 3, 4);
}

function ansiExtendedIndexJs(parts, at) {
  var mode = parseInt(parts[at + 1], 10);
  if (mode === 5) { return { index: ansi256IndexJs(parseInt(parts[at + 2], 10)), used: 2 }; }
  if (mode === 2) {
    var r = parseInt(parts[at + 2], 10);
    var g = parseInt(parts[at + 3], 10);
    var b = parseInt(parts[at + 4], 10);
    if (isNaN(r) || isNaN(g) || isNaN(b)) { return { index: -1, used: 4 }; }
    return { index: ansiNearestJs(r, g, b, 128, 192), used: 4 };
  }
  return { index: -1, used: 1 };
}

function ansiApplyJs(state, body) {
  var parts = body === "" ? ["0"] : body.split(";");
  for (var i = 0; i < parts.length; i++) {
    var n = parseInt(parts[i], 10);
    if (isNaN(n) || n === 0) { ansiResetJs(state); continue; }
    if (n === 1) { state.bold = true; continue; }
    if (n === 2) { state.dim = true; continue; }
    if (n === 3) { state.italic = true; continue; }
    if (n === 4) { state.underline = true; continue; }
    if (n === 7) { state.inverse = true; continue; }
    if (n === 22) { state.bold = false; state.dim = false; continue; }
    if (n === 23) { state.italic = false; continue; }
    if (n === 24) { state.underline = false; continue; }
    if (n === 27) { state.inverse = false; continue; }
    if (n === 39) { state.fg = -1; continue; }
    if (n === 49) { state.bg = -1; continue; }
    if (n >= 30 && n <= 37) { state.fg = n - 30; continue; }
    if (n >= 90 && n <= 97) { state.fg = n - 82; continue; }
    if (n >= 40 && n <= 47) { state.bg = n - 40; continue; }
    if (n >= 100 && n <= 107) { state.bg = n - 92; continue; }
    if (n === 38 || n === 48) {
      var found = ansiExtendedIndexJs(parts, i);
      if (n === 38) { state.fg = found.index; } else { state.bg = found.index; }
      i += found.used;
    }
  }
}

function ansiClassJs(state) {
  var names = [];
  if (state.fg >= 0) { names.push("ansi-fg-" + state.fg); }
  if (state.bg >= 0) { names.push("ansi-bg-" + state.bg); }
  if (state.bold) { names.push("ansi-bold"); }
  if (state.dim) { names.push("ansi-dim"); }
  if (state.italic) { names.push("ansi-italic"); }
  if (state.underline) { names.push("ansi-underline"); }
  if (state.inverse) { names.push("ansi-inverse"); }
  return names.join(" ");
}

function ansiSkipOscJs(text, from) {
  var i = from;
  while (i < text.length) {
    if (text.charAt(i) === VIEW_BEL) { return i + 1; }
    if (text.charAt(i) === VIEW_ESC && text.charAt(i + 1) === "\\") { return i + 2; }
    i += 1;
  }
  return i;
}

function ansiSegmentsJs(text) {
  var source = String(text).split("\r\n").join("\n").split("\r").join("");
  var segments = [];
  var state = ansiStateJs();
  var buffer = "";
  var i = 0;
  while (i < source.length) {
    var c = source.charAt(i);
    if (c !== VIEW_ESC) { buffer += c; i += 1; continue; }
    var next = source.charAt(i + 1);
    if (next === "]") { i = ansiSkipOscJs(source, i + 2); continue; }
    if (next !== "[") { i += 2; continue; }
    var j = i + 2;
    while (j < source.length && ";0123456789?".indexOf(source.charAt(j)) >= 0) { j += 1; }
    var final = source.charAt(j);
    var body = source.slice(i + 2, j);
    i = j + 1;
    if (final !== "m") { continue; }
    if (buffer !== "") { segments.push({ text: buffer, cls: ansiClassJs(state) }); buffer = ""; }
    ansiApplyJs(state, body);
  }
  if (buffer !== "") { segments.push({ text: buffer, cls: ansiClassJs(state) }); }
  return segments;
}

function stripAnsiJs(text) {
  var segments = ansiSegmentsJs(text);
  var out = "";
  for (var i = 0; i < segments.length; i++) { out += segments[i].text; }
  return out;
}

function toolArgsJs(args) {
  try {
    var parsed = JSON.parse(args);
    return parsed !== null && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

var TOOL_TARGET_KEYS = ["path", "command", "id", "pattern", "url", "name"];

function toolTargetJs(tool, args) {
  var parsed = toolArgsJs(args);
  if (parsed === null) { return String(args); }
  for (var i = 0; i < TOOL_TARGET_KEYS.length; i++) {
    var value = parsed[TOOL_TARGET_KEYS[i]];
    if (typeof value === "string" && value !== "") { return value; }
  }
  for (var key in parsed) {
    if (Object.prototype.hasOwnProperty.call(parsed, key) && typeof parsed[key] === "string") {
      return parsed[key];
    }
  }
  return "";
}

function countedJs(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

function toolLinesJs(output) {
  var rows = output.split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") { rows.pop(); }
  return rows;
}

function toolBodyJs(output) {
  var rows = output.split("\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") { rows.pop(); }
  return rows.join("\n");
}

function toolMetaJs(tool, rows, truncated) {
  if (tool === "list") { return countedJs(rows.length, "entry", "entries"); }
  if (tool === "grep") { return countedJs(rows.length, "match", "matches"); }
  var said = countedJs(rows.length, "line", "lines");
  return truncated ? said + ", truncated" : said;
}

function toolFactJs(tool, args, result) {
  var fact = { target: toolTargetJs(tool, args), meta: "", body: "" };
  if (result.running) {
    fact.meta = "running";
    return fact;
  }
  var output = stripAnsiJs(result.output === undefined ? "" : result.output);
  var rows = toolLinesJs(output);
  if (!result.ok) {
    var short = rows.length === 1 && rows[0].length <= VIEW_META_INLINE_MAX;
    fact.meta = short ? "failed: " + rows[0] : "failed";
    fact.body = short ? "" : toolBodyJs(result.output);
    return fact;
  }
  if (rows.length === 0) { fact.meta = "no output"; return fact; }
  if (rows.length === 1 && rows[0].length <= VIEW_META_INLINE_MAX) {
    fact.meta = rows[0];
    return fact;
  }
  if (tool === "run" && rows[0].indexOf("exit ") === 0) {
    fact.meta = rows[0] + ", " + countedJs(rows.length - 1, "line", "lines");
    fact.body = toolBodyJs(result.output.slice(result.output.indexOf("\n") + 1));
    return fact;
  }
  fact.meta = toolMetaJs(tool, rows, result.truncated === true);
  fact.body = toolBodyJs(result.output);
  return fact;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
  FRAMES_GENERATED_FROM,
  PROTOCOL_VERSION,
  SESSION_HELLO,
  TURN_START,
  TEXT_DELTA,
  TOOL_CALL,
  TOOL_RESULT,
  APPROVAL_REQUEST,
  TURN_END,
  ERROR_FRAME,
  INPUT_FRAME,
  CANCEL_FRAME,
  APPROVAL_REPLY_FRAME,
  APPROVAL_REPLY_RESULT,
  RESUME_FRAME,
  MODE_SET_FRAME,
  MODEL_SET_FRAME,
  NOTICE_FRAME,
  LEVEL_INFO,
  LEVEL_WARN,
  REASON_DONE,
  REASON_CANCELLED,
  REASON_ERROR,
  DECISION_ALLOW,
  DECISION_DENY,
  DECISION_ALWAYS,
  MODE_CHANGED,
  MODEL_CHANGED,
  TASKS_RESPONSE,
  DAEMON_STOPPING,
  SHARE_STARTED,
  SHARE_FAILED,
  APPROVAL_OPTION_ALLOW,
  APPROVAL_OPTION_ALWAYS,
  APPROVAL_OPTION_DENY,
  decodeFrame,
  diffLinesJs,
  diffCountsJs,
  diffableToolPathJs,
  renderFrameText,
  isKnownFrameType,
  isDaemonBroadcastType,
  encodeInputFrame,
  encodeCancelFrame,
  encodeApprovalReplyFrame,
  encodeResumeFrame,
  encodeModeSetFrame,
  encodeModelSetFrame,
  planToolOutputCollapseJs,
  TOOL_OUTPUT_COLLAPSE_HEAD_LINES,
  TOOL_OUTPUT_COLLAPSE_MIN_LINES,
  ansiSegmentsJs,
  stripAnsiJs,
  toolTargetJs,
  toolFactJs,
  };
}
