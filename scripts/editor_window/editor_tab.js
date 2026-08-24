const vscode = require("vscode");
const { TAB } = require("../../editor/src/placement.js");
const { measure } = require("./startup_icon.js");

const PROMPT = "say where you are rendered";
const EXTENSION_ID = "joule-sh.joule-editor";

function exports_() {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  return ext && ext.exports ? ext.exports : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sessionTabs() {
  const found = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputWebview && String(input.viewType).includes(TAB.viewType)) {
        found.push({ column: group.viewColumn, label: tab.label });
      }
    }
  }
  return found;
}

function probeOn(panel, webview, message, timeoutMs) {
  const id = "probe-tab-" + Math.random().toString(16).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      panel.off("probe", onProbe);
      reject(new Error("the webview never answered " + JSON.stringify(message)));
    }, timeoutMs || 15000);
    function onProbe(reply) {
      if (reply.id !== id) { return; }
      clearTimeout(timer);
      panel.off("probe", onProbe);
      resolve(reply);
    }
    panel.on("probe", onProbe);
    webview.postMessage(Object.assign({ kind: "probe", id }, message));
  });
}

async function readable(panel, webview, timeoutMs, label, say) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const reply = await probeOn(panel, webview, { op: "read", selector: "#root" }, 5000);
      if (reply.texts.join("").trim() !== "") { return reply.texts.join("\n"); }
    } catch (e) {
      void e;
    }
    await sleep(500);
  }
  say("  " + label + " never painted anything readable");
  return "";
}

async function waitForBoth(panel, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let seen = { view: "", tab: "" };
  while (Date.now() < deadline) {
    try {
      seen.view = (await probeOn(panel, panel.view.webview, { op: "read", selector: "#root" })).texts.join("\n");
      seen.tab = (await probeOn(panel, panel.tab.webview, { op: "read", selector: "#root" })).texts.join("\n");
      if (seen.view.includes(needle) && seen.tab.includes(needle)) { return seen; }
    } catch (e) {
      void e;
    }
    await sleep(500);
  }
  return seen;
}

async function assertOpensBeside(kit) {
  const { ok, say, panel } = kit;
  const tab = exports_().tab;
  ok(tab !== undefined && tab !== null, "activation handed back the editor tab");
  ok(sessionTabs().length === 0, "no session tab is open before anything asks for one");

  const iconsBefore = measure().activityIcons;
  const folders = vscode.workspace.workspaceFolders || [];
  const readme = vscode.Uri.joinPath(folders[0].uri, "README.md");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(readme), vscode.ViewColumn.One);

  const sessionBefore = panel.session;
  await vscode.commands.executeCommand(TAB.command);
  for (let i = 0; i < 100 && panel.tab === null; i++) { await sleep(100); }
  ok(panel.tab !== null, "the command opened a session tab");
  if (panel.tab === null) { return; }

  const settled = await until(() => sessionTabs().length === 1, 30000);
  const open = sessionTabs();
  say("  the editor's own tab list holds " + JSON.stringify(open));
  ok(settled && open.length === 1,
    "exactly one session tab is open, so the command did not stack duplicates");
  ok(open.length === 1 && open[0].column > 1,
    "the tab opened in a column beside the file rather than taking the file's column over");
  ok(panel.view !== null && panel.tab !== null,
    "the sidebar view and the tab are mounted at the same time");
  ok(panel.session === sessionBefore,
    "opening the tab did not build a second session, so the two surfaces are one client of the daemon");

  await vscode.commands.executeCommand(TAB.command);
  await sleep(2000);
  ok(sessionTabs().length === 1,
    "asking again reveals the tab it already opened rather than opening a second one");

  const iconsAfter = measure().activityIcons;
  ok(iconsAfter === iconsBefore,
    "the activity bar still holds the same icons, " + iconsAfter + ", so the tab cost the container nothing");

  const painted = await readable(panel, panel.tab.webview, 60000, "the tab", say);
  ok(painted !== "", "the tab painted the session rather than an empty webview");
}

async function assertOneTranscript(kit) {
  const { ok, say, panel } = kit;
  const composer = await probeOn(panel, panel.tab.webview, { op: "read", selector: ".composer-input" });
  ok(composer.found === 1, "the tab renders a composer of its own to type into");
  await probeOn(panel, panel.tab.webview, { op: "fill", selector: ".composer-input", text: PROMPT, key: "Enter" });
  say("  the prompt was typed into the tab, so the sidebar can only show it by sharing the session");

  const seen = await waitForBoth(panel, PROMPT, 90000);
  ok(seen.view.includes(PROMPT),
    "the prompt typed into the tab is in the sidebar's transcript too, so neither surface holds a private conversation");
  ok(seen.tab.includes(PROMPT), "the prompt typed into the tab is in the tab's own transcript");

  const count = (text) => (text.split(PROMPT).length - 1);
  ok(count(seen.tab) === count(seen.view) && count(seen.tab) === 1,
    "the prompt appears exactly once in each surface, so nothing was duplicated or repainted onto itself");
}

async function until(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) { return true; }
    } catch (e) {
      void e;
    }
    await sleep(500);
  }
  return false;
}

async function assertAnsweredFromTheSidebar(kit) {
  const { ok, say, panel } = kit;
  say("  the run was asked for by a turn the tab started; the sidebar is the surface that answers it");
  const asked = await until(async () => {
    const found = await probeOn(panel, panel.view.webview, { op: "read", selector: ".approval-button.approval-allow" });
    return found.found >= 1;
  }, 90000);
  ok(asked, "the approval the tab's turn asked for is offered in the sidebar too");
  if (!asked) { return; }

  const clicked = await probeOn(panel, panel.view.webview, { op: "click", selector: ".approval-button.approval-allow" });
  ok(clicked.ok === true, "the sidebar answered an approval that a prompt typed into the tab asked for");

  const cleared = await until(async () => {
    const seen = await probeOn(panel, panel.tab.webview, { op: "read", selector: "#root" });
    return seen.texts.join("\n").includes("answered here: allow");
  }, 60000);
  ok(cleared, "the tab shows the answer the sidebar gave, so one answer clears the ask on both surfaces");

  ok(await until(() => panel.session.conversation.turnActive === false, 90000),
    "the turn the tab started ended");
}

async function assertAdoptsARestoredPanel(kit) {
  const { ok, say, panel } = kit;
  const api = exports_();
  say("  a restored tab reaches the extension through the same adopt() the serializer calls, so drive that");
  const before = panel.tab;
  const fresh = vscode.window.createWebviewPanel(TAB.viewType, TAB.title, vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  api.tab.adopt(fresh);
  ok(panel.tab === fresh, "adopting a panel makes it the surface the session renders into");
  ok(before !== panel.tab, "the tab it was showing before was replaced rather than left open as a second copy");
  await until(() => sessionTabs().length === 1, 30000);
  const open = sessionTabs();
  say("  the editor's own tab list holds " + JSON.stringify(open));
  ok(open.length === 1, "adopting left exactly one session tab open");
  const painted = await readable(panel, fresh.webview, 60000, "the adopted tab", say);
  ok(painted !== "",
    "the adopted tab renders the session, so a tab handed back after a restart comes back live");
}

async function assertEditorTab(kit) {
  await assertOpensBeside(kit);
  if (kit.panel.tab === null) { return; }
  await assertAdoptsARestoredPanel(kit);
  await kit.startStub();
  await kit.attachFromWebview(kit.panel);
  await assertOneTranscript(kit);
  await assertAnsweredFromTheSidebar(kit);
  await kit.reapFromWindow(kit.panel);
}

module.exports = { assertEditorTab, sessionTabs };
