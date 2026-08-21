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
  "var __exports = { fixtureScript: fixtureScript, renderFrameText: renderFrameText, decodeFrame: decodeFrame };",
  sandbox
);
const { fixtureScript, renderFrameText, decodeFrame } = sandbox.__exports;

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

const approvalText = renderFrameText('{"v":1,"seq":1,"type":"approval.request","turnId":"t1","callId":"c1","tool":"run","summary":"run npm test","detail":"npm test"}', "");
expectContains(approvalText, "run npm test", "approval.request renders the summary");
expectContains(approvalText, "(y/n/a)", "approval.request renders the y/n/a marker (text-parity form; the live UI shows buttons instead)");

expectContains(
  renderFrameText('{"v":1,"seq":1,"type":"turn.end","turnId":"t1","reason":"cancelled"}', ""),
  "cancelled",
  "turn.end with reason cancelled renders a cancelled marker"
);

expectTrue(
  renderFrameText('{"v":1,"seq":1,"type":"some.future.thing","whatever":true}', "") === "",
  "an unknown frame type renders nothing rather than crashing"
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

console.log("");
if (failures > 0) {
  console.error(failures + " assertion(s) failed");
  process.exit(1);
}
console.log("all assertions passed, the web renderer describes the #8 fixture script the same way the terminal renderer does");
