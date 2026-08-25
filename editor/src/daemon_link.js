const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { execJoule } = require("./joule_bin.js");
const { connect } = require("./ws.js");
const frames = require("./frames.js");

const HOST = "127.0.0.1";
const OUTBOUND_CAP = 256;
const BACKOFF_START_MS = 250;
const BACKOFF_MAX_MS = 5000;
const ENSURE_TIMEOUT_MS = 45000;

function homeDir(env) {
  const e = env || process.env;
  return e.HOME || e.USERPROFILE || os.homedir();
}

function daemonInfoDir(env) {
  return path.join(homeDir(env), ".config", "joule-code", "daemon");
}

function readDaemonInfos(env) {
  const dir = daemonInfoDir(env);
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".json")) { continue; }
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (parsed && typeof parsed.workspace === "string" && typeof parsed.port === "number") {
        out.push(parsed);
      }
    } catch (e) {
      continue;
    }
  }
  return out;
}

function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  if (process.platform !== "win32") { return left === right; }
  return left.toLowerCase() === right.toLowerCase();
}

function findDaemonInfo(workspaceRoot, env) {
  for (const info of readDaemonInfos(env)) {
    if (samePath(info.workspace, workspaceRoot)) { return info; }
  }
  return null;
}

function parseEnsureReport(stdout) {
  const lines = String(stdout).split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
  if (lines.length === 0) { return null; }
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch (e) {
    return null;
  }
}

function ensureDaemon(workspaceRoot, options) {
  const opts = options || {};
  const bin = opts.jouleBin || "joule";
  const args = ["daemon-ensure"];
  if (opts.resume) { args.push("--continue"); }
  return execJoule(bin, args, {
    cwd: workspaceRoot,
    env: opts.env,
    timeoutMs: opts.timeoutMs || ENSURE_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  }).then(({ err, stdout, stderr }) => {
    const report = parseEnsureReport(stdout);
    if (report && report.ok) { return report; }
    const detail = String(stderr || "").trim() || String(stdout || "").trim() || (err ? err.message : "no output");
    throw new Error("could not start or reach a joule daemon for " + workspaceRoot + ": " + detail);
  });
}

class DaemonLink extends EventEmitter {
  constructor(options) {
    super();
    this.host = options.host || HOST;
    this.port = options.port;
    this.connId = options.connId || crypto.randomBytes(8).toString("hex");
    this.lastSeq = -1;
    this.conn = null;
    this.open = false;
    this.closed = false;
    this.outbound = [];
    this.backoffMs = BACKOFF_START_MS;
    this.retryTimer = null;
  }

  attachPath() {
    return "/attach/" + this.connId + "/ws";
  }

  async start() {
    if (this.closed) { return; }
    try {
      const conn = await connect(this.host, this.port, this.attachPath(), {});
      if (this.closed) { conn.close(); return; }
      this.conn = conn;
      this.open = true;
      this.backoffMs = BACKOFF_START_MS;
      conn.onMessage((text) => this.receive(text));
      conn.onClose(() => this.onClosed());
      conn.send(frames.encodeResumeFrame(this.lastSeq));
      this.flush();
      this.emit("status", { state: "connected", port: this.port });
    } catch (e) {
      this.onFailed(e);
    }
  }

  receive(text) {
    const decoded = frames.decodeFrame(text);
    if (decoded && typeof decoded.seq === "number" && decoded.seq > this.lastSeq) {
      this.lastSeq = decoded.seq;
    }
    this.emit("frame", text);
  }

  onClosed() {
    if (!this.open) { return; }
    this.open = false;
    this.conn = null;
    if (this.closed) { return; }
    this.emit("status", { state: "disconnected" });
    this.scheduleRetry();
  }

  onFailed(err) {
    this.open = false;
    this.conn = null;
    if (this.closed) { return; }
    this.emit("status", { state: "unreachable", detail: String(err && err.message ? err.message : err) });
    this.scheduleRetry();
  }

  scheduleRetry() {
    if (this.closed || this.retryTimer) { return; }
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start();
    }, wait);
    if (this.retryTimer.unref) { this.retryTimer.unref(); }
  }

  flush() {
    if (!this.open) { return; }
    const queued = this.outbound;
    this.outbound = [];
    for (const f of queued) { this.conn.send(f); }
  }

  send(frameJson) {
    if (this.closed) { return; }
    if (this.open && this.conn) {
      this.conn.send(frameJson);
      return;
    }
    this.outbound.push(frameJson);
    while (this.outbound.length > OUTBOUND_CAP) { this.outbound.shift(); }
  }

  close() {
    this.closed = true;
    this.open = false;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.conn) {
      try { this.conn.close(); } catch (e) { void e; }
      this.conn = null;
    }
    this.emit("status", { state: "detached" });
  }
}

module.exports = {
  DaemonLink,
  daemonInfoDir,
  readDaemonInfos,
  findDaemonInfo,
  samePath,
  ensureDaemon,
  parseEnsureReport,
  OUTBOUND_CAP,
};
