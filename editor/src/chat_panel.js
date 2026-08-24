const vscode = require("vscode");
const os = require("node:os");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { EditorSession } = require("./session.js");
const { findDaemonInfo } = require("./daemon_link.js");
const { unsupportedPlatform, checkBinary } = require("./binary.js");
const setup = require("./setup.js");
const onboard = require("./onboard.js");

const CONN_ID_KEY = "joule.connId";

function nonce() {
  return crypto.randomBytes(16).toString("hex");
}

class ChatPanel extends EventEmitter {
  constructor(context) {
    super();
    this.context = context;
    this.view = null;
    this.session = null;
    this.folder = null;
    this.binary = null;
    this.checkingBinary = false;
    this.note = "";
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

  mediaTags(webview, media, n) {
    const sheets = ["chat.css", "first_run.css", "composer.css"];
    const scripts = ["dom.js", "first_run.js", "transcript.js", "composer.js", "chat.js"];
    const links = sheets.map((name) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(media, name));
      return `<link rel="stylesheet" href="${uri}">`;
    });
    const tags = scripts.map((name) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(media, name));
      return `<script nonce="${n}" src="${uri}"></script>`;
    });
    return { links: links.join("\n"), scripts: tags.join("\n") };
  }

  html(webview, media) {
    const n = nonce();
    const src = vscode.Uri.joinPath(this.context.extensionUri, "src");
    const framesUri = webview.asWebviewUri(vscode.Uri.joinPath(src, "frames.js"));
    const modesUri = webview.asWebviewUri(vscode.Uri.joinPath(src, "modes.js"));
    const assets = this.mediaTags(webview, media, n);
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${n}'`,
    ].join("; ");
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
${assets.links}
<title>Joule</title></head><body>
<div id="root"></div>
${this.probeTag(webview, media, n)}
<script nonce="${n}" src="${framesUri}"></script>
<script nonce="${n}" src="${modesUri}"></script>
${assets.scripts}
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
    if (msg.kind === "route") { this.route(msg.route); return; }
    if (msg.kind === "recheck") { this.recheck(); return; }
    if (msg.kind === "help") { this.openHelp(); return; }
    if (this.session === null) { return; }
    if (msg.kind === "submit") { this.session.submit(msg.text); return; }
    if (msg.kind === "mode") { this.session.setMode(msg.mode); return; }
    if (msg.kind === "model") { this.pickModel(); return; }
    if (msg.kind === "answer") { this.session.answer(msg.callId, msg.decision); }
  }

  async route(kind) {
    const folder = this.folder || this.folders()[0] || null;
    try {
      const note = await onboard.runRoute(kind, {
        env: process.env,
        jouleBin: this.jouleBin(),
        cwd: folder === null ? undefined : folder.uri.fsPath,
        server: setup.setupState(process.env).server,
      });
      if (note !== "") { this.note = note; }
    } catch (e) {
      this.note = String(e && e.message ? e.message : e);
    }
    this.post();
  }

  recheck() {
    this.note = "";
    this.binary = null;
    this.post();
  }

  openHelp() {
    const url = this.binary === null ? "" : this.binary.helpUrl;
    if (!url) { return; }
    vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async pickModel() {
    if (this.session === null) { return; }
    const current = this.session.conversation.session;
    const typed = await vscode.window.showInputBox({
      title: "Which model should this session use?",
      prompt: "The same thing /model sets in a terminal. Every client on this session is told.",
      value: current === null ? "" : current.model,
    });
    if (typed === undefined) { return; }
    this.session.setModel(typed);
  }

  async ensureBinary() {
    if (this.binary !== null || this.checkingBinary) { return; }
    this.checkingBinary = true;
    const folder = this.folder || this.folders()[0] || null;
    const found = await checkBinary({
      jouleBin: this.jouleBin(),
      env: process.env,
      cwd: folder === null ? undefined : folder.uri.fsPath,
    });
    this.checkingBinary = false;
    this.binary = found;
    this.post();
  }

  where() {
    const folder = this.folder || (this.folders().length === 1 ? this.folders()[0] : null);
    return {
      root: folder === null ? "" : folder.uri.fsPath,
      remote: vscode.env.remoteName || "",
      host: os.hostname(),
    };
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
    state.setup = setup.setupState(process.env);
    state.where = this.where();
    state.binary = this.binary;
    state.note = this.note;
    this.view.webview.postMessage({ kind: "state", state });
    this.ensureBinary();
  }

  dispose() {
    if (this.session !== null) { this.session.detach(); }
  }
}

module.exports = { ChatPanel };
