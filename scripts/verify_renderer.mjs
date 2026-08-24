import fs from "node:fs";
import vm from "node:vm";

const path = new URL("../src/relay/web/page_js_frames.ts", import.meta.url);
const source = fs.readFileSync(path, "utf8");

const start = source.indexOf("`");
const end = source.lastIndexOf("`");
if (start < 0 || end <= start) {
  console.error("could not find the embedded template literal in page_js_frames.ts");
  process.exit(1);
}
const embeddedJs = source.slice(start + 1, end).replace(/\\\\/g, "\\");

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(embeddedJs, sandbox);
vm.runInContext(
  "var __exports = { fixtureScript: fixtureScript, renderFrameText: renderFrameText, decodeFrame: decodeFrame, planToolOutputCollapseJs: planToolOutputCollapseJs, TOOL_OUTPUT_COLLAPSE_HEAD_LINES: TOOL_OUTPUT_COLLAPSE_HEAD_LINES, TOOL_OUTPUT_COLLAPSE_MIN_LINES: TOOL_OUTPUT_COLLAPSE_MIN_LINES, isKnownFrameType: isKnownFrameType, noticeLineClass: noticeLineClass };",
  sandbox
);
const { fixtureScript, renderFrameText, decodeFrame, planToolOutputCollapseJs, TOOL_OUTPUT_COLLAPSE_HEAD_LINES, TOOL_OUTPUT_COLLAPSE_MIN_LINES, isKnownFrameType, noticeLineClass } = sandbox.__exports;

let failures = 0;
function expectContains(haystack, needle, label) {
  if (haystack.indexOf(needle) < 0) {
    failures += 1;
    console.error("FAIL: " + label + " -- expected to find " + JSON.stringify(needle));
  } else {
    console.log("ok: " + label);
  }
}
function expectTrue(cond, label) {
  if (!cond) {
    failures += 1;
    console.error("FAIL: " + label);
  } else {
    console.log("ok: " + label);
  }
}

function frameKindOf(frameJson) {
  const f = decodeFrame(frameJson);
  return f === null ? "" : f.type;
}

const script = fixtureScript();
let out = "";
let prevKind = "";
for (const frame of script) {
  out += renderFrameText(frame, prevKind);
  prevKind = frameKindOf(frame);
}
expectContains(out, "No health route yet", "the fixture script renders into an expected transcript (text.delta)");
expectContains(out, "-> write src/routes/health.ts", "the fixture script renders into an expected transcript (tool.call write)");
expectContains(out, "ok: wrote 12 lines", "the fixture script renders into an expected transcript (tool.result write)");
expectContains(out, "-> run npm test", "the fixture script renders into an expected transcript (tool.call run)");
expectContains(out, "ok: 2 passed, 0 failed", "the fixture script renders into an expected transcript (tool.result run)");

expectTrue(renderFrameText(script[0], "") === "", "turn.start renders nothing on its own");

expectContains(
  renderFrameText('{"v":1,"seq":1,"type":"tool.result","turnId":"t1","callId":"c1","ok":false,"output":"permission denied","truncated":false}', ""),
  "failed: permission denied",
  "a failed tool.result renders its status as failed"
);

expectContains(
  renderFrameText('{"v":1,"seq":1,"type":"tool.result","turnId":"t1","callId":"c1","ok":true,"output":"lots","truncated":true}', ""),
  "(truncated)",
  "a truncated tool.result says so"
);

const approvalText = renderFrameText('{"v":1,"seq":1,"type":"approval.request","turnId":"t1","callId":"c1","tool":"run","summary":"run npm test","detail":"npm test","args":"{\\"command\\":\\"npm test\\"}"}', "");
expectContains(approvalText, "run npm test", "approval.request renders the summary");
expectContains(approvalText, "1. Yes", "approval.request renders option 1 of the decision list (#88)");
expectContains(approvalText, "2. Yes, and don't ask again for run this session", "approval.request names the tool in option 2 of the decision list (#88)");
expectContains(approvalText, "3. No", "approval.request renders option 3 of the decision list (#88)");

expectContains(
  renderFrameText('{"v":1,"seq":1,"type":"turn.end","turnId":"t1","reason":"cancelled"}', ""),
  "cancelled",
  "turn.end with reason cancelled renders a cancelled marker"
);

