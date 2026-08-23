import { Session } from "../session/session.ts";
import { Gate } from "../approval/gate.ts";
import { LiveProvider } from "../providers/live.ts";
import { TaskManager } from "../tasks/manager.ts";
import { RelayInputBridge, dispatchInboundFrame } from "../terminal/relay_bridge.ts";
import { ShareController } from "./share_controller.ts";
import { handleModeSet } from "./dispatch_mode.ts";
import { handleModelSet } from "./dispatch_model.ts";
import { handleTasksRequest } from "./dispatch_tasks.ts";
import { handleShareRequest } from "./dispatch_share.ts";
import { tryDispatchTaskApprovalReply } from "./dispatch_task_approval.ts";
import { frameType, PROTOCOL_VERSION, MODE_SET, MODEL_SET, TASKS_REQUEST, DAEMON_STOP, DAEMON_STOPPING, DaemonStoppingFrame, encodeDaemonStopping, SHARE_REQUEST, APPROVAL_REPLY } from "../protocol/frames.ts";

function handleDaemonStop(session: Session): void {
  let stopping: DaemonStoppingFrame = {
    v: PROTOCOL_VERSION, seq: session.takeSeq(), type: DAEMON_STOPPING,
    reason: "an attached client asked the daemon to stop",
  };
  session.emit(encodeDaemonStopping(stopping));
}

export function dispatchDaemonFrame(session: Session, gate: Gate, live: LiveProvider, tasks: TaskManager, bridge: RelayInputBridge, uplink: ShareController | null, frameJson: string): bool {
  let t = frameType(frameJson);

  if (t == MODE_SET) { handleModeSet(session, gate, frameJson); return false; }
  if (t == MODEL_SET) { handleModelSet(session, live, frameJson); return false; }
  if (t == TASKS_REQUEST) { handleTasksRequest(session, tasks, frameJson); return false; }
  if (t == DAEMON_STOP) { handleDaemonStop(session); return true; }
  if (t == SHARE_REQUEST) { handleShareRequest(session, uplink, live.cfg.model); return false; }
  if (t == APPROVAL_REPLY && tryDispatchTaskApprovalReply(tasks, frameJson)) { return false; }

  dispatchInboundFrame(session, gate, bridge, frameJson);
  return false;
}
