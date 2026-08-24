import { TurnWatchdog, ANSWER_GRACE_MS, WATCHDOG_CODE } from "./attach_watchdog.ts";
import { frameType, ERROR, decodeError } from "../protocol/frames.ts";

test("a watchdog that was never given a request never reports", () => {
  let w = new TurnWatchdog(8300);
  expect(!w.overdue(0));
  expect(!w.overdue(ANSWER_GRACE_MS * 10));
  expect(w.takeOverdueNotice(ANSWER_GRACE_MS * 10) == "");
});

test("a request answered before the grace runs out never reports", () => {
  let w = new TurnWatchdog(8300);
  w.noteRequestSent(1000);
  w.noteDaemonAnswered();
  expect(!w.overdue(1000 + ANSWER_GRACE_MS * 3));
});

test("a request that is still unanswered when the grace runs out reports once", () => {
  let w = new TurnWatchdog(8452);
  w.noteRequestSent(1000);
  expect(!w.overdue(1000 + ANSWER_GRACE_MS - 1));
  expect(w.overdue(1000 + ANSWER_GRACE_MS));
  let notice = w.takeOverdueNotice(1000 + ANSWER_GRACE_MS);
  expect(frameType(notice) == ERROR);
  let decoded = decodeError(notice);
  expect(decoded != null);
  expect(w.takeOverdueNotice(1000 + ANSWER_GRACE_MS * 5) == "");
});

test("the notice names the port and the way out", () => {
  let w = new TurnWatchdog(8452);
  w.noteRequestSent(0);
  let decoded = decodeError(w.takeOverdueNotice(ANSWER_GRACE_MS));
  expect(decoded != null);
  if (decoded != null) {
    expect(decoded.code == WATCHDOG_CODE);
    expect(decoded.message.indexOf("8452") >= 0);
    expect(decoded.message.indexOf("joule --stop") >= 0);
  }
});

test("a later request is watched again after an earlier one was reported", () => {
  let w = new TurnWatchdog(8300);
  w.noteRequestSent(0);
  expect(w.takeOverdueNotice(ANSWER_GRACE_MS) != "");
  w.noteRequestSent(ANSWER_GRACE_MS * 2);
  expect(!w.overdue(ANSWER_GRACE_MS * 2));
  expect(w.takeOverdueNotice(ANSWER_GRACE_MS * 3) != "");
});