expectTrue(
  renderFrameText('{"v":1,"seq":1,"type":"some.future.thing","whatever":true}', "") === "",
  "an unknown frame type renders nothing rather than crashing"
);

// #136: a losing approval reply is told so, and this renderer is the half that
// used to print "unrenderable frame" at a browser while the terminal said it.
const lateReply = '{"v":1,"seq":9,"type":"approval.reply.result","callId":"c1","applied":false,"decision":"allow"}';
expectContains(
  renderFrameText(lateReply, ""),
  "already decided: allow",
  "approval.reply.result says which decision won (#136)"
);
expectTrue(
  isKnownFrameType("approval.reply.result"),
  "approval.reply.result is a frame type this renderer claims to know (#136)"
);

// #192: connection lifecycle is a notice with a severity, not an error. Both
// renderers have to agree on what each level looks like, or the same event is
// a red alarm in one place and a quiet line in the other.
const warnNotice = '{"v":1,"seq":1,"type":"notice","code":"relay.unreachable","level":"warn","message":"cannot reach the relay (closed), still retrying"}';
const infoNotice = '{"v":1,"seq":2,"type":"notice","code":"relay.attached","level":"info","message":"connected to the relay"}';
expectContains(
  renderFrameText(warnNotice, ""),
  "! cannot reach the relay",
  "a warning notice carries the ! marker (#192)"
);
expectTrue(
  renderFrameText(warnNotice, "").indexOf("relay.unreachable") < 0,
  "a notice renders its message, not its code (#192)"
);
expectTrue(
  renderFrameText(infoNotice, "").indexOf("!") < 0,
  "an informational notice carries no error marker at all (#192)"
);
expectContains(
  renderFrameText(infoNotice, ""),
  "connected to the relay",
  "an informational notice still renders its message (#192)"
);
expectTrue(
  isKnownFrameType("notice"),
  "notice is a frame type this renderer claims to know, so it is never a placeholder (#192)"
);
expectTrue(
  noticeLineClass("warn") === "line-warn" && noticeLineClass("info") === "line-notice",
  "the page styles the two notice levels apart, as the terminal does (#192)"
);

expectTrue(
  renderFrameText("not json at all", "") === "",
  "a malformed frame renders nothing rather than crashing"
);

const toolResultFrame = "{\"v\":1,\"seq\":1,\"type\":\"tool.result\",\"turnId\":\"t1\",\"callId\":\"c1\",\"ok\":true,\"output\":\"003-transport\",\"truncated\":false}";
const resumedDeltaFrame = "{\"v\":1,\"seq\":2,\"type\":\"text.delta\",\"turnId\":\"t1\",\"text\":\"Here's the project structure:\"}";
const resumedOut = renderFrameText(toolResultFrame, "") + renderFrameText(resumedDeltaFrame, frameKindOf(toolResultFrame));
expectContains(resumedOut, "003-transport\nHere's the project structure:", "a text.delta right after a tool.result gets a separating newline");

const firstDeltaFrame = "{\"v\":1,\"seq\":1,\"type\":\"text.delta\",\"turnId\":\"t1\",\"text\":\"No health route yet. \"}";
const secondDeltaFrame = "{\"v\":1,\"seq\":2,\"type\":\"text.delta\",\"turnId\":\"t1\",\"text\":\"I'll add GET /health.\"}";
const streamedOut = renderFrameText(firstDeltaFrame, "text.delta") + renderFrameText(secondDeltaFrame, frameKindOf(firstDeltaFrame));
expectTrue(streamedOut === "No health route yet. I'll add GET /health.", "two consecutive text.delta frames do not get a newline inserted between them");

const ESC = String.fromCharCode(27);
const ANSI_RESET = ESC + "[0m";
const ANSI_RED = ESC + "[38;2;229;72;77m";
const ANSI_GREEN = ESC + "[38;2;110;190;115m";
const ANSI_DIM = ESC + "[38;2;120;120;125m";
const ANSI_REVERSE = ESC + "[7m";

function toolCallFrame(tool, args) {
  return JSON.stringify({ v: 1, seq: 1, type: "tool.call", turnId: "t1", callId: "c1", tool: tool, args: JSON.stringify(args) });
}

