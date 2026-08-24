import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(ROOT, "src", "approval", "gate.ts");
const WELCOME = path.join(ROOT, "src", "terminal", "welcome.ts");
const MODES = path.join(ROOT, "editor", "src", "modes.js");

let failures = 0;

function ok(condition, label) {
  if (condition) {
    console.log("ok: " + label);
    return;
  }
  console.error("FAIL: " + label);
  failures += 1;
}

function gateModes(text) {
  const out = new Map();
  const re = /export const (MODE_[A-Z_]+): string = "([^"]+)";/g;
  let match = re.exec(text);
  while (match !== null) {
    out.set(match[1], match[2]);
    match = re.exec(text);
  }
  return out;
}

function terminalPermissions(text, names) {
  const out = new Map();
  const re = /if \(mode == (MODE_[A-Z_]+)\) \{ return "([^"]*)"; \}/g;
  let match = re.exec(text);
  while (match !== null) {
    const mode = names.get(match[1]);
    if (mode !== undefined) { out.set(mode, match[2]); }
    match = re.exec(text);
  }
  return out;
}

const names = gateModes(fs.readFileSync(GATE, "utf8"));
const permits = terminalPermissions(fs.readFileSync(WELCOME, "utf8"), names);
const modes = (await import(pathToFileURL(MODES).href)).default;

ok(names.size > 0, "the gate still declares its approval modes where this check reads them");
ok(permits.size === names.size, "the terminal still gives every gate mode a sentence about what may run");

const panel = new Map(modes.APPROVAL_MODES.map((m) => [m.mode, m.permits]));
ok(panel.size === names.size,
  "the panel offers exactly the modes the gate accepts (" + [...names.values()].join(", ") + ")");

for (const mode of names.values()) {
  ok(panel.has(mode), "the panel offers the " + mode + " mode the gate accepts");
  ok(panel.get(mode) === permits.get(mode),
    "the panel says what " + mode + " may run in the terminal's words: " + JSON.stringify(permits.get(mode)));
}

for (const mode of panel.keys()) {
  ok(names.has(mode) || [...names.values()].includes(mode),
    "the panel invents no mode of its own: " + mode);
}

if (failures > 0) {
  console.error(failures + " check(s) failed: editor/src/modes.js has drifted from the modes the daemon enforces.");
  process.exit(1);
}
console.log("ok: the panel's approval modes match the gate and the terminal");
