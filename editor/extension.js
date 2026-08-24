const vscode = require("vscode");
const { ChatPanel } = require("./src/chat_panel.js");
const { EditorTab } = require("./src/editor_tab.js");
const { ACTIVITY_BAR, TAB } = require("./src/placement.js");

let panel = null;
let tab = null;

function activate(context) {
  panel = new ChatPanel(context);
  tab = new EditorTab(panel, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ACTIVITY_BAR.view, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(TAB.viewType, {
      deserializeWebviewPanel(restored) {
        tab.adopt(restored);
        return Promise.resolve();
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("joule.attach", () => panel.attach({})),
    vscode.commands.registerCommand("joule.detach", () => panel.detach()),
    vscode.commands.registerCommand("joule.cancel", () => panel.cancel()),
    vscode.commands.registerCommand("joule.stopDaemon", () => panel.stopDaemon()),
    vscode.commands.registerCommand(TAB.command, () => tab.open()),
    { dispose: () => { if (panel !== null) { panel.dispose(); } } },
  );

  if (vscode.workspace.getConfiguration("joule").get("openInEditorTab") === true) {
    tab.openOnStartup();
  }

  if (vscode.workspace.getConfiguration("joule").get("attachOnStartup") === true) {
    panel.attach({});
  }

  return { panel, tab };
}

function deactivate() {
  tab = null;
  if (panel !== null) {
    panel.dispose();
    panel = null;
  }
}

module.exports = { activate, deactivate };