const editDiffOut = renderFrameText(toolCallFrame("edit", { path: "src/a.ts", old_text: "const x = 1;", new_text: "const x = 2;" }), "");
expectContains(editDiffOut, "-> edit src/a.ts", "an edit tool.call renders the path (#68 diff rendering)");
expectContains(editDiffOut, ANSI_RED + "- const x = 1;", "an edit tool.call renders a red removed line (#68 diff rendering)");
expectContains(editDiffOut, ANSI_GREEN + "+ const x = 2;", "an edit tool.call renders a green added line (#68 diff rendering)");

const writeDiffOut = renderFrameText(toolCallFrame("write", { path: "src/new.ts", content: "line one\nline two" }), "");
expectContains(writeDiffOut, "-> write src/new.ts", "a write tool.call renders the path (#68 diff rendering)");
expectContains(writeDiffOut, ANSI_GREEN + "+ line one", "a write tool.call renders green added lines against empty old text (#68 diff rendering)");
expectContains(writeDiffOut, ANSI_GREEN + "+ line two", "a write tool.call renders every added line (#68 diff rendering)");

const noopEditOut = renderFrameText(toolCallFrame("edit", { path: "src/same.ts", old_text: "same", new_text: "same" }), "");
expectTrue(noopEditOut === "\n  -> edit src/same.ts", "an edit tool.call with unchanged text renders the path but no diff body (#68 diff rendering)");

let bigContent = "";
for (let i = 0; i < 500; i++) {
  if (i > 0) { bigContent += "\n"; }
  bigContent += "line " + i;
}
const bigDiffOut = renderFrameText(toolCallFrame("write", { path: "src/big.ts", content: bigContent }), "");
expectTrue(bigDiffOut === "\n  -> write src/big.ts", "a diff larger than the terminal display cap falls back to the plain summary line (#68 diff rendering)");

function approvalRequestFrame(tool, summary, args) {
  const argsJson = JSON.stringify(args);
  return JSON.stringify({ v: 1, seq: 1, type: "approval.request", turnId: "t1", callId: "c1", tool: tool, summary: summary, detail: argsJson, args: argsJson });
}

const editApprovalOut = renderFrameText(approvalRequestFrame("edit", "edit src/a.ts", { path: "src/a.ts", old_text: "const x = 1;", new_text: "const x = 2;" }), "");
expectContains(editApprovalOut, ANSI_RED + "- const x = 1;", "an edit approval.request renders a red removed line before the decision (#69 approval diff)");
expectContains(editApprovalOut, ANSI_GREEN + "+ const x = 2;", "an edit approval.request renders a green added line before the decision (#69 approval diff)");
expectTrue(
  editApprovalOut.indexOf(ANSI_RED + "- const x = 1;") < editApprovalOut.indexOf("1. Yes"),
  "an edit approval.request shows the diff above the decision option list (#69 approval diff, #88 option list)"
);

const writeApprovalOut = renderFrameText(approvalRequestFrame("write", "write src/new.ts", { path: "src/new.ts", content: "line one\nline two" }), "");
expectContains(writeApprovalOut, ANSI_GREEN + "+ line one", "a write approval.request renders a green added line before the decision (#69 approval diff)");
expectTrue(
  writeApprovalOut.indexOf(ANSI_GREEN + "+ line one") < writeApprovalOut.indexOf("1. Yes"),
  "a write approval.request shows the diff above the decision option list (#69 approval diff, #88 option list)"
);

const runApprovalOut = renderFrameText(approvalRequestFrame("run", "run npm test", { command: "npm test" }), "");
expectTrue(runApprovalOut.indexOf(ANSI_GREEN) < 0 && runApprovalOut.indexOf(ANSI_RED) < 0, "a run approval.request renders no diff, scope stays write/edit only (#69 approval diff)");
expectContains(runApprovalOut, "1. Yes", "a run approval.request still renders the plain decision option list (#69 approval diff)");

