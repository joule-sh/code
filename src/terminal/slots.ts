import { rows } from "../vendor/tty/tty.ts";
import { Gate, MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_SAFE_AUTO, MODE_FULL_AUTO } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { RelayClient } from "../relay/client.ts";
import { RelayInputBridge } from "./relay_bridge.ts";
import { TaskManager } from "../tasks/manager.ts";

const STDIN: int = 0;

export function screenRows(): int {
  let r = rows(STDIN);
  if (r <= 1) { r = 24; }
  return r;
}

export function hasFlag(argv: string[], name: string): bool {
  for (const a of argv) {
    if (a == name) {
      return true;
    }
  }
  return false;
}

export function isValidMode(mode: string): bool {
  return mode == MODE_READ_ONLY || mode == MODE_AUTO_EDIT || mode == MODE_SAFE_AUTO || mode == MODE_FULL_AUTO;
}

export function nextMode(mode: string): string {
  if (mode == MODE_READ_ONLY) { return MODE_AUTO_EDIT; }
  if (mode == MODE_AUTO_EDIT) { return MODE_SAFE_AUTO; }
  if (mode == MODE_SAFE_AUTO) { return MODE_FULL_AUTO; }
  return MODE_READ_ONLY;
}

export class GateBox {
  slot: Gate[];
  constructor() {
    this.slot = [];
  }
  set(g: Gate): void {
    this.slot = [g];
  }
}

export class RelayBox {
  relaySlot: RelayClient[];
  sessionSlot: Session[];
  bridgeSlot: RelayInputBridge[];
  constructor() {
    this.relaySlot = [];
    this.sessionSlot = [];
    this.bridgeSlot = [];
  }
  set(r: RelayClient, s: Session, b: RelayInputBridge): void {
    this.relaySlot = [r];
    this.sessionSlot = [s];
    this.bridgeSlot = [b];
  }
}

export class TasksBox {
  slot: TaskManager[];
  constructor() {
    this.slot = [];
  }
  set(t: TaskManager): void {
    this.slot = [t];
  }
}
