import { Session } from "../session/session.ts";
import { Gate } from "../approval/gate.ts";
import { RelayInputBridge } from "../terminal/relay_bridge.ts";

export type ShareResult = { ok: bool, code: string, url: string, error: string };

export type ShareController = {
  ensureStarted: (workspaceRoot: string, model: string) => ShareResult,
  tick: (session: Session, gate: Gate, bridge: RelayInputBridge) => void,
};