// #88: the option list is one row per decision, the first highlighted by
// default, the rest dim. The web UI answers with buttons rather than arrow
// keys, so only the rendered shape is mirrored here.
expectContains(runApprovalOut, "\n    " + ANSI_REVERSE + "> 1. Yes" + ANSI_RESET, "the first option is highlighted by default, on its own row (#88)");
expectContains(runApprovalOut, "\n    " + ANSI_DIM + "  2. Yes, and don't ask again for run this session" + ANSI_RESET, "the always option is dim and names the tool, on its own row (#88)");
expectContains(runApprovalOut, "\n    " + ANSI_DIM + "  3. No" + ANSI_RESET, "the deny option is dim, on its own row (#88)");
expectTrue(
  runApprovalOut.indexOf("1. Yes") < runApprovalOut.indexOf("2. Yes, and") && runApprovalOut.indexOf("2. Yes, and") < runApprovalOut.indexOf("3. No"),
  "the options render in list order, allow then always then deny (#88)"
);
expectTrue(
  runApprovalOut.split("\n").filter((line) => line.indexOf(ANSI_REVERSE) >= 0).length === 1,
  "exactly one option row is highlighted at a time (#88)"
);

const COLLAPSE_HEAD_LINES = 6;
const COLLAPSE_MIN_LINES = 10;

function outputOfLines(n) {
  const rows = [];
  for (let i = 0; i < n; i++) { rows.push("line " + i); }
  return rows.join("\n");
}

expectTrue(
  TOOL_OUTPUT_COLLAPSE_HEAD_LINES === COLLAPSE_HEAD_LINES && TOOL_OUTPUT_COLLAPSE_MIN_LINES === COLLAPSE_MIN_LINES,
  "the web page uses the same collapse head and threshold as the terminal (#94 collapse policy)"
);

expectTrue(
  planToolOutputCollapseJs(outputOfLines(COLLAPSE_MIN_LINES)).hidden === 0,
  "output at the threshold is not collapsed on the web either (#94 collapse policy)"
);

const webPlan = planToolOutputCollapseJs(outputOfLines(50));
expectTrue(
  webPlan.hidden === 50 - COLLAPSE_HEAD_LINES,
  "the web page hides the same number of lines the terminal marker counts (#94 collapse policy)"
);
expectTrue(
  webPlan.head.split("\n").length === COLLAPSE_HEAD_LINES && webPlan.head.split("\n")[0] === "line 0",
  "the web page keeps the same head as the terminal shows above its marker (#94 collapse policy)"
);
expectTrue(
  webPlan.head + "\n" + webPlan.body === outputOfLines(50),
  "the web disclosure holds the whole output, split rather than truncated (#94 collapse policy)"
);

const clientPath = new URL("../src/relay/web/page_js_client.ts", import.meta.url);
const clientSource = fs.readFileSync(clientPath, "utf8");
expectTrue(
  clientSource.indexOf("createElement(\"details\")") >= 0 && clientSource.indexOf("createElement(\"summary\")") >= 0,
  "the web page expands long tool output with a native disclosure element rather than a keybinding (#94 web parity)"
);
expectTrue(
  renderFrameText('{"v":1,"seq":1,"type":"tool.result","turnId":"t1","callId":"c1","ok":true,"output":"' + outputOfLines(50).replace(/\n/g, "\\n") + '","truncated":false}', "").indexOf("line 49") >= 0,
  "the shared text renderer still describes the whole output, collapsing is a presentation choice (#94 web parity)"
);

const mdPath = new URL("../src/relay/web/page_js_markdown.ts", import.meta.url);
const mdSource = fs.readFileSync(mdPath, "utf8");
const mdStart = mdSource.indexOf("`");
const mdEnd = mdSource.lastIndexOf("`");
if (mdStart < 0 || mdEnd <= mdStart) {
  console.error("could not find the embedded template literal in page_js_markdown.ts");
  process.exit(1);
}
const embeddedMdJs = mdSource.slice(mdStart + 1, mdEnd).replace(/\\\\/g, "\\");

const mdSandbox = {};
vm.createContext(mdSandbox);
vm.runInContext(embeddedMdJs, mdSandbox);
vm.runInContext(
  "var __mdExports = { mdTokenizeInline: mdTokenizeInline, mdFindCodeSpans: mdFindCodeSpans, mdHeaderLevel: mdHeaderLevel, mdIsFenceLine: mdIsFenceLine };",
  mdSandbox
);
const { mdTokenizeInline, mdFindCodeSpans, mdHeaderLevel, mdIsFenceLine } = mdSandbox.__mdExports;

function mdTokenText(tok) {
  if (typeof tok.text === "string") { return tok.text; }
  return mdPlainText(tok.children);
}

