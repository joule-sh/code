import { PROTOCOL_VERSION, ERROR, ErrorFrame, encodeError } from "../protocol/frames.ts";

export const ANSWER_GRACE_MS: i64 = 10000;
export const WATCHDOG_CODE: string = "daemon.silent";

export function silentDaemonMessage(port: int): string {
  return "the daemon on 127.0.0.1:" + `${port}` + " has not answered this request in 10s and has not started a turn - it is attached but not working, so stop it with joule --stop and run joule again, and see its log (docs/03-daemon.md names the path) for what it received";
}

export class TurnWatchdog {
  port: int;
  waiting: bool;
  waitingSince: i64;
  reported: bool;

  constructor(port: int) {
    this.port = port;
    this.waiting = false;
    this.waitingSince = 0;
    this.reported = false;
  }

  noteRequestSent(now: i64): void {
    this.waiting = true;
    this.waitingSince = now;
    this.reported = false;
  }

  noteDaemonAnswered(): void {
    this.waiting = false;
    this.waitingSince = 0;
    this.reported = false;
  }

  overdue(now: i64): bool {
    if (!this.waiting) { return false; }
    if (this.reported) { return false; }
    return now - this.waitingSince >= ANSWER_GRACE_MS;
  }

  takeOverdueNotice(now: i64): string {
    if (!this.overdue(now)) { return ""; }
    this.reported = true;
    let f: ErrorFrame = {
      v: PROTOCOL_VERSION, seq: 0, type: ERROR,
      code: WATCHDOG_CODE, message: silentDaemonMessage(this.port),
    };
    return encodeError(f);
  }
}
