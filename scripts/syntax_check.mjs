import fs from "node:fs";
import vm from "node:vm";

const files = [
  "src/relay/web/page_js_frames.ts",
  "src/relay/web/page_js_client.ts",
];

let failed = false;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf("`");
  const end = src.lastIndexOf("`");
  const js = src.slice(start + 1, end);
  try {
    new vm.Script(js, { filename: file });
    console.log("syntax ok: " + file + " (" + js.length + " chars)");
  } catch (e) {
    failed = true;
    console.error("SYNTAX ERROR in " + file + ": " + e.message);
  }
}
if (failed) { process.exit(1); }
