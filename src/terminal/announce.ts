import { Session } from "../session/session.ts";
import { PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello, MODE_CHANGED, ModeChangedFrame, encodeModeChanged, MODEL_CHANGED, ModelChangedFrame, encodeModelChanged } from "../protocol/frames.ts";
import { VERSION } from "../version.ts";

export function shareHello(session: Session, sessionId: string, workspace: string, sessionName: string, model: string, mode: string): string {
  let hello: SessionHelloFrame = {
    v: PROTOCOL_VERSION, seq: session.takeSeq(), type: SESSION_HELLO,
    sessionId: sessionId, workspace: workspace, session: sessionName, model: model,
    mode: mode, protocol: PROTOCOL_VERSION, build: VERSION,
  };
  return encodeSessionHello(hello);
}

export function announceMode(session: Session, mode: string): void {
  let changed: ModeChangedFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: MODE_CHANGED, mode: mode };
  session.emit(encodeModeChanged(changed));
}

export function announceModel(session: Session, model: string): void {
  let changed: ModelChangedFrame = { v: PROTOCOL_VERSION, seq: session.takeSeq(), type: MODEL_CHANGED, model: model };
  session.emit(encodeModelChanged(changed));
}
