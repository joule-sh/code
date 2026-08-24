const vscode = require("vscode");
const { ChatPanel } = require("./src/chat_panel.js");
const { ACTIVITY_BAR } = require("./src/placement.js");

let panel = null;

function activate(context) {
  panel = new ChatPanel(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ACTIVITY_BAR.view, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("joule.attach", () => panel.attach({})),
    vscode.commands.registerCommand("joule.detach", () => panel.detach()),
    vscode.commands.registerCommand("joule.cancel", () => panel.cancel()),
    vscode.commands.registerCommand("joule.stopDaemon", () => panel.stopDaemon()),
    { dispose: () => panel.dispose() },
  );

  if (vscode.workspace.getConfiguration("joule").get("attachOnStartup") === true) {
    panel.attach({});
  }

  return { panel };
}

function deactivate() {
  if (panel !== null) {
    panel.dispose();
    panel = null;
  }
}

module.exports = { activate, deactivate };
