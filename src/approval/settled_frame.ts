import { Session } from "../session/session.ts";
import { PROTOCOL_VERSION, APPROVAL_SETTLED, DECISION_ALLOW, DECIDED_BY_MODE, ApprovalSettledFrame, encodeApprovalSettled } from "../protocol/frames.ts";

export function emitApprovalSettled(sessions: Session[], turnId: string, callId: string, summary: string, args: string): void {
  if (sessions.length == 0) { return; }
  let s = sessions[0];
  let f: ApprovalSettledFrame = {
    v: PROTOCOL_VERSION, seq: s.takeSeq(), type: APPROVAL_SETTLED, turnId: turnId, callId: callId,
    summary: summary, detail: args, decision: DECISION_ALLOW, decidedBy: DECIDED_BY_MODE,
  };
  s.emit(encodeApprovalSettled(f));
}
