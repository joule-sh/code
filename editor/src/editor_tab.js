const vscode = require("vscode");
const { TAB } = require("./placement.js");

class EditorTab {
  constructor(chat, context) {
    this.chat = chat;
    this.context = context;
    this.panel = null;
  }

  options() {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
      localResourceRoots: [this.context.extensionUri],
    };
  }

  open() {
    if (this.panel !== null) {
      this.panel.reveal(this.panel.viewColumn, false);
      return this.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      TAB.viewType,
      TAB.title,
      vscode.ViewColumn.Beside,
      this.options(),
    );
    this.adopt(panel);
    return panel;
  }

  adopt(panel) {
    if (this.panel !== null && this.panel !== panel) { this.panel.dispose(); }
    this.panel = panel;
    panel.webview.options = this.options();
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "media", "icon.svg");
    panel.onDidDispose(() => {
      if (this.panel !== panel) { return; }
      this.panel = null;
      this.chat.setTab(null);
    });
    this.chat.setTab(panel);
    return panel;
  }
}

module.exports = { EditorTab };
