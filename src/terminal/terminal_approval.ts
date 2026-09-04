import { readKeyTimeout, KEY_CHAR, KEY_ENTER, KEY_CTRL_C, KEY_CTRL_O, KEY_ARROW_UP, KEY_ARROW_DOWN } from "../vendor/tty/tty.ts";
import { InputLine, PendingApproval, approvalOptionForChar, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { PROTOCOL_VERSION, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest } from "../protocol/frames.ts";
import { Scrollback } from "./scrollback.ts";
import { TurnStatusTracker, drawScreen, runRelayTick } from "./screen.ts";
import { TurnTracker, LiveProvider } from "../providers/live.ts";
import { repaintApprovalOptions, answerApproval, denyPendingApproval, reportIfResolvedElsewhere } from "./approval_ui.ts";
import { noteApprovalBlock } from "./approval_settled.ts";
import { GateBox, RelayBox, TasksBox, screenRows } from "./slots.ts";
import { isPointerKey, handlePointerKey } from "./mouse_select.ts";

const STDIN: int = 0;

export class ApprovalDeps {
  sb: Scrollback;
  input: InputLine;
  rk: TurnStatusTracker;
  pendingApproval: PendingApproval;
  live: LiveProvider;
  tracker: TurnTracker;
  gateBox: GateBox;
  relayBox: RelayBox;
  tasksBox: TasksBox;

  constructor(sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pendingApproval: PendingApproval, live: LiveProvider, tracker: TurnTracker, gateBox: GateBox, relayBox: RelayBox, tasksBox: TasksBox) {
    this.sb = sb;
    this.input = input;
    this.rk = rk;
    this.pendingApproval = pendingApproval;
    this.live = live;
    this.tracker = tracker;
    this.gateBox = gateBox;
    this.relayBox = relayBox;
    this.tasksBox = tasksBox;
  }

  hasGate(): bool {
    return this.gateBox.slot.length > 0;
  }

  repaint(): void {
    drawScreen(this.sb, this.input, this.gateBox.slot[0].mode, this.rk);
  }
}

export function emitApprovalRequest(d: ApprovalDeps, callId: string, tool: string, summary: string, args: string): void {
  d.pendingApproval.begin(callId, tool);
  if (d.live.sessionSlot.length == 0) { return; }
  let s = d.live.sessionSlot[0];
  let frame: ApprovalRequestFrame = {
    v: PROTOCOL_VERSION, seq: s.takeSeq(), type: APPROVAL_REQUEST,
    turnId: d.tracker.current, callId: callId, tool: tool, summary: summary, detail: args, args: args,
  };
  s.emit(encodeApprovalRequest(frame));
  noteApprovalBlock(d.sb, d.pendingApproval, summary, args);
}

function pumpBackground(d: ApprovalDeps): void {
  if (d.relayBox.relaySlot.length > 0 && d.hasGate()) {
    runRelayTick(d.relayBox.relaySlot[0], d.relayBox.sessionSlot[0], d.gateBox.slot[0], d.relayBox.bridgeSlot[0], d.sb, d.input, d.rk);
    reportIfResolvedElsewhere(d.gateBox.slot[0], d.sb, d.input, d.rk, d.pendingApproval);
  }
  if (d.tasksBox.slot.length > 0 && d.relayBox.sessionSlot.length > 0) {
    d.tasksBox.slot[0].poll(d.relayBox.sessionSlot[0]);
  }
}

export function pollApprovalKeys(d: ApprovalDeps): void {
  pumpBackground(d);
  let k = readKeyTimeout(STDIN, 0);

  if (isPointerKey(k.kind)) {
    if (handlePointerKey(k, d.sb, d.input, screenRows()) && d.hasGate()) { d.repaint(); }
    return;
  }

  if ((k.kind == KEY_ARROW_UP || k.kind == KEY_ARROW_DOWN) && d.hasGate()) {
    let delta = 1;
    if (k.kind == KEY_ARROW_UP) { delta = -1; }
    if (d.pendingApproval.moveSelection(delta, APPROVAL_OPTION_COUNT)) {
      repaintApprovalOptions(d.sb, d.pendingApproval);
      d.repaint();
    }
    return;
  }

  if (k.kind == KEY_ENTER && d.hasGate() && d.pendingApproval.callId != "") {
    answerApproval(d.gateBox.slot[0], d.sb, d.input, d.rk, d.pendingApproval, d.pendingApproval.selected);
    return;
  }

  if (k.kind == KEY_CHAR && approvalOptionForChar(k.char) >= 0 && d.hasGate() && d.pendingApproval.callId != "") {
    answerApproval(d.gateBox.slot[0], d.sb, d.input, d.rk, d.pendingApproval, approvalOptionForChar(k.char));
    return;
  }

  if (k.kind == KEY_CTRL_O && d.hasGate()) {
    if (d.sb.toggleLastGroup()) { d.repaint(); }
    return;
  }

  if (k.kind == KEY_CTRL_C) {
    if (d.hasGate()) { denyPendingApproval(d.gateBox.slot[0], d.sb, d.input, d.rk, d.pendingApproval); }
    if (d.live.sessionSlot.length > 0) { d.live.sessionSlot[0].cancel(d.tracker.current); }
  }
}