function mdPlainText(tokens) {
  let out = "";
  for (const tok of tokens) { out += mdTokenText(tok); }
  return out;
}

function mdCollect(tokens, kind) {
  let found = [];
  for (const tok of tokens) {
    if (tok.type === kind) { found.push(mdTokenText(tok)); }
    if (tok.children) { found = found.concat(mdCollect(tok.children, kind)); }
  }
  return found;
}

const boldTokens = mdTokenizeInline("this is **bold** text");
expectTrue(
  mdCollect(boldTokens, "bold").indexOf("bold") >= 0,
  "the web markdown tokenizer finds a bold span (#81 markdown rendering)"
);

const italicTokens = mdTokenizeInline("look at _this word_ closely");
expectTrue(
  mdCollect(italicTokens, "italic").indexOf("this word") >= 0,
  "the web markdown tokenizer finds an italic span (#81 markdown rendering)"
);

const snakeCaseTokens = mdTokenizeInline("call my_function_name here");
expectTrue(
  mdCollect(snakeCaseTokens, "italic").length === 0 && mdPlainText(snakeCaseTokens) === "call my_function_name here",
  "the web markdown tokenizer leaves snake_case identifiers alone, same as the terminal (#81 markdown rendering)"
);

const codeSpans = mdTokenizeInline("run `a**b**c` now");
expectTrue(
  mdCollect(codeSpans, "code").indexOf("a**b**c") >= 0 && mdCollect(codeSpans, "bold").length === 0,
  "the web markdown tokenizer protects inline code spans from emphasis markers, same as the terminal (#81 markdown rendering)"
);

const reportedLine = "- **`.githooks`, `.github`** — CI / git hook tooling";
const reportedTokens = mdTokenizeInline(reportedLine);
expectTrue(
  mdCollect(reportedTokens, "bold").length === 1,
  "the web markdown tokenizer matches a bold span across the inline code it wraps (#100 bold around code)"
);
expectTrue(
  mdCollect(reportedTokens, "code").join("|") === ".githooks|.github",
  "the bold span keeps both inline code spans inside it as code, same as the terminal (#100 bold around code)"
);
expectTrue(
  mdPlainText(reportedTokens) === "- .githooks, .github — CI / git hook tooling",
  "the reported line renders with no literal bold markers left in the text, em dash intact (#100 bold around code)"
);

const boldAroundOneSpan = mdTokenizeInline("the **`--force`** flag");
expectTrue(
  mdCollect(boldAroundOneSpan, "bold").indexOf("--force") >= 0 && mdCollect(boldAroundOneSpan, "code").indexOf("--force") >= 0,
  "bold enclosing a single inline code span keeps both the bold and the code, same as the terminal (#100 bold around code)"
);

const italicAroundSpan = mdTokenizeInline("see _the `flag` here_ please");
expectTrue(
  mdCollect(italicAroundSpan, "italic").indexOf("the flag here") >= 0 && mdCollect(italicAroundSpan, "code").indexOf("flag") >= 0,
  "italic enclosing an inline code span keeps both the italic and the code, same as the terminal (#100 bold around code)"
);

const literalMarkers = mdTokenizeInline("write `**x**` verbatim");
expectTrue(
  mdCollect(literalMarkers, "code").indexOf("**x**") >= 0 && mdCollect(literalMarkers, "bold").length === 0,
  "asterisks inside a code span stay literal rather than opening a bold span (#100 bold around code)"
);

const partnerInsideCode = mdTokenizeInline("**start `**` end");
expectTrue(
  mdCollect(partnerInsideCode, "bold").length === 0 && mdCollect(partnerInsideCode, "code").indexOf("**") >= 0,
  "a bold marker whose only partner sits inside a code span stays literal (#100 bold around code)"
);

const boldOuter = mdTokenizeInline("**bold with _italic_ inside**");
expectTrue(
  mdCollect(boldOuter, "bold").length === 1 && mdCollect(boldOuter, "italic").indexOf("italic") >= 0,
  "italic nested inside bold renders as both, same as the terminal (#100 bold around code)"
);

const italicOuter = mdTokenizeInline("_italic with **bold** inside_");
expectTrue(
  mdCollect(italicOuter, "italic").length === 1 && mdCollect(italicOuter, "bold").indexOf("bold") >= 0,
  "bold nested inside italic renders as both, same as the terminal (#100 bold around code)"
);

