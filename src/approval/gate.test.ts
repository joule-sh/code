import { Gate, MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_SAFE_AUTO, MODE_FULL_AUTO, MODE_PLAN, REPLY_ALLOW, REPLY_DENY, REPLY_ALWAYS } from "./gate.ts";

class Recorder {
  requests: string[];
  argsSeen: string[];
  polls: int;
  constructor() {
    this.requests = [];
    this.argsSeen = [];
    this.polls = 0;
  }
  onRequest(callId: string, tool: string, summary: string, args: string): void {
    this.requests.push(callId + ":" + tool);
    this.argsSeen.push(args);
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

function runCmd(command: string): string {
  return "{\"command\":\"" + command + "\"}";
}

test("read-only: read tools auto, write/edit/run refused without ever asking", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_READ_ONLY, 1000, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  expect(g.check("c1", "read", "", "").allow);
  expect(g.check("c2", "list", "", "").allow);
  expect(g.check("c3", "grep", "", "").allow);
  expect(!g.check("c4", "write", "", "").allow);
  expect(!g.check("c5", "edit", "", "").allow);
  expect(!g.check("c6", "run", "", "").allow);
  expect(rec.requests.length == 0);
});

test("auto-edit: read/write/edit auto, run asks", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_AUTO_EDIT, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  expect(g.check("c1", "read", "", "").allow);
  expect(g.check("c2", "write", "", "").allow);
  expect(g.check("c3", "edit", "", "").allow);
  expect(rec.requests.length == 0);

  let denied = g.check("c4", "run", "npm test", "{\"command\":\"npm test\"}");
  expect(!denied.allow);
  expect(rec.requests.length == 1);
  expect(rec.requests[0] == "c4:run");
});

test("full-auto: everything auto, nothing asked", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_FULL_AUTO, 1000, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  expect(g.check("c1", "read", "", "").allow);
  expect(g.check("c2", "write", "", "").allow);
  expect(g.check("c3", "edit", "", "").allow);
  expect(g.check("c4", "run", "", "").allow);
  expect(rec.requests.length == 0);
});

test("a reply arriving during the wait is honored before timeout", () => {
  let g = new Gate(MODE_AUTO_EDIT, 5000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  let injector = new PollInjector("c1", REPLY_ALLOW, 2, (c: string, d: string) => { g.reply(c, d); });
  g.setOnPoll(() => { injector.onPoll(); });
  let d = g.check("c1", "run", "run tests", "{\"command\":\"npm test\"}");
  expect(d.allow);
});

test("a deny reply is honored", () => {
  let g = new Gate(MODE_AUTO_EDIT, 5000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  let injector = new PollInjector("c1", REPLY_DENY, 2, (c: string, d: string) => { g.reply(c, d); });
  g.setOnPoll(() => { injector.onPoll(); });
  let d = g.check("c1", "run", "run tests", "{\"command\":\"npm test\"}");
  expect(!d.allow);
});

test("always is remembered for the rest of the session, per tool, not re-asked", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_AUTO_EDIT, 5000, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => {});
  let injector = new PollInjector("c1", REPLY_ALWAYS, 1, (c: string, d: string) => { g.reply(c, d); });
  g.setOnPoll(() => { injector.onPoll(); });

  let d1 = g.check("c1", "run", "run tests", "{\"command\":\"npm test\"}");
  expect(d1.allow);
  expect(rec.requests.length == 1);

  let d2 = g.check("c2", "run", "run tests again", "{\"command\":\"npm test\"}");
  expect(d2.allow);
  expect(rec.requests.length == 1);
});

test("an unanswered request times out into a denial", () => {
  let g = new Gate(MODE_AUTO_EDIT, 250, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  let d = g.check("c1", "run", "npm test", "{\"command\":\"npm test\"}");
  expect(!d.allow);
});

test("a reply for an unknown or already-decided callId is ignored", () => {
  let g = new Gate(MODE_AUTO_EDIT, 5000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  expect(g.reply("never-asked", REPLY_ALLOW));
  expect(g.findReply("never-asked") == REPLY_ALLOW);

  expect(!g.reply("never-asked", REPLY_DENY));
  expect(g.findReply("never-asked") == REPLY_ALLOW);
});

test("two replies for one call take the first, and the second is reported as not applied", () => {
  let g = new Gate(MODE_AUTO_EDIT, 5000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  expect(g.reply("c1", REPLY_ALLOW));
  expect(!g.reply("c1", REPLY_DENY));
  expect(g.findReply("c1") == REPLY_ALLOW);
});

test("the keyboard path and the browser path answering the same call id: the first sticks, the second is refused", () => {
  let g = new Gate(MODE_AUTO_EDIT, 5000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  let keyboardApplied = g.reply("c1", REPLY_ALLOW);
  let browserApplied = g.reply("c1", REPLY_DENY);
  expect(keyboardApplied);
  expect(!browserApplied);
  expect(g.findReply("c1") == REPLY_ALLOW);

  let g2 = new Gate(MODE_AUTO_EDIT, 5000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  let browserFirst = g2.reply("c2", REPLY_DENY);
  let keyboardSecond = g2.reply("c2", REPLY_ALLOW);
  expect(browserFirst);
  expect(!keyboardSecond);
  expect(g2.findReply("c2") == REPLY_DENY);
});

test("the raw tool call args flow through check() into the onRequest callback unchanged", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_AUTO_EDIT, 1000, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let injector = new PollInjector("c1", REPLY_ALLOW, 1, (c: string, d: string) => { g.reply(c, d); });
  g.setOnPoll(() => { injector.onPoll(); });

  let rawArgs = "{\"command\":\"rm -rf build\"}";
  g.check("c1", "run", "run rm -rf build", rawArgs);
  expect(rec.argsSeen.length == 1);
  expect(rec.argsSeen[0] == rawArgs);
});

test("safe-auto: read/write/edit auto, exactly like auto-edit", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_SAFE_AUTO, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  expect(g.check("c1", "read", "", "").allow);
  expect(g.check("c2", "write", "", "").allow);
  expect(g.check("c3", "edit", "", "").allow);
  expect(rec.requests.length == 0);
});

test("safe-auto: an allow-listed command runs without ever asking", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_SAFE_AUTO, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = g.check("c1", "run", "git status", runCmd("git status"));
  expect(d.allow);
  expect(rec.requests.length == 0);
});

test("safe-auto: a command absent from the allow list still prompts", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_SAFE_AUTO, 250, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = g.check("c1", "run", "npm install", runCmd("npm install"));
  expect(!d.allow);
  expect(rec.requests.length == 1);
});

test("safe-auto: a deny-list match prompts even though the command name is otherwise allow-listed", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_SAFE_AUTO, 250, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = g.check("c1", "run", "git push --force", runCmd("git push --force"));
  expect(!d.allow);
  expect(rec.requests.length == 1);
});

