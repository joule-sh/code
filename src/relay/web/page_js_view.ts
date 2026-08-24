export const PAGE_JS_VIEW: string = `
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
    if (text.charAt(i) === VIEW_ESC && text.charAt(i + 1) === "\\\\") { return i + 2; }
    i += 1;
  }
  return i;
}

function ansiSegmentsJs(text) {
  var source = String(text).split("\\r\\n").join("\\n").split("\\r").join("");
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
  var rows = output.split("\\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") { rows.pop(); }
  return rows;
}

function toolBodyJs(output) {
  var rows = output.split("\\n");
  while (rows.length > 0 && rows[rows.length - 1] === "") { rows.pop(); }
  return rows.join("\\n");
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
    fact.body = toolBodyJs(result.output.slice(result.output.indexOf("\\n") + 1));
    return fact;
  }
  fact.meta = toolMetaJs(tool, rows, result.truncated === true);
  fact.body = toolBodyJs(result.output);
  return fact;
}
`;
