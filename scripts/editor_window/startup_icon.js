const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const INK = 96;
const ACTIVITY_STRIP = { left: 8, width: 32, top: 35, bottomMargin: 6 };
const TAB_ROW = { rightStart: 292, width: 132, top: 40, height: 30 };
const ACTIVITY_ICONS = { withJoule: 9, withoutJoule: 8 };
const SECONDARY_TABS_SETTLED = 2;
const SETTLE_MS = 180000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function grab() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "joule-bar-")), "bar.png");
  execFileSync("import", ["-window", "root", file], { stdio: ["ignore", "ignore", "pipe"] });
  return file;
}

function windowBox(file) {
  const out = execFileSync("identify", ["-format", "%@", file]).toString().trim();
  const m = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(out);
  if (m === null) { throw new Error("no window on the display to measure: identify said " + JSON.stringify(out)); }
  return { w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) };
}

function grayCrop(file, geometry) {
  const raw = execFileSync(
    "convert",
    [file, "-crop", geometry, "+repage", "-colorspace", "Gray", "-depth", "8", "pgm:-"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const header = /^P5\n(\d+) (\d+)\n255\n/.exec(raw.subarray(0, 32).toString("latin1"));
  if (header === null) { throw new Error("the crop did not come back as a raw 8-bit PGM"); }
  const w = Number(header[1]);
  const h = Number(header[2]);
  return { w, h, data: raw.subarray(header[0].length) };
}

function blobs(profile, mergeGap) {
  const found = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i <= profile.length; i++) {
    const inked = i < profile.length && profile[i];
    if (inked && start < 0) { start = i; gap = 0; continue; }
    if (inked) { gap = 0; continue; }
    if (start < 0) { continue; }
    gap += 1;
    if (gap > mergeGap || i === profile.length) {
      found.push({ start, end: i - gap });
      start = -1;
    }
  }
  return found;
}

function rowProfile(crop) {
  const rows = new Array(crop.h).fill(false);
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      if (crop.data[y * crop.w + x] > INK) { rows[y] = true; break; }
    }
  }
  return rows;
}

function columnProfile(crop) {
  const cols = new Array(crop.w).fill(false);
  for (let x = 0; x < crop.w; x++) {
    for (let y = 0; y < crop.h; y++) {
      if (crop.data[y * crop.w + x] > INK) { cols[x] = true; break; }
    }
  }
  return cols;
}

function activityBarIcons(file) {
  const box = windowBox(file);
  const geometry = ACTIVITY_STRIP.width + "x" + (box.h - ACTIVITY_STRIP.top - ACTIVITY_STRIP.bottomMargin)
    + "+" + (box.x + ACTIVITY_STRIP.left) + "+" + (box.y + ACTIVITY_STRIP.top);
  return blobs(rowProfile(grayCrop(file, geometry)), 4).length;
}

function secondaryBarTabs(file) {
  const box = windowBox(file);
  const geometry = TAB_ROW.width + "x" + TAB_ROW.height
    + "+" + (box.x + box.w - TAB_ROW.rightStart) + "+" + (box.y + TAB_ROW.top);
  return blobs(columnProfile(grayCrop(file, geometry)), 7).length;
}

function measure() {
  const file = grab();
  try {
    return { activityIcons: activityBarIcons(file), secondaryTabs: secondaryBarTabs(file) };
  } finally {
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
}

async function assertStartupIcons(kit) {
  const { ok, say } = kit;
  const vscode = require("vscode");
  const { supportsSecondarySidebar } = require("../../editor/src/placement.js");
  const ext = vscode.extensions.getExtension("joule-sh.joule-editor");
  ok(ext !== undefined, "the joule extension is present in this editor window");
  say("  nothing here activates the extension or opens the view; the bar has to carry the entry point on its own");
  const wantsSecondary = supportsSecondarySidebar(vscode.version);
  const deadline = Date.now() + SETTLE_MS;
  let seen = {};
  let settled = false;
  let logged = "";
  while (Date.now() < deadline && !settled) {
    try {
      seen = measure();
    } catch (e) {
      seen = { unreadable: String(e && e.message ? e.message : e).slice(0, 120) };
    }
    settled = wantsSecondary
      ? seen.secondaryTabs === SECONDARY_TABS_SETTLED && seen.activityIcons === ACTIVITY_ICONS.withoutJoule
      : seen.activityIcons === ACTIVITY_ICONS.withJoule;
    const line = "  the bars hold " + JSON.stringify(seen)
      + (ext.isActive ? ", extension activated" : ", extension not activated");
    if (line !== logged) { say(line); logged = line; }
    if (!settled) { await sleep(2000); }
  }
  if (wantsSecondary) {
    ok(settled, "the joule tab rendered in the secondary side bar strip and the activity bar holds only the editor's own "
      + ACTIVITY_ICONS.withoutJoule + " icons, without the view ever being opened");
  } else {
    ok(settled, "the joule container icon rendered in the activity bar, " + ACTIVITY_ICONS.withJoule
      + " icons where the editor's own are " + ACTIVITY_ICONS.withoutJoule + ", without the view ever being opened");
  }
}

module.exports = { measure, activityBarIcons, secondaryBarTabs, assertStartupIcons };

if (require.main === module) {
  const file = process.argv[2];
  console.log(JSON.stringify({ activityIcons: activityBarIcons(file), secondaryTabs: secondaryBarTabs(file) }));
}
