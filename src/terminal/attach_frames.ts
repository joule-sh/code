import { SESSION_HELLO, APPROVAL_REQUEST, TURN_START, TURN_END, TEXT_DELTA, MODE_CHANGED, MODEL_CHANGED, DAEMON_STOPPING, frameType, frameTurnId, decodeSessionHello, decodeApprovalRequest, decodeTurnStart, decodeModeChanged, decodeModelChanged, decodeDaemonStopping, decodeTextDelta } from "../protocol/frames.ts";
import { InputLine, PendingApproval, PendingPlanDecision } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { TurnStatusTracker, appendFrame, drawScreen } from "./screen.ts";
import { ApprovalLog, beginApprovalBlockLocal } from "./attach_approval.ts";
import { ClientState } from "./attach_state.ts";
import { isTaskTurnId, appendTaggedFrame, TaggedTurns } from "./tasks_bridge.ts";
import { PlanOfferTracker, maybeOfferPlanDecision } from "./attach_plan.ts";
import { TurnWatchdog } from "./attach_watchdog.ts";
import { MODE_PLAN } from "./attach_slots.ts";
import { stylePrompt } from "./style.ts";
import { LocalPrompts } from "./attach_echo.ts";

export class FrameDeps {
  sb: Scrollback;
  input: InputLine;
  rk: TurnStatusTracker;
  approvalLog: ApprovalLog;
  state: ClientState;
  pendingApproval: PendingApproval;
  planPending: PendingPlanDecision;
  planTracker: PlanOfferTracker;
  tagged: TaggedTurns;
  echoes: LocalPrompts;
  watchdog: TurnWatchdog;

  constructor(sb: Scrollback, input: InputLine, rk: TurnStatusTracker, approvalLog: ApprovalLog, state: ClientState, pendingApproval: PendingApproval, planPending: PendingPlanDecision, planTracker: PlanOfferTracker, tagged: TaggedTurns, echoes: LocalPrompts, watchdog: TurnWatchdog) {
    this.sb = sb;
    this.input = input;
    this.rk = rk;
    this.approvalLog = approvalLog;
    this.state = state;
    this.pendingApproval = pendingApproval;
    this.planPending = planPending;
    this.planTracker = planTracker;
    this.tagged = tagged;
    this.echoes = echoes;
    this.watchdog = watchdog;
  }

  paint(): void {
    drawScreen(this.sb, this.input, this.approvalLog.mode, this.rk);
  }
}

function applyHello(d: FrameDeps, f: string): void {
  let hello = decodeSessionHello(f);
  if (hello != null) {
    d.approvalLog.mode = hello.mode;
    d.state.model = hello.model;
  }
}

function applyTurnStart(d: FrameDeps, f: string, isTagged: bool): void {
  let start = decodeTurnStart(f);
  if (start != null) {
    d.state.turnId = start.turnId;
    if (!isTagged && start.prompt != "" && !d.echoes.claim(start.prompt)) {
      d.sb.append("\n" + stylePrompt("> ") + start.prompt);
    }
  }
  if (!isTagged) { d.planTracker.noteTurnStart(); }
}

function applyModeChanged(d: FrameDeps, f: string): void {
  let modeChanged = decodeModeChanged(f);
  if (modeChanged != null) {
    if (modeChanged.mode == MODE_PLAN && d.approvalLog.mode != MODE_PLAN) {
      d.planPending.setPreviousMode(d.approvalLog.mode);
    }
    d.approvalLog.mode = modeChanged.mode;
  }
}

function applyStopping(d: FrameDeps, f: string): void {
  let stopping = decodeDaemonStopping(f);
  d.state.stopReason = "an attached client asked it to stop";
  if (stopping != null) { d.state.stopReason = stopping.reason; }
}

export function processAttachFrames(d: FrameDeps, frames: string[], isReplay: bool): bool {
  let daemonStopped = false;
  for (const f of frames) {
    if (!isReplay) { d.watchdog.noteDaemonAnswered(); }
    let t = frameType(f);
    let isTagged = isTaskTurnId(frameTurnId(f));
    if (isTagged) {
      appendTaggedFrame(d.sb, d.tagged, f);
    } else {
      appendFrame(d.sb, d.rk, f);
    }
    if (t == SESSION_HELLO) { applyHello(d, f); }
    if (t == TURN_START) { applyTurnStart(d, f, isTagged); }
    if (t == TEXT_DELTA && !isTagged) {
      let delta = decodeTextDelta(f);
      if (delta != null) { d.planTracker.noteAssistantText(delta.text); }
    }
    if (t == APPROVAL_REQUEST) {
      let req = decodeApprovalRequest(f);
      if (req != null) {
        beginApprovalBlockLocal(d.sb, d.pendingApproval, req.callId, req.tool, req.summary, req.detail);
      }
    }
    if (t == MODE_CHANGED) { applyModeChanged(d, f); }
    if (t == MODEL_CHANGED) {
      let modelChanged = decodeModelChanged(f);
      if (modelChanged != null) { d.state.model = modelChanged.model; }
    }
    if (t == DAEMON_STOPPING) {
      applyStopping(d, f);
      daemonStopped = true;
    }
    if (t == TURN_END && !isTagged) {
      maybeOfferPlanDecision(d.planPending, d.planTracker, d.approvalLog.mode, d.sb, f);
    }
    d.paint();
  }
  return daemonStopped;
}
