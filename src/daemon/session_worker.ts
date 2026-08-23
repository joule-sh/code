import { Session } from "../session/session.ts";
import { Gate } from "../approval/gate.ts";
import { LiveProvider } from "../providers/live.ts";
import { TaskManager } from "../tasks/manager.ts";
import { RelayInputBridge } from "../terminal/relay_bridge.ts";
import { ShareController } from "./share_controller.ts";
import { InboxDrain } from "./inbox.ts";
import { dispatchDaemonFrame } from "./dispatch.ts";

export const SESSION_TICK_MS: int = 75;
export const STOP_GRACE_MS: int = 400;

export class SessionWorker {
  runtimeDir: string;
  session: Session;
  gate: Gate;
  live: LiveProvider;
  tasks: TaskManager;
  bridge: RelayInputBridge;
  inbox: InboxDrain;
  running: bool;
  stopAt: i64;
  relayUplinkSlot: ShareController[];

  constructor(runtimeDir: string, session: Session, gate: Gate, live: LiveProvider, tasks: TaskManager) {
    this.runtimeDir = runtimeDir;
    this.session = session;
    this.gate = gate;
    this.live = live;
    this.tasks = tasks;
    this.bridge = new RelayInputBridge();
    this.inbox = new InboxDrain(runtimeDir);
    this.running = true;
    this.stopAt = 0;
    this.relayUplinkSlot = [];
  }

  setRelayUplink(uplink: ShareController): void {
    this.relayUplinkSlot = [uplink];
  }

  currentUplink(): ShareController | null {
    if (this.relayUplinkSlot.length == 0) { return null; }
    return this.relayUplinkSlot[0];
  }

  drainOnce(): int {
    let frames = this.inbox.drainAll();
    let inboxUplink = this.currentUplink();
    for (const f of frames) {
      let wantsStop = dispatchDaemonFrame(this.session, this.gate, this.live, this.tasks, this.bridge, inboxUplink, f);
      if (wantsStop) { this.requestStop(STOP_GRACE_MS); }
    }
    return frames.length;
  }

  tick(): void {
    this.drainOnce();
    this.tasks.poll(this.session);
    this.pollRelayUplink();
  }

  pollRelayUplink(): void {
    let activeUplink = this.currentUplink();
    if (activeUplink != null) { activeUplink.tick(this.session, this.gate, this.bridge); }
  }

  pollForApproval(): void {
    this.drainOnce();
    this.pollRelayUplink();
  }

  requestStop(graceMs: int): void {
    if (this.stopAt != 0) { return; }
    this.stopAt = Date.now() + graceMs;
  }

  stop(): void {
    this.running = false;
  }

  shouldStop(): bool {
    return this.stopAt != 0 && Date.now() >= this.stopAt;
  }

  loop(): int {
    let ticks = 0;
    while (this.running && !this.shouldStop()) {
      this.tick();
      process.sleep(SESSION_TICK_MS);
      ticks = ticks + 1;
    }
    return ticks;
  }
}