const adjacent = mdTokenizeInline("**one**`mid`**two**");
expectTrue(
  mdCollect(adjacent, "bold").join("|") === "one|two" && mdCollect(adjacent, "code").indexOf("mid") >= 0,
  "adjacent bold spans with a code span between them each tokenize independently (#100 bold around code)"
);

const unmatchedBold = mdTokenizeInline("2 ** 3 is not bold");
expectTrue(
  mdCollect(unmatchedBold, "bold").length === 0 && mdPlainText(unmatchedBold) === "2 ** 3 is not bold",
  "an unmatched bold marker passes through as literal text, same as the terminal (#100 bold around code)"
);

const unmatchedAroundCode = mdTokenizeInline("**unclosed `code` here");
expectTrue(
  mdCollect(unmatchedAroundCode, "bold").length === 0 && mdCollect(unmatchedAroundCode, "code").indexOf("code") >= 0,
  "an unmatched bold marker still lets the code span inside it render as code (#100 bold around code)"
);

const unmatchedBacktick = mdTokenizeInline("a lone " + String.fromCharCode(96) + " backtick");
expectTrue(
  mdCollect(unmatchedBacktick, "code").length === 0 && mdPlainText(unmatchedBacktick) === "a lone " + String.fromCharCode(96) + " backtick",
  "an unmatched backtick passes through as literal text, same as the terminal (#100 bold around code)"
);

const snakeInsideEmphasis = mdTokenizeInline("**call my_function_name now**");
expectTrue(
  mdCollect(snakeInsideEmphasis, "italic").length === 0 && mdCollect(snakeInsideEmphasis, "bold").indexOf("call my_function_name now") >= 0,
  "snake_case inside a bold span is still not italic, same as the terminal (#100 bold around code)"
);

const snakeInsideCode = mdTokenizeInline("**`my_function_name`**");
expectTrue(
  mdCollect(snakeInsideCode, "italic").length === 0 && mdCollect(snakeInsideCode, "code").indexOf("my_function_name") >= 0,
  "snake_case inside code wrapped in bold stays code, same as the terminal (#100 bold around code)"
);

expectTrue(
  mdFindCodeSpans("a `b` c `d` e").length === 2,
  "the web markdown tokenizer locates every code span range before matching emphasis (#100 bold around code)"
);

expectTrue(mdHeaderLevel("# Section Title") === 1, "the web markdown tokenizer recognizes an h1 header (#81 markdown rendering)");
expectTrue(mdHeaderLevel("### Sub heading") === 3, "the web markdown tokenizer recognizes an h3 header (#81 markdown rendering)");
expectTrue(mdHeaderLevel("#no-space") === 0, "a hash with no following space is not a header, same as the terminal (#81 markdown rendering)");

expectTrue(mdIsFenceLine("```"), "the web markdown tokenizer recognizes a fenced code block delimiter (#81 markdown rendering)");
expectTrue(mdIsFenceLine("```ts"), "a fence line with a language tag still counts as a fence (#81 markdown rendering)");
expectTrue(!mdIsFenceLine("plain text"), "a plain line is not mistaken for a fence (#81 markdown rendering)");

const viewPath = new URL("../src/relay/web/page_js_view.ts", import.meta.url);
const viewSource = fs.readFileSync(viewPath, "utf8");
const viewStart = viewSource.indexOf("`");
const viewEnd = viewSource.lastIndexOf("`");
if (viewStart < 0 || viewEnd <= viewStart) {
  console.error("could not find the embedded template literal in page_js_view.ts");
  process.exit(1);
}
const viewSandbox = {};
vm.createContext(viewSandbox);
vm.runInContext(viewSource.slice(viewStart + 1, viewEnd).replace(/\\\\/g, "\\"), viewSandbox);
vm.runInContext(
  "var __exports = { ansiSegmentsJs: ansiSegmentsJs, stripAnsiJs: stripAnsiJs, toolTargetJs: toolTargetJs, toolFactJs: toolFactJs };",
  viewSandbox
);
const { ansiSegmentsJs, stripAnsiJs, toolTargetJs, toolFactJs } = viewSandbox.__exports;

