const path = require("node:path");
const { execFile } = require("node:child_process");
const { EventEmitter } = require("node:events");
const frames = require("./frames.js");
const { Conversation } = require("./conversation.js");
const { DaemonLink, ensureDaemon, findDaemonInfo } = require("./daemon_link.js");

const STATE_IDLE = "idle";
const STATE_STARTING = "starting";
const STATE_ATTACHED = "attached";
const STATE_RETRYING = "retrying";
const STATE_FAILED = "failed";
const STATE_DETACHED = "detached";

class EditorSession extends EventEmitter {
  constructor(options) {
    super();
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.jouleBin = options.jouleBin || "joule";
    this.env = options.env || process.env;
    this.connId = options.connId;
    this.conversation = new Conversation();
    this.link = null;
    this.state = STATE_IDLE;
    this.detail = "";
    this.port = 0;
    this.spawned = false;
    this.conversation.on("change", () => this.emit("change"));
  }

  daemonInfo() {
    return findDaemonInfo(this.workspaceRoot, this.env);
  }

  setState(state, detail) {
    this.state = state;
    this.detail = detail || "";
    this.emit("change");
  }

  async attach(options) {
    const opts = options || {};
    if (this.state === STATE_STARTING || this.state === STATE_ATTACHED) { return; }
    this.setState(STATE_STARTING, "");
    let report;
    try {
      report = await ensureDaemon(this.workspaceRoot, {
        jouleBin: this.jouleBin,
        env: this.env,
        resume: !!opts.resume,
      });
    } catch (e) {
      this.setState(STATE_FAILED, String(e && e.message ? e.message : e));
      return;
    }
    this.port = report.port;
    this.spawned = !!report.spawned;
    this.link = new DaemonLink({ port: this.port, connId: this.connId });
    this.link.on("frame", (text) => this.conversation.apply(text));
    this.link.on("status", (s) => this.onLinkStatus(s));
    await this.link.start();
  }

  onLinkStatus(status) {
    if (status.state === "connected") {
      this.setState(STATE_ATTACHED, "127.0.0.1:" + this.port);
      return;
    }
    if (status.state === "detached") {
      this.setState(STATE_DETACHED, "");
      return;
    }
    this.setState(STATE_RETRYING, status.detail || "lost the daemon connection, retrying");
  }

  submit(text) {
    const trimmed = String(text || "").trim();
    if (trimmed === "" || this.link === null) { return; }
    this.conversation.localPrompt(trimmed);
    this.link.send(frames.encodeInputFrame(trimmed));
  }

  answer(callId, decision) {
    const frameJson = this.conversation.answer(callId, decision);
    if (frameJson === null || this.link === null) { return; }
    this.link.send(frameJson);
  }

  cancel() {
    if (this.link === null) { return; }
    this.link.send(frames.encodeCancelFrame(this.conversation.currentTurnId));
  }

  detach() {
    if (this.link !== null) {
      this.link.close();
      this.link = null;
    }
    this.setState(STATE_DETACHED, "");
  }

  stopDaemon() {
    return new Promise((resolve, reject) => {
      execFile(this.jouleBin, ["--stop"], {
        cwd: this.workspaceRoot,
        env: this.env,
        timeout: 30000,
      }, (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(String(stderr || err.message)));
          return;
        }
        resolve(String(stdout || "").trim());
      });
    });
  }

  view() {
    const info = this.daemonInfo();
    return {
      workspaceRoot: this.workspaceRoot,
      state: this.state,
      detail: this.detail,
      port: this.port,
      spawnedByThisWindow: this.spawned,
      daemonAlreadyRunning: info !== null,
      daemonStartedAt: info === null ? "" : info.startedAt,
      conversation: this.conversation.view(),
    };
  }
}

module.exports = {
  EditorSession,
  STATE_IDLE,
  STATE_STARTING,
  STATE_ATTACHED,
  STATE_RETRYING,
  STATE_FAILED,
  STATE_DETACHED,
};
