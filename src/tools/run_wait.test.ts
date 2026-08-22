import { waitForForegroundRun, formatForegroundResult, ForegroundResult } from "./run_wait.ts";
import { appendMailbox } from "../tasks/mailbox.ts";
import { openTestPipe, writeByteToTestPipe } from "../vendor/tty/tty.ts";

function freshMailbox(name: string): string {
  let p = "/tmp/run-wait-test-" + name + ".log";
  fs.writeFileSync(p, "");
  return p;
}

test("a command that finishes before the wait gives up is not abandoned", () => {
  let p = freshMailbox("quick");
  let fd = openTestPipe();
  appendMailbox(p, "LINE", "hi");
  appendMailbox(p, "EXIT", "0");
  appendMailbox(p, "DONE", "lines=1");
  let r = waitForForegroundRun(p, 5000, fd);
  expect(r.ok);
  expect(!r.abandoned);
  expect(r.status == 0);
  expect(r.output.indexOf("hi") >= 0);
});

test("a non-zero exit code is captured, not treated as an abandon", () => {
  let p = freshMailbox("nonzero");
  let fd = openTestPipe();
  appendMailbox(p, "EXIT", "7");
  appendMailbox(p, "DONE", "lines=0");
  let r = waitForForegroundRun(p, 5000, fd);
  expect(!r.abandoned);
  expect(r.status == 7);
});

test("output over the cap is truncated with the flag set", () => {
  let p = freshMailbox("cap");
  let fd = openTestPipe();
  let big = "";
  let i = 0;
  while (i < 20) {
    big = big + "xxxxxxxxxx";
    i = i + 1;
  }
  let j = 0;
  while (j < 600) {
    appendMailbox(p, "LINE", big);
    j = j + 1;
  }
  appendMailbox(p, "EXIT", "0");
  appendMailbox(p, "DONE", "lines=600");
  let r = waitForForegroundRun(p, 5000, fd);
  expect(r.truncated);
  expect(r.output.length <= 100000);
});

test("ctrl-c already waiting on stdin abandons the wait before DONE ever arrives", () => {
  let p = freshMailbox("ctrlc");
  let fd = openTestPipe();
  writeByteToTestPipe(3);
  let r = waitForForegroundRun(p, 5000, fd);
  expect(r.abandoned);
  expect(!r.ok);
  expect(r.reason == "ctrl-c");
  expect(r.elapsedMs < 2000);
});

test("exceeding the timeout budget abandons the wait on its own", () => {
  let p = freshMailbox("timeout");
  let fd = openTestPipe();
  let r = waitForForegroundRun(p, 120, fd);
  expect(r.abandoned);
  expect(!r.ok);
  expect(r.reason == "timeout");
});

test("an abandoned wait still reflects whatever the mailbox already had before giving up", () => {
  let p = freshMailbox("partial");
  let fd = openTestPipe();
  appendMailbox(p, "LINE", "some output first");
  writeByteToTestPipe(3);
  let r = waitForForegroundRun(p, 5000, fd);
  expect(r.abandoned);
  expect(r.output.indexOf("some output first") >= 0);
});

test("formatForegroundResult: a normal completion reads as exit N plus output", () => {
  let r: ForegroundResult = { ok: true, status: 0, output: "hi\n", truncated: false, abandoned: false, reason: "", mailboxPath: "", elapsedMs: 5 };
  let body = formatForegroundResult(r, 30000);
  expect(body.indexOf("exit 0") >= 0);
  expect(body.indexOf("hi") >= 0);
});

test("formatForegroundResult: ctrl-c abandonment says so plainly and cites lumen#6", () => {
  let r: ForegroundResult = { ok: false, status: -1, output: "partial\n", truncated: false, abandoned: true, reason: "ctrl-c", mailboxPath: "/tmp/x.log", elapsedMs: 4200 };
  let body = formatForegroundResult(r, 30000);
  expect(body.indexOf("abandoned") >= 0);
  expect(body.indexOf("ctrl-c") >= 0);
  expect(body.indexOf("lumen-lang-org/lumen#6") >= 0);
  expect(body.indexOf("partial") >= 0);
});

test("formatForegroundResult: a timeout abandonment names the budget, not a kill", () => {
  let r: ForegroundResult = { ok: false, status: -1, output: "", truncated: false, abandoned: true, reason: "timeout", mailboxPath: "/tmp/y.log", elapsedMs: 30010 };
  let body = formatForegroundResult(r, 30000);
  expect(body.indexOf("abandoned") >= 0);
  expect(body.indexOf("30000") >= 0);
  expect(body.indexOf("killed") < 0);
});