function segmentClass(text, needle) {
  for (const segment of ansiSegmentsJs(text)) {
    if (segment.text.indexOf(needle) >= 0) { return segment.cls; }
  }
  return "";
}

const watcherLine = ESC + "[33m[nodemon]" + ESC + "[39m 3.1.14";
expectTrue(
  stripAnsiJs(watcherLine) === "[nodemon] 3.1.14",
  "an escape sequence leaves the text it was colouring and nothing else (#226)"
);
expectTrue(
  segmentClass(watcherLine, "[nodemon]") === "ansi-fg-3",
  "the yellow a watcher asks for becomes a class a theme can colour (#226)"
);
expectTrue(
  segmentClass(ESC + "[92mpassed", "passed") === "ansi-fg-10",
  "a bright colour is the bright half of the palette, not the plain one (#226)"
);
expectTrue(
  segmentClass(ESC + "[1;4;31mFAIL", "FAIL") === "ansi-fg-1 ansi-bold ansi-underline",
  "attributes and a colour in one sequence all survive (#226)"
);
expectTrue(
  segmentClass(ESC + "[38;5;196mred", "red") === "ansi-fg-9" && segmentClass(ANSI_RED + "red", "red") === "ansi-fg-9",
  "a 256-colour and a truecolour red both land on the nearest palette entry rather than being dropped (#226)"
);
expectTrue(
  stripAnsiJs(ESC + "[2K" + ESC + "[1Gprogress") === "progress" && stripAnsiJs(ESC + "]0;a title" + String.fromCharCode(7) + "done") === "done",
  "cursor moves and window titles are removed rather than printed as text (#226)"
);
expectTrue(
  stripAnsiJs("one\r\ntwo\rthree") === "one\ntwothree",
  "a carriage return does not survive into the page as a character (#226)"
);

const readFact = toolFactJs("read", JSON.stringify({ path: "server.js" }), { ok: true, output: "a\nb\nc\n", truncated: false });
expectTrue(
  readFact.target === "server.js" && readFact.meta === "3 lines",
  "a read is the file it read and how much came back, not the json it was called with (#236)"
);
expectTrue(
  readFact.body === "a\nb\nc",
  "the body it offers is what the tool returned, without the empty line a trailing newline leaves (#236)"
);
expectTrue(
  toolFactJs("run", JSON.stringify({ command: "npm test" }), { ok: true, output: "exit 0\n2 passed\n0 failed", truncated: false }).meta === "exit 0, 2 lines",
  "a run is how it ended and how much it printed (#236)"
);
expectTrue(
  toolFactJs("write", JSON.stringify({ path: "a.ts" }), { ok: true, output: "wrote 12 bytes to a.ts", truncated: false }).body === "",
  "a one-line result is the row itself and gets no block under it (#236)"
);
expectTrue(
  toolFactJs("list", JSON.stringify({ path: "src" }), { ok: true, output: "a.ts\nb.ts\nc.ts", truncated: false }).meta === "3 entries",
  "a listing counts entries rather than lines (#236)"
);
expectTrue(
  toolFactJs("read", JSON.stringify({ path: "big.ts" }), { ok: true, output: "a\nb", truncated: true }).meta === "2 lines, truncated",
  "a truncated result still says so (#236)"
);
expectTrue(
  toolFactJs("run", JSON.stringify({ command: "false" }), { ok: false, output: "no such file", truncated: false }).meta === "failed: no such file",
  "a failure that fits on the row stays on the row (#236)"
);
expectTrue(
  toolFactJs("run", JSON.stringify({ command: "sleep 1" }), { running: true, ok: false, output: "" }).meta === "running",
  "a call still in flight says that much and no more (#236)"
);
expectTrue(
  toolTargetJs("task_status", JSON.stringify({ id: "bgrun-2" })) === "bgrun-2"
    && toolTargetJs("odd", "not json at all") === "not json at all",
  "every tool has something better to show than its arguments, and an unparsable one is left alone (#236)"
);

console.log("");
if (failures > 0) {
  console.error(failures + " assertion(s) failed");
  process.exit(1);
}
console.log("all assertions passed, the web renderer describes the #8 fixture script the same way the terminal renderer does, and the web markdown tokenizer (#81) parses the same structure the terminal's markdown.ts does");
