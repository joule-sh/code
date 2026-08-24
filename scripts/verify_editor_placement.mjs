import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const placement = require(path.join(ROOT, "editor", "src", "placement.js"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "editor", "package.json"), "utf8"));

let failures = 0;

function ok(condition, label) {
  if (condition) {
    console.log("ok: " + label);
    return;
  }
  console.error("FAIL: " + label);
  failures += 1;
}

function whenIsTrue(clause, context) {
  const negated = clause.startsWith("!");
  const key = negated ? clause.slice(1) : clause;
  if (!/^[\w.]+$/.test(key)) {
    throw new Error("a when clause this check cannot read: " + JSON.stringify(clause));
  }
  const value = context[key] === true;
  return negated ? !value : value;
}

function viewOf(containerId) {
  const views = (manifest.contributes.views || {})[containerId] || [];
  ok(views.length === 1, "container " + containerId + " declares exactly one view");
  return views[0];
}

const activityContainer = manifest.contributes.viewsContainers.activitybar[0];
const secondaryContainer = manifest.contributes.viewsContainers.secondarySidebar[0];

ok(activityContainer.id === placement.ACTIVITY_BAR.container,
  "the activity bar container in the manifest is the one placement.js names");
ok(secondaryContainer.id === placement.SECONDARY_SIDEBAR.container,
  "the secondary side bar container in the manifest is the one placement.js names");
ok(activityContainer.when === undefined && secondaryContainer.when === undefined,
  "neither container carries a when clause, since the editor ignores it there and the views' clauses decide");

const activityView = viewOf(placement.ACTIVITY_BAR.container);
const secondaryView = viewOf(placement.SECONDARY_SIDEBAR.container);
ok(activityView.id === placement.ACTIVITY_BAR.view,
  "the activity bar view id matches placement.js");
ok(secondaryView.id === placement.SECONDARY_SIDEBAR.view,
  "the secondary side bar view id matches placement.js");

const unset = {};
ok(whenIsTrue(activityView.when, unset),
  "with no context key set, the activity bar view is visible, so a container icon exists before the extension has run a line");
ok(!whenIsTrue(secondaryView.when, unset),
  "with no context key set, the secondary side bar view is hidden, so it cannot spill into the Explorer on an editor without that bar");

const keySet = { [placement.CONTEXT_KEY]: true };
ok(!whenIsTrue(activityView.when, keySet) && whenIsTrue(secondaryView.when, keySet),
  "with " + placement.CONTEXT_KEY + " set, the view sits in the secondary side bar and only there");

const keyCleared = { [placement.CONTEXT_KEY]: false };
ok(whenIsTrue(activityView.when, keyCleared) && !whenIsTrue(secondaryView.when, keyCleared),
  "with " + placement.CONTEXT_KEY + " cleared, the view sits in the activity bar and only there");

ok([activityView.when, secondaryView.when].every((clause) => clause.replace(/^!/, "") === placement.CONTEXT_KEY),
  "both when clauses read exactly the context key extension.js sets");

ok((manifest.activationEvents || []).includes("onStartupFinished"),
  "the extension activates at startup, so the context key is set without anyone opening the view first");

const extension = fs.readFileSync(path.join(ROOT, "editor", "extension.js"), "utf8");
ok(/executeCommand\("setContext", CONTEXT_KEY, supportsSecondarySidebar\(vscode\.version\)\)/.test(extension),
  "extension.js sets the key positively from supportsSecondarySidebar, so an unset key means the activity bar");

ok(!placement.supportsSecondarySidebar("1.105.1") && placement.supportsSecondarySidebar("1.106.0")
  && placement.supportsSecondarySidebar("1.134.0") && !placement.supportsSecondarySidebar(""),
  "the version rule draws the line at 1.106 and treats an unreadable version as too old");

ok(placement.placementFor("1.105.1") === placement.ACTIVITY_BAR
  && placement.placementFor("1.134.0") === placement.SECONDARY_SIDEBAR,
  "placementFor sends 1.105 to the activity bar and 1.134 to the secondary side bar");

if (failures > 0) {
  console.error(failures + " placement check(s) failed");
  process.exit(1);
}
console.log("the manifest fails toward an icon: an unset context key leaves the activity bar view visible and the secondary one hidden");
