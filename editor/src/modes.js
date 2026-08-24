var MODES_GENERATED_FROM = "src/approval/gate.ts and src/terminal/welcome.ts";

var MODE_READ_ONLY = "read-only";
var MODE_AUTO_EDIT = "auto-edit";
var MODE_SAFE_AUTO = "safe-auto";
var MODE_FULL_AUTO = "full-auto";
var MODE_PLAN = "plan";

var APPROVAL_MODES = [
  { mode: MODE_READ_ONLY, permits: "reads, never writes or runs" },
  { mode: MODE_AUTO_EDIT, permits: "reads and edits, asks to run" },
  { mode: MODE_SAFE_AUTO, permits: "commands run unattended" },
  { mode: MODE_FULL_AUTO, permits: "everything runs unattended" },
  { mode: MODE_PLAN, permits: "read-only, proposes then asks" },
];

function permissionText(mode) {
  for (var i = 0; i < APPROVAL_MODES.length; i++) {
    if (APPROVAL_MODES[i].mode === mode) { return APPROVAL_MODES[i].permits; }
  }
  return "";
}

function isKnownMode(mode) {
  return permissionText(mode) !== "";
}

function modeNames() {
  var out = [];
  for (var i = 0; i < APPROVAL_MODES.length; i++) { out.push(APPROVAL_MODES[i].mode); }
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MODES_GENERATED_FROM,
    MODE_READ_ONLY,
    MODE_AUTO_EDIT,
    MODE_SAFE_AUTO,
    MODE_FULL_AUTO,
    MODE_PLAN,
    APPROVAL_MODES,
    permissionText,
    isKnownMode,
    modeNames,
  };
}
