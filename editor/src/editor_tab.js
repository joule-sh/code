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

  restoring() {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputWebview && String(input.viewType).includes(TAB.viewType)) {
          return true;
        }
      }
    }
    return false;
  }

  hasEditors() {
    return vscode.window.tabGroups.all.some((group) => group.tabs.length > 0);
  }

  column(preserveFocus) {
    if (!preserveFocus) { return vscode.ViewColumn.Beside; }
    return this.hasEditors() ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
  }

  open(how) {
    const preserveFocus = how !== undefined && how !== null && how.preserveFocus === true;
    if (this.panel !== null) {
      this.panel.reveal(this.panel.viewColumn, preserveFocus);
      return this.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      TAB.viewType,
      TAB.title,
      { viewColumn: this.column(preserveFocus), preserveFocus },
      this.options(),
    );
    this.adopt(panel);
    return panel;
  }

  openOnStartup() {
    if (this.restoring()) { return null; }
    return this.open({ preserveFocus: true });
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
