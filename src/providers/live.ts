import { Message, Provider, ProviderReply } from "../session/types.ts";
import { Session } from "../session/session.ts";
import { ProviderConfig, ToolSchema, streamChat } from "./openai.ts";
import { readByteTimeout } from "../vendor/tty/tty.ts";

const CTRL_C: int = 3;

export class CancelWatch {
  seen: bool;
  constructor() {
    this.seen = false;
  }
  poll(fd: int): void {
    let b = readByteTimeout(fd, 0);
    if (b == CTRL_C) {
      this.seen = true;
    }
  }
  tripped(): bool {
    return this.seen;
  }
  reset(): void {
    this.seen = false;
  }
}

export class TurnTracker {
  current: string;
  tokens: int;
  constructor() {
    this.current = "";
    this.tokens = 0;
  }
  setCurrent(id: string): void {
    this.current = id;
    this.tokens = 0;
  }
  addTokens(n: int): void {
    this.tokens = this.tokens + n;
  }
}

export class LiveProvider {
  cfg: ProviderConfig;
  toolSchemas: ToolSchema[];
  watch: CancelWatch;
  stdinFd: int;
  tracker: TurnTracker;
  sessionSlot: Session[];
  deltaSlot: ((text: string) => void)[];

  constructor(cfg: ProviderConfig, toolSchemas: ToolSchema[], watch: CancelWatch, stdinFd: int, tracker: TurnTracker) {
    this.cfg = cfg;
    this.toolSchemas = toolSchemas;
    this.watch = watch;
    this.stdinFd = stdinFd;
    this.tracker = tracker;
    this.sessionSlot = [];
    this.deltaSlot = [];
  }

  setSession(s: Session): void {
    this.sessionSlot = [s];
  }

  ask(history: Message[], onDelta: (text: string) => void): ProviderReply {
    this.watch.reset();
    this.deltaSlot = [onDelta];
    let wrapped = (chunk: string) => {
      this.deltaSlot[0](chunk);
      this.watch.poll(this.stdinFd);
      if (this.watch.tripped() && this.sessionSlot.length > 0) {
        this.sessionSlot[0].cancel(this.tracker.current);
      }
    };
    let shouldStop = () => this.watch.tripped();
    let reply = streamChat(this.cfg, history, this.toolSchemas, wrapped, shouldStop);
    this.tracker.addTokens(reply.tokens);
    return reply;
  }
}
