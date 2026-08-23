const { EventEmitter } = require("node:events");
const frames = require("./frames.js");

const DIFF_MAX_ROWS = 400;

const APPROVAL_PENDING = "pending";
const APPROVAL_SUBMITTED = "submitted";
const APPROVAL_RESOLVED = "resolved";

const RESOLVED_HERE = "here";
const RESOLVED_ELSEWHERE = "elsewhere";
const RESOLVED_UNANSWERED = "unanswered";

function safeParse(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

function buildDiff(tool, args) {
  const filePath = frames.diffableToolPathJs(tool, args);
  if (filePath === "") { return null; }
  const parsed = safeParse(args);
  if (parsed === null) { return null; }
  const oldText = tool === "edit" && typeof parsed.old_text === "string" ? parsed.old_text : "";
  const newText = tool === "edit"
    ? (typeof parsed.new_text === "string" ? parsed.new_text : "")
    : (typeof parsed.content === "string" ? parsed.content : "");
  const rows = frames.diffLinesJs(oldText, newText);
  if (rows === null || rows.length > DIFF_MAX_ROWS) { return { path: filePath, rows: null, added: 0, removed: 0 }; }
  const counts = frames.diffCountsJs(rows);
  return { path: filePath, rows, added: counts.added, removed: counts.removed };
}

function commandOf(tool, args) {
  const parsed = safeParse(args);
  if (parsed === null) { return args; }
  if (typeof parsed.command === "string") { return parsed.command; }
  if (typeof parsed.path === "string") { return parsed.path; }
  return args;
}

class Conversation extends EventEmitter {
  constructor() {
    super();
    this.items = [];
    this.session = null;
    this.nextId = 1;
    this.pendingApprovalId = "";
    this.currentTurnId = "";
    this.turnActive = false;
    this.byCallId = new Map();
    this.approvalByCallId = new Map();
    this.localAnswers = new Map();
    this.openText = null;
    this.daemonStopping = false;
  }

  push(item) {
    item.id = this.nextId;
    this.nextId += 1;
    this.items.push(item);
    return item;
  }

  notice(text, tone) {
    this.openText = null;
    return this.push({ kind: "notice", text, tone: tone || "info" });
  }

  localPrompt(text) {
    this.openText = null;
    this.push({ kind: "prompt", text });
    this.emit("change");
  }

  apply(frameJson) {
    const f = frames.decodeFrame(frameJson);
    if (f === null) { return; }
    this.handle(f);
    this.emit("change");
  }

  handle(f) {
    const kind = f.type;

    if (kind === frames.SESSION_HELLO) {
      this.session = {
        sessionId: f.sessionId,
        workspace: f.workspace,
        model: f.model,
        mode: f.mode,
        protocol: f.protocol,
      };
      return;
    }

    if (kind === frames.TURN_START) {
      this.currentTurnId = f.turnId;
      this.turnActive = true;
      this.openText = null;
      if (typeof f.prompt === "string" && f.prompt !== "") {
        const last = this.items[this.items.length - 1];
        if (!last || last.kind !== "prompt" || last.text !== f.prompt) {
          this.push({ kind: "prompt", text: f.prompt, turnId: f.turnId });
        }
      }
      return;
    }

    if (kind === frames.TEXT_DELTA) {
      const text = typeof f.text === "string" ? f.text : "";
      if (text === "") { return; }
      if (this.openText && this.openText.turnId === f.turnId) {
        this.openText.text += text;
        return;
      }
      this.openText = this.push({ kind: "text", turnId: f.turnId, text });
      return;
    }

    if (kind === frames.TOOL_CALL) {
      this.openText = null;
      const answeredHere = this.localAnswers.get(f.callId);
      this.resolveApproval(
        f.callId,
        answeredHere === undefined ? "" : answeredHere,
        answeredHere === undefined ? RESOLVED_ELSEWHERE : RESOLVED_HERE,
        false,
      );
      const item = this.push({
        kind: "tool",
        turnId: f.turnId,
        callId: f.callId,
        tool: f.tool,
        args: f.args,
        label: commandOf(f.tool, f.args),
        diff: buildDiff(f.tool, f.args),
        status: "running",
        output: "",
        truncated: false,
      });
      this.byCallId.set(f.callId, item);
      return;
    }

    if (kind === frames.TOOL_RESULT) {
      this.openText = null;
      const item = this.byCallId.get(f.callId);
      if (item) {
        item.status = f.ok ? "ok" : "failed";
        item.output = typeof f.output === "string" ? f.output : "";
        item.truncated = !!f.truncated;
      }
      return;
    }

    if (kind === frames.APPROVAL_REQUEST) {
      this.openText = null;
      const item = this.push({
        kind: "approval",
        turnId: f.turnId,
        callId: f.callId,
        tool: f.tool,
        summary: f.summary,
        detail: f.detail,
        args: f.args,
        label: commandOf(f.tool, f.args),
        diff: buildDiff(f.tool, f.args),
        state: APPROVAL_PENDING,
        decision: "",
        resolvedBy: "",
        note: "",
      });
      this.approvalByCallId.set(f.callId, item);
      this.pendingApprovalId = f.callId;
      return;
    }

    if (kind === frames.APPROVAL_REPLY_RESULT) {
      if (f.applied) {
        const mine = this.localAnswers.get(f.callId);
        const by = mine === f.decision ? RESOLVED_HERE : RESOLVED_ELSEWHERE;
        this.resolveApproval(f.callId, f.decision, by, true);
        return;
      }
      const attempted = this.localAnswers.get(f.callId);
      this.resolveApproval(f.callId, f.decision, RESOLVED_ELSEWHERE, true);
      if (attempted !== undefined) {
        const item = this.approvalItem(f.callId);
        if (item) {
          item.note = "answered elsewhere first (" + f.decision + ") - this window's " + attempted + " was not applied";
        }
      }
      return;
    }

    if (kind === frames.TURN_END) {
      this.turnActive = false;
      this.openText = null;
      if (this.pendingApprovalId !== "") {
        const stillPending = this.pendingApprovalId;
        this.resolveApproval(stillPending, "", RESOLVED_UNANSWERED, false);
      }
      this.push({ kind: "turn-end", turnId: f.turnId, reason: f.reason });
      return;
    }

    if (kind === frames.ERROR_FRAME) {
      this.notice(f.code + ": " + f.message, "error");
      return;
    }

    if (frames.isDaemonBroadcastType(kind)) {
      this.handleBroadcast(kind, f);
      return;
    }

    if (!frames.isKnownFrameType(kind)) {
      this.notice("an unrecognised frame arrived (" + String(kind) + ") - this editor client is older than the daemon", "warn");
    }
  }

  handleBroadcast(kind, f) {
    if (kind === frames.MODE_CHANGED) {
      if (this.session !== null) { this.session.mode = f.mode; }
      this.notice("mode set to " + f.mode);
      return;
    }
    if (kind === frames.MODEL_CHANGED) {
      if (this.session !== null) { this.session.model = f.model; }
      this.notice("model set to " + f.model);
      return;
    }
    if (kind === frames.TASKS_RESPONSE) {
      this.notice(f.text);
      return;
    }
    if (kind === frames.SHARE_STARTED) {
      this.notice("this session is now shared over the relay: " + f.url, "warn");
      return;
    }
    if (kind === frames.SHARE_FAILED) {
      this.notice("sharing this session failed: " + f.error, "error");
      return;
    }
    this.daemonStopping = true;
    this.notice("the daemon is stopping (" + f.reason + ") - a run already in flight is not killed", "warn");
  }

  approvalItem(callId) {
    return this.approvalByCallId.get(callId) || null;
  }

  resolveApproval(callId, decision, by, explicit) {
    const item = this.approvalItem(callId);
    if (item === null) { return; }
    if (item.state === APPROVAL_RESOLVED) {
      if (explicit && decision !== "" && item.decision === "") { item.decision = decision; }
      return;
    }
    item.state = APPROVAL_RESOLVED;
    item.resolvedBy = by;
    if (decision !== "") { item.decision = decision; }
    if (by === RESOLVED_ELSEWHERE && item.note === "") {
      item.note = decision === ""
        ? "answered elsewhere"
        : "answered elsewhere (" + decision + ")";
    }
    if (by === RESOLVED_UNANSWERED) {
      item.note = "the turn ended before this was answered";
    }
    if (this.pendingApprovalId === callId) { this.pendingApprovalId = ""; }
  }

  answer(callId, decision) {
    const item = this.approvalItem(callId);
    if (item === null || item.state === APPROVAL_RESOLVED) { return null; }
    this.localAnswers.set(callId, decision);
    item.state = APPROVAL_SUBMITTED;
    item.decision = decision;
    if (this.pendingApprovalId === callId) { this.pendingApprovalId = ""; }
    this.emit("change");
    return frames.encodeApprovalReplyFrame(callId, decision);
  }

  pendingApproval() {
    if (this.pendingApprovalId === "") { return null; }
    return this.approvalItem(this.pendingApprovalId);
  }

  view() {
    return {
      session: this.session,
      items: this.items,
      turnActive: this.turnActive,
      currentTurnId: this.currentTurnId,
      pendingCallId: this.pendingApprovalId,
      daemonStopping: this.daemonStopping,
    };
  }
}

module.exports = {
  Conversation,
  buildDiff,
  commandOf,
  APPROVAL_PENDING,
  APPROVAL_SUBMITTED,
  APPROVAL_RESOLVED,
  RESOLVED_HERE,
  RESOLVED_ELSEWHERE,
  RESOLVED_UNANSWERED,
};