test("safe-auto: the deny list wins over an allow-listed reading of the same command", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_SAFE_AUTO, 250, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = g.check("c1", "run", "cat build/id_rsa", runCmd("cat build/id_rsa"));
  expect(!d.allow);
  expect(rec.requests.length == 1);
});

test("safe-auto: an always reply for run stops future run calls from being asked at all", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_SAFE_AUTO, 5000, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => {});
  let injector = new PollInjector("c1", REPLY_ALWAYS, 1, (c: string, d: string) => { g.reply(c, d); });
  g.setOnPoll(() => { injector.onPoll(); });

  let d1 = g.check("c1", "run", "npm install", runCmd("npm install"));
  expect(d1.allow);
  expect(rec.requests.length == 1);

  let d2 = g.check("c2", "run", "npm install", runCmd("npm install"));
  expect(d2.allow);
  expect(rec.requests.length == 1);
});

test("plan: read tools auto, never asked", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_PLAN, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  expect(g.check("c1", "read", "", "").allow);
  expect(g.check("c2", "list", "", "").allow);
  expect(g.check("c3", "grep", "", "").allow);
  expect(rec.requests.length == 0);
});

test("plan: write and edit are refused outright, never asked", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_PLAN, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  expect(!g.check("c1", "write", "", "").allow);
  expect(!g.check("c2", "edit", "", "").allow);
  expect(rec.requests.length == 0);
});

test("plan: a side-effecting run is refused outright, never asked", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_PLAN, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = g.check("c1", "run", "npm install", runCmd("npm install"));
  expect(!d.allow);
  expect(rec.requests.length == 0);
});

test("plan: spawn_agent and task_status are refused outright, plan mode is not just about run", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_PLAN, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  expect(!g.check("c1", "spawn_agent", "", "").allow);
  expect(!g.check("c2", "task_status", "", "").allow);
  expect(rec.requests.length == 0);
});

test("plan: an investigative run command auto-runs without ever asking", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_PLAN, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = g.check("c1", "run", "git status", runCmd("git status"));
  expect(d.allow);
  expect(rec.requests.length == 0);
});

test("plan: npm test does not auto-run even though safe-auto allows it - plan is stricter", () => {
  let rec = new Recorder();
  let planGate = new Gate(MODE_PLAN, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = planGate.check("c1", "run", "npm test", runCmd("npm test"));
  expect(!d.allow);
  expect(rec.requests.length == 0);

  let rec2 = new Recorder();
  let safeAutoGate = new Gate(MODE_SAFE_AUTO, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec2.onRequest(c, t, s, a); }, () => { rec2.onPoll(); });
  let d2 = safeAutoGate.check("c1", "run", "npm test", runCmd("npm test"));
  expect(d2.allow);
});

test("plan: a compound command is refused outright, not partially matched", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_PLAN, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = g.check("c1", "run", "git status; rm -rf x", runCmd("git status; rm -rf x"));
  expect(!d.allow);
  expect(rec.requests.length == 0);
});

test("plan: a path-qualified command is refused outright", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_PLAN, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = g.check("c1", "run", "/bin/ls", runCmd("/bin/ls"));
  expect(!d.allow);
  expect(rec.requests.length == 0);
});

test("plan: the deny list wins over an allow-listed reading of the same command", () => {
  let rec = new Recorder();
  let g = new Gate(MODE_PLAN, 300, "/repo", (c: string, t: string, s: string, a: string) => { rec.onRequest(c, t, s, a); }, () => { rec.onPoll(); });
  let d = g.check("c1", "run", "cat build/id_rsa", runCmd("cat build/id_rsa"));
  expect(!d.allow);
  expect(rec.requests.length == 0);
});
