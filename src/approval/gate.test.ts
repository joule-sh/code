import { Gate, MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_FULL_AUTO, REPLY_ALLOW, REPLY_DENY, REPLY_ALWAYS } from "./gate.ts";

class Recorder {
  requests: string[];
  polls: int;
  constructor() {
    this.requests = [];
    this.polls = 0;
  }
  onRequest(callId: string, tool: string, summary: string): void {
    this.requests.push(callId + ":" + tool);
  }
  onPoll(): void {
    this.polls = this.polls + 1;
  }
}

class PollInjector {
  callId: string;
  decision: string;
  afterPolls: int;
  pollCount: int;
  replyFn: (callId: string, decision: string) => void;

  constructor(callId: string, decision: string, afterPolls: int, replyFn: (callId: string, decision: string) => void) {
    this.callId = callId;
    this.decision = decision;
    this.afterPolls = afterPolls;
    this.pollCount = 0;
    this.replyFn = replyFn;
  }

  onPoll(): void {
    this.pollCount = this.pollCount + 1;
    if (this.pollCount >= this.afterPolls) {
      this.replyFn(this.callId, this.decision);
    }
  }
}

test("read-only: read tools auto, write/edit/run refused without ever asking", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_READ_ONLY, 1000, (c: string, t: string, s: string) => { rec.onRequest(c, t, s); }, () => { rec.onPoll(); });
  expect(g.check("c1", "read", "").allow);
  expect(g.check("c2", "list", "").allow);
  expect(g.check("c3", "grep", "").allow);
  expect(!g.check("c4", "write", "").allow);
  expect(!g.check("c5", "edit", "").allow);
  expect(!g.check("c6", "run", "").allow);
  expect(rec.requests.length == 0);
});

test("auto-edit: read/write/edit auto, run asks", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_AUTO_EDIT, 300, (c: string, t: string, s: string) => { rec.onRequest(c, t, s); }, () => { rec.onPoll(); });
  expect(g.check("c1", "read", "").allow);
  expect(g.check("c2", "write", "").allow);
  expect(g.check("c3", "edit", "").allow);
  expect(rec.requests.length == 0);

  let denied = g.check("c4", "run", "npm test");
  expect(!denied.allow);
  expect(rec.requests.length == 1);
  expect(rec.requests[0] == "c4:run");
});

test("full-auto: everything auto, nothing asked", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_FULL_AUTO, 1000, (c: string, t: string, s: string) => { rec.onRequest(c, t, s); }, () => { rec.onPoll(); });
  expect(g.check("c1", "read", "").allow);
  expect(g.check("c2", "write", "").allow);
  expect(g.check("c3", "edit", "").allow);
  expect(g.check("c4", "run", "").allow);
  expect(rec.requests.length == 0);
});

test("a reply arriving during the wait is honored before timeout", () => {
  let g = new Gate(MODE_AUTO_EDIT, 5000, (c: string, t: string, s: string) => {}, () => {});
  let injector = new PollInjector("c1", REPLY_ALLOW, 2, (c: string, d: string) => { g.reply(c, d); });
  g.setOnPoll(() => { injector.onPoll(); });
  let d = g.check("c1", "run", "run tests");
  expect(d.allow);
});

test("a deny reply is honored", () => {
  let g = new Gate(MODE_AUTO_EDIT, 5000, (c: string, t: string, s: string) => {}, () => {});
  let injector = new PollInjector("c1", REPLY_DENY, 2, (c: string, d: string) => { g.reply(c, d); });
  g.setOnPoll(() => { injector.onPoll(); });
  let d = g.check("c1", "run", "run tests");
  expect(!d.allow);
});

test("always is remembered for the rest of the session, per tool, not re-asked", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_AUTO_EDIT, 5000, (c: string, t: string, s: string) => { rec.onRequest(c, t, s); }, () => {});
  let injector = new PollInjector("c1", REPLY_ALWAYS, 1, (c: string, d: string) => { g.reply(c, d); });
  g.setOnPoll(() => { injector.onPoll(); });

  let d1 = g.check("c1", "run", "run tests");
  expect(d1.allow);
  expect(rec.requests.length == 1);

  let d2 = g.check("c2", "run", "run tests again");
  expect(d2.allow);
  expect(rec.requests.length == 1);
});

test("an unanswered request times out into a denial", () => {
  let g = new Gate(MODE_AUTO_EDIT, 250, (c: string, t: string, s: string) => {}, () => {});
  let d = g.check("c1", "run", "npm test");
  expect(!d.allow);
});

test("a reply for an unknown or already-decided callId is ignored", () => {
  let g = new Gate(MODE_AUTO_EDIT, 5000, (c: string, t: string, s: string) => {}, () => {});
  g.reply("never-asked", REPLY_ALLOW);
  expect(g.findReply("never-asked") == REPLY_ALLOW);

  g.reply("never-asked", REPLY_DENY);
  expect(g.findReply("never-asked") == REPLY_ALLOW);
});

test("two replies for one call take the first", () => {
  let g = new Gate(MODE_AUTO_EDIT, 5000, (c: string, t: string, s: string) => {}, () => {});
  g.reply("c1", REPLY_ALLOW);
  g.reply("c1", REPLY_DENY);
  expect(g.findReply("c1") == REPLY_ALLOW);
});
