import { Session } from "../session/session.ts";
import { Gate, MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_SAFE_AUTO, MODE_FULL_AUTO, MODE_PLAN } from "../approval/gate.ts";
import { PROTOCOL_VERSION, modeSetFrameMode, MODE_CHANGED, ModeChangedFrame, encodeModeChanged, ERROR, ErrorFrame, encodeError } from "../protocol/frames.ts";

function isValidDaemonMode(mode: string): bool {
  if (mode == MODE_READ_ONLY || mode == MODE_AUTO_EDIT || mode == MODE_SAFE_AUTO) { return true; }
  return mode == MODE_FULL_AUTO || mode == MODE_PLAN;
}

export function handleModeSet(session: Session, gate: Gate, frameJson: string): void {
  let mode = modeSetFrameMode(frameJson);
  if (mode == "") { return; }
  if (isValidDaemonMode(mode)) {
    gate.mode = mode;
    let changed: ModeChangedFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: MODE_CHANGED, mode: mode };
    session.emit(encodeModeChanged(changed));
    return;
  }
  let err: ErrorFrame = {
    v: PROTOCOL_VERSION, seq: session.takeSeq(), type: ERROR, code: "mode.invalid",
    message: "unknown mode: " + mode + " (expected read-only, auto-edit, safe-auto, full-auto, or plan)",
  };
  session.emit(encodeError(err));
}
