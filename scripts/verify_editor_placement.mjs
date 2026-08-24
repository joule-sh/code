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

const containers = manifest.contributes.viewsContainers;
ok(Object.keys(containers).length === 1 && Array.isArray(containers.activitybar),
  "the manifest declares containers in exactly one place, the activity bar");
ok(containers.activitybar.length === 1 && containers.activitybar[0].id === placement.ACTIVITY_BAR.container,
  "the activity bar holds exactly the container placement.js names");
ok(containers.activitybar[0].when === undefined,
  "the container carries no when clause");
ok(typeof containers.activitybar[0].icon === "string" && containers.activitybar[0].icon !== "",
  "the container declares an icon");
ok(fs.existsSync(path.join(ROOT, "editor", containers.activitybar[0].icon)),
  "the icon file the manifest points at exists");

const views = manifest.contributes.views;
ok(Object.keys(views).length === 1 && Array.isArray(views[placement.ACTIVITY_BAR.container]),
  "views are declared for that container and no other");
const view = views[placement.ACTIVITY_BAR.container][0];
ok(views[placement.ACTIVITY_BAR.container].length === 1 && view.id === placement.ACTIVITY_BAR.view,
  "the container holds exactly the session view placement.js names");
ok(view.when === undefined,
  "the view carries no when clause, so the icon exists before the extension has run a line");
ok(view.visibility === "visible",
  "the view is declared visible outright");

ok((manifest.activationEvents || []).includes("onStartupFinished"),
  "the extension activates at startup rather than waiting for its view to be opened");
ok((manifest.activationEvents || []).includes("onView:" + placement.ACTIVITY_BAR.view),
  "opening the view activates the extension too");

const extension = fs.readFileSync(path.join(ROOT, "editor", "extension.js"), "utf8");
ok(!/setContext/.test(extension),
  "extension.js sets no placement context key, since nothing is gated on one");
ok(new RegExp("registerWebviewViewProvider\\(ACTIVITY_BAR\\.view").test(extension),
  "extension.js registers the provider for the view the manifest declares");

ok((manifest.activationEvents || []).includes("onWebviewPanel:" + placement.TAB.viewType),
  "a restored editor tab activates the extension, so the tab can be handed back to it");
ok(new RegExp("registerWebviewPanelSerializer\\(TAB\\.viewType").test(extension),
  "extension.js registers a serializer for the tab, so a restored tab is rehydrated rather than left a stale shell");
ok(new RegExp("registerCommand\\(TAB\\.command").test(extension),
  "extension.js registers the command that opens the tab");

const commands = (manifest.contributes.commands || []).map((c) => c.command);
ok(commands.includes(placement.TAB.command),
  "the manifest declares the command placement.js names, so the command palette can find it");

const titleMenu = ((manifest.contributes.menus || {})["view/title"] || [])
  .filter((item) => item.command === placement.TAB.command);
ok(titleMenu.length === 1 && titleMenu[0].when === "view == " + placement.ACTIVITY_BAR.view,
  "the session view's own title bar offers the tab, so the placement is reachable without the command palette");

const settings = manifest.contributes.configuration.properties;
ok(settings["joule.openInEditorTab"] !== undefined && settings["joule.openInEditorTab"].default === true,
  "a window opens the session in an editor tab by default, and can be told not to");
ok(/getConfiguration\("joule"\).get\("openInEditorTab"\)/.test(extension),
  "extension.js reads that setting at activation");
ok(/tab\.openOnStartup\(\)/.test(extension),
  "the window opens the tab through the startup path rather than the one the command uses");

const tab = fs.readFileSync(path.join(ROOT, "editor", "src", "editor_tab.js"), "utf8");
ok(/ViewColumn\.Beside/.test(tab),
  "the tab opens beside the editor it was asked for rather than taking it over");
ok(/retainContextWhenHidden: true/.test(tab),
  "the tab keeps its webview alive while it is not the visible tab");
ok(/openOnStartup\(\)\s*\{[\s\S]*?preserveFocus: true/.test(tab),
  "opening the tab on its own preserves focus, so it does not take the caret off the file the window opened on");
ok(/openOnStartup\(\)\s*\{[\s\S]*?this\.restoring\(\)/.test(tab),
  "a window whose editor is restoring a session tab leaves it to the serializer instead of opening a second one");
ok(/ViewColumn\.One/.test(tab),
  "a window with no editor to sit beside takes the editor column rather than splitting off an empty pane");

if (failures > 0) {
  console.error(failures + " placement check(s) failed");
  process.exit(1);
}
console.log("nothing gates the activity bar container or its view, so the icon cannot depend on the extension running,"
  + " and the editor tab is an addition to it that needs no container at all");
