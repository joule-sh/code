import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_REL = "src/relay/web/page_js_frames.ts";
const TARGET_REL = "editor/src/frames.js";
const SOURCE = path.join(ROOT, SOURCE_REL);
const TARGET = path.join(ROOT, TARGET_REL);

const EXPORTED = [
  "FRAMES_GENERATED_FROM",
  "PROTOCOL_VERSION",
  "SESSION_HELLO",
  "TURN_START",
  "TEXT_DELTA",
  "TOOL_CALL",
  "TOOL_RESULT",
  "APPROVAL_REQUEST",
  "TURN_END",
  "ERROR_FRAME",
  "INPUT_FRAME",
  "CANCEL_FRAME",
  "APPROVAL_REPLY_FRAME",
  "APPROVAL_REPLY_RESULT",
  "RESUME_FRAME",
  "REASON_DONE",
  "REASON_CANCELLED",
  "REASON_ERROR",
  "DECISION_ALLOW",
  "DECISION_DENY",
  "DECISION_ALWAYS",
  "APPROVAL_OPTION_ALLOW",
  "APPROVAL_OPTION_ALWAYS",
  "APPROVAL_OPTION_DENY",
  "decodeFrame",
  "diffLinesJs",
  "diffCountsJs",
  "diffableToolPathJs",
  "renderFrameText",
  "isKnownFrameType",
  "encodeInputFrame",
  "encodeCancelFrame",
  "encodeApprovalReplyFrame",
  "encodeResumeFrame",
];

function templateBody(text) {
  const open = text.indexOf("`");
  const close = text.lastIndexOf("`");
  if (open < 0 || close <= open) {
    throw new Error("no template literal found in " + SOURCE_REL);
  }
  const raw = text.slice(open + 1, close);
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\") { out += c; continue; }
    const next = raw[i + 1];
    if (next === "\\" || next === "`" || next === "$") { out += next; i += 1; continue; }
    out += c;
  }
  return out;
}

function render() {
  const body = templateBody(fs.readFileSync(SOURCE, "utf8"));
  const head = `var FRAMES_GENERATED_FROM = ${JSON.stringify(SOURCE_REL)};\n`;
  const names = EXPORTED.map((n) => "  " + n).join(",\n");
  const foot = `\nif (typeof module !== "undefined" && module.exports) {\n  module.exports = {\n${names},\n  };\n}\n`;
  return head + body.replace(/^\n+/, "\n") + foot;
}

function main() {
  const wanted = render();
  const check = process.argv.includes("--check");
  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8") : "";
  if (check) {
    if (current !== wanted) {
      console.error(`FAIL: ${TARGET_REL} is out of sync with ${SOURCE_REL}. Run "make editor-frames" and commit the result.`);
      process.exitCode = 1;
      return;
    }
    console.log(`ok: ${TARGET_REL} matches ${SOURCE_REL}`);
    return;
  }
  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, wanted);
  console.log(`wrote ${TARGET_REL} from ${SOURCE_REL}`);
}

main();
