const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { EditorSession } = require("./session.js");
const { findDaemonInfo } = require("./daemon_link.js");
const { unsupportedPlatform } = require("./binary.js");

const CONN_ID_KEY = "joule.connId";

function nonce() {
  return crypto.randomBytes(16).toString("hex");
}

function readAsset(root, ...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

class ChatPanel extends EventEmitter {
  constructor(context) {
    super();
    this.context = context;
    this.view = null;
    this.session = null;
    this.folder = null;
    this.probing = context.extensionMode === vscode.ExtensionMode.Test;
  }

  jouleBin() {
    return vscode.workspace.getConfiguration("joule").get("path") || "joule";
  }

  connIdFor(folder) {
    const key = CONN_ID_KEY + ":" + folder.uri.fsPath;
    let existing = this.context.workspaceState.get(key);
    if (!existing) {
      existing = crypto.randomBytes(8).toString("hex");
      this.context.workspaceState.update(key, existing);
    }
    return existing;
  }

  sessionFor(folder) {
    if (this.session !== null && this.folder && this.folder.uri.fsPath === folder.uri.fsPath) {
      return this.session;
    }
    if (this.session !== null) { this.session.detach(); }
    this.folder = folder;
    this.session = new EditorSession({
      workspaceRoot: folder.uri.fsPath,
      jouleBin: this.jouleBin(),
      connId: this.connIdFor(folder),
    });
    this.session.on("change", () => this.post());
    return this.session;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    webviewView.webview.html = this.html(webviewView.webview, media);
    webviewView.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    webviewView.onDidChangeVisibility(() => { if (webviewView.visible) { this.post(); } });
    this.post();
  }

  probeTag(webview, media, n) {
    if (!this.probing) { return ""; }
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(media, "probe.js"));
    return `<script nonce="${n}" src="${uri}"></script>`;
  }

  html(webview, media) {
    const n = nonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.css"));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(media, "chat.js"));
    const framesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "src", "frames.js"));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${n}'`,
    ].join("; ");
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${cssUri}">
<title>Joule</title></head><body>
<div id="root"></div>
${this.probeTag(webview, media, n)}
<script nonce="${n}" src="${framesUri}"></script>
<script nonce="${n}" src="${jsUri}"></script>
</body></html>`;
  }

  folders() {
    return vscode.workspace.workspaceFolders || [];
  }

  async pickFolder() {
    const folders = this.folders();
    if (folders.length === 0) { return null; }
    if (folders.length === 1) { return folders[0]; }
    if (this.folder) { return this.folder; }
    const picked = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
      { title: "Joule runs one daemon per workspace folder. Which folder?" },
    );
    return picked ? picked.folder : null;
  }

  async attach(options) {
    const folder = await this.pickFolder();
    if (folder === null) {
      vscode.window.showWarningMessage("Joule needs an open workspace folder: the daemon is started in it and every tool call is clamped to it.");
      return;
    }
    const session = this.sessionFor(folder);
    const resume = vscode.workspace.getConfiguration("joule").get("resumeOnStart") === true;
    await session.attach({ resume: (options && options.resume) || resume });
    if (session.problem !== "") { await this.reportProblem(session); }
  }

  async reportProblem(session) {
    const help = session.help;
    if (help === null || !help.url) {
      vscode.window.showErrorMessage(session.detail);
      return;
    }
    const picked = await vscode.window.showErrorMessage(session.detail, help.label);
    if (picked === help.label) {
      vscode.env.openExternal(vscode.Uri.parse(help.url));
    }
  }

  detach() {
    if (this.session !== null) { this.session.detach(); }
  }

  cancel() {
    if (this.session !== null) { this.session.cancel(); }
  }

  async stopDaemon() {
    if (this.session === null) {
      vscode.window.showInformationMessage("Joule is not attached to a daemon in this window.");
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      "Stop the joule daemon for " + this.session.workspaceRoot + "? Other clients attached to it, including a terminal, lose the session too. A run already in flight is not killed.",
      { modal: true },
      "Stop it",
    );
    if (confirm !== "Stop it") { return; }
    try {
      const out = await this.session.stopDaemon();
      vscode.window.showInformationMessage(out || "Asked the daemon to stop.");
    } catch (e) {
      vscode.window.showErrorMessage(String(e && e.message ? e.message : e));
    }
  }

  onMessage(msg) {
    if (!msg || typeof msg.kind !== "string") { return; }
    if (msg.kind === "probe.result") {
      if (this.probing) { this.emit("probe", msg); }
      return;
    }
    if (msg.kind === "ready") { this.post(); return; }
    if (msg.kind === "attach") { this.attach({}); return; }
    if (msg.kind === "detach") { this.detach(); return; }
    if (msg.kind === "cancel") { this.cancel(); return; }
    if (msg.kind === "stop") { this.stopDaemon(); return; }
    if (this.session === null) { return; }
    if (msg.kind === "submit") { this.session.submit(msg.text); return; }
    if (msg.kind === "answer") { this.session.answer(msg.callId, msg.decision); }
  }

  idleState(folders) {
    const folder = this.folder || (folders.length === 1 ? this.folders()[0] : null);
    const root = folder ? folder.uri.fsPath : "";
    const info = root === "" ? null : findDaemonInfo(root);
    return {
      state: "idle",
      workspaceRoot: root,
      detail: folders.length > 1 && this.folder === null ? "this window has " + folders.length + " folders - you will be asked which one" : "",
      daemonAlreadyRunning: info !== null,
      daemonStartedAt: info === null ? "" : info.startedAt,
      folders,
      conversation: { items: [], session: null, turnActive: false, pendingCallId: "" },
    };
  }

  post() {
    if (this.view === null) { return; }
    const folders = this.folders().map((f) => ({ name: f.name, path: f.uri.fsPath }));
    const blocked = unsupportedPlatform("");
    const state = this.session === null
      ? this.idleState(folders)
      : Object.assign(this.session.view(), { folders });
    state.blocked = blocked;
    this.view.webview.postMessage({ kind: "state", state });
  }

  dispose() {
    if (this.session !== null) { this.session.detach(); }
  }
}

module.exports = { ChatPanel };
