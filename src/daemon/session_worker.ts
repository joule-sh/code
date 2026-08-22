import { Session } from "../session/session.ts";
import { Gate } from "../approval/gate.ts";
import { TaskManager } from "../tasks/manager.ts";
import { RelayInputBridge, dispatchInboundFrame } from "../terminal/relay_bridge.ts";
import { InboxDrain } from "./inbox.ts";

export const SESSION_TICK_MS: int = 75;

export class SessionWorker {
  runtimeDir: string;
  session: Session;
  gate: Gate;
  tasks: TaskManager;
  bridge: RelayInputBridge;
  inbox: InboxDrain;
  running: bool;

  constructor(runtimeDir: string, session: Session, gate: Gate, tasks: TaskManager) {
    this.runtimeDir = runtimeDir;
    this.session = session;
    this.gate = gate;
    this.tasks = tasks;
    this.bridge = new RelayInputBridge();
    this.inbox = new InboxDrain(runtimeDir);
    this.running = true;
  }

  drainOnce(): int {
    let frames = this.inbox.drainAll();
    for (const f of frames) {
      dispatchInboundFrame(this.session, this.gate, this.bridge, f);
    }
    return frames.length;
  }

  tick(): void {
    this.drainOnce();
    this.tasks.poll(this.session);
  }

  stop(): void {
    this.running = false;
  }

  loop(): int {
    let ticks = 0;
    while (this.running) {
      this.tick();
      process.sleep(SESSION_TICK_MS);
      ticks = ticks + 1;
    }
    return ticks;
  }
}
