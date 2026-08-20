import { Session } from "../session/session.ts";
import { Gate } from "../approval/gate.ts";
import { frameType, decodeInput, decodeCancel, decodeApprovalReply, INPUT, CANCEL, APPROVAL_REPLY } from "../protocol/frames.ts";
import { RelayClient } from "../relay/client.ts";

export class RelayInputBridge {
  busy: bool;
  pending: string[];

  constructor() {
    this.busy = false;
    this.pending = [];
  }

  runNow(session: Session, text: string): void {
    this.busy = true;
    session.submit(text);
    this.busy = false;
    this.drainPending(session);
  }

  drainPending(session: Session): void {
    while (this.pending.length > 0) {
      let next = this.pending[0];
      this.pending = this.pending.slice(1);
      this.busy = true;
      session.submit(next);
      this.busy = false;
    }
  }

  offer(session: Session, text: string): void {
    if (this.busy) {
      this.pending.push(text);
      return;
    }
    this.runNow(session, text);
  }
}

export function dispatchInboundFrame(session: Session, gate: Gate, bridge: RelayInputBridge, frameJson: string): void {
  let t = frameType(frameJson);
  if (t == INPUT) {
    let f = decodeInput(frameJson);
    if (f != null) { bridge.offer(session, f.text); }
    return;
  }
  if (t == CANCEL) {
    let f = decodeCancel(frameJson);
    if (f != null) { session.cancel(f.turnId); }
    return;
  }
  if (t == APPROVAL_REPLY) {
    let f = decodeApprovalReply(frameJson);
    if (f != null) { gate.reply(f.callId, f.decision); }
    return;
  }
}

export function pollRelay(relay: RelayClient, session: Session, gate: Gate, bridge: RelayInputBridge): string[] {
  let frames = relay.pollInbound();
  for (const f of frames) {
    dispatchInboundFrame(session, gate, bridge, f);
  }
  return relay.drainDiagnostics();
}
