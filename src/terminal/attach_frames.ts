import { SESSION_HELLO, APPROVAL_REQUEST, TURN_START, TURN_END, TEXT_DELTA, MODE_CHANGED, MODEL_CHANGED, DAEMON_STOPPING, frameType, frameTurnId, decodeSessionHello, decodeApprovalRequest, decodeTurnStart, decodeModeChanged, decodeModelChanged, decodeDaemonStopping, decodeTextDelta } from "../protocol/frames.ts";
import { InputLine } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { appendFrame, drawScreen } from "./screen.ts";
import { beginApprovalBlockLocal } from "./attach_approval.ts";
import { AttachedSession } from "./attached_session.ts";
import { isTaskTurnId, appendTaggedFrame } from "./tasks_bridge.ts";
import { maybeOfferPlanDecision } from "./attach_plan.ts";
import { MODE_PLAN } from "./attach_slots.ts";
import { stylePrompt } from "./style.ts";


export class FrameDeps {
  sb: Scrollback;
  input: InputLine;
  sess: AttachedSession;

  constructor(sb: Scrollback, input: InputLine, sess: AttachedSession) {
    this.sb = sb;
    this.input = input;
    this.sess = sess;
  }

  paint(): void {
    drawScreen(this.sb, this.input, this.sess.approvalLog.mode, this.sess.rk);
  }
}

function applyHello(d: FrameDeps, f: string): void {
  let hello = decodeSessionHello(f);
  if (hello != null) {
    d.sess.approvalLog.mode = hello.mode;
    d.sess.state.model = hello.model;
  }
}

function applyTurnStart(d: FrameDeps, f: string, isTagged: bool): void {
  let start = decodeTurnStart(f);
  if (start != null) {
    d.sess.state.turnId = start.turnId;
    if (!isTagged && start.prompt != "" && !d.sess.echoes.claim(start.prompt)) {
      d.sb.append("\n" + stylePrompt("> ") + start.prompt);
    }
  }
  if (!isTagged) { d.sess.planTracker.noteTurnStart(); }
}

function applyModeChanged(d: FrameDeps, f: string): void {
  let modeChanged = decodeModeChanged(f);
  if (modeChanged != null) {
    if (modeChanged.mode == MODE_PLAN && d.sess.approvalLog.mode != MODE_PLAN) {
      d.sess.planPending.setPreviousMode(d.sess.approvalLog.mode);
    }
    d.sess.approvalLog.mode = modeChanged.mode;
  }
}

function applyStopping(d: FrameDeps, f: string): void {
  let stopping = decodeDaemonStopping(f);
  d.sess.state.stopReason = "an attached client asked it to stop";
  if (stopping != null) { d.sess.state.stopReason = stopping.reason; }
}

export function processAttachFrames(d: FrameDeps, frames: string[], isReplay: bool): bool {
  let daemonStopped = false;
  for (const f of frames) {
    if (!isReplay) { d.sess.watchdog.noteDaemonAnswered(); }
    let t = frameType(f);
    let isTagged = isTaskTurnId(frameTurnId(f));
    if (isTagged) {
      appendTaggedFrame(d.sb, d.sess.tagged, f);
    } else {
      appendFrame(d.sb, d.sess.rk, f);
    }
    if (t == SESSION_HELLO) { applyHello(d, f); }
    if (t == TURN_START) { applyTurnStart(d, f, isTagged); }
    if (t == TEXT_DELTA && !isTagged) {
      let delta = decodeTextDelta(f);
      if (delta != null) { d.sess.planTracker.noteAssistantText(delta.text); }
    }
    if (t == APPROVAL_REQUEST) {
      let req = decodeApprovalRequest(f);
      if (req != null) {
        beginApprovalBlockLocal(d.sb, d.sess.pendingApproval, req.callId, req.tool, req.summary, req.detail);
      }
    }
    if (t == MODE_CHANGED) { applyModeChanged(d, f); }
    if (t == MODEL_CHANGED) {
      let modelChanged = decodeModelChanged(f);
      if (modelChanged != null) { d.sess.state.model = modelChanged.model; }
    }
    if (t == DAEMON_STOPPING) {
      applyStopping(d, f);
      daemonStopped = true;
    }
    if (t == TURN_END && !isTagged) {
      maybeOfferPlanDecision(d.sess.planPending, d.sess.planTracker, d.sess.approvalLog.mode, d.sb, f);
    }
    d.paint();
  }
  return daemonStopped;
}
