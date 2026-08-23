import { Session } from "../session/session.ts";
import { ShareController } from "./share_controller.ts";
import { PROTOCOL_VERSION, SHARE_STARTED, ShareStartedFrame, encodeShareStarted, SHARE_FAILED, ShareFailedFrame, encodeShareFailed } from "../protocol/frames.ts";

export function handleShareRequest(session: Session, uplink: ShareController | null, model: string): void {
  if (uplink == null) {
    let unavailable: ShareFailedFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: SHARE_FAILED, error: "sharing is not available on this daemon" };
    session.emit(encodeShareFailed(unavailable));
  } else {
    let result = uplink.ensureStarted(session.workspaceRoot, model);
    if (result.ok) {
      let started: ShareStartedFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: SHARE_STARTED, code: result.code, url: result.url };
      session.emit(encodeShareStarted(started));
    } else {
      let failed: ShareFailedFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: SHARE_FAILED, error: result.error };
      session.emit(encodeShareFailed(failed));
    }
  }
}
