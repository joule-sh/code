import { TurnStatusTracker } from "./screen.ts";
import { NO_TURN } from "./layout.ts";
import { TurnTracker } from "../providers/live.ts";
import { PROTOCOL_VERSION, TURN_START, TURN_END, REASON_DONE, TurnStartFrame, TurnEndFrame, encodeTurnStart, encodeTurnEnd } from "../protocol/frames.ts";

function startFrame(turnId: string): string {
  let f: TurnStartFrame = { v: PROTOCOL_VERSION, seq: 1, type: TURN_START, turnId: turnId, prompt: "do something" };
  return encodeTurnStart(f);
}

function endFrame(turnId: string): string {
  let f: TurnEndFrame = { v: PROTOCOL_VERSION, seq: 2, type: TURN_END, turnId: turnId, reason: REASON_DONE };
  return encodeTurnEnd(f);
}

function noRunning(): int {
  return 0;
}

test("before any turn has run, elapsed and tokens report nothing and the tracker is not live", () => {
  let rk = new TurnStatusTracker();
  let tracker = new TurnTracker();
  rk.bind(tracker, noRunning);
  expect(rk.elapsedMs() == NO_TURN);
  expect(rk.turnTokens() == 0);
  expect(rk.statusInfo("auto-edit").turnLive == false);
});

test("while a turn is running, elapsed and tokens are live and the tracker reports itself as live", () => {
  let rk = new TurnStatusTracker();
  let tracker = new TurnTracker();
  rk.bind(tracker, noRunning);
  tracker.setCurrent("t1");
  rk.recordFrame(startFrame("t1"));
  tracker.addTokens(500);
  expect(rk.inTurn == true);
  expect(rk.elapsedMs() >= 0);
  expect(rk.turnTokens() == 500);
  expect(rk.statusInfo("auto-edit").turnLive == true);
});

test("once a turn ends, its elapsed time and token total stay on the tracker instead of clearing", () => {
  let rk = new TurnStatusTracker();
  let tracker = new TurnTracker();
  rk.bind(tracker, noRunning);
  tracker.setCurrent("t1");
  rk.recordFrame(startFrame("t1"));
  tracker.addTokens(500);
  rk.recordFrame(endFrame("t1"));

  expect(rk.inTurn == false);
  expect(rk.elapsedMs() >= 0);
  expect(rk.turnTokens() == 500);
  expect(rk.statusInfo("auto-edit").turnLive == false);
});

test("the settled elapsed reading is frozen, not a clock that keeps advancing after the turn ended", () => {
  let rk = new TurnStatusTracker();
  let tracker = new TurnTracker();
  rk.bind(tracker, noRunning);
  tracker.setCurrent("t1");
  rk.recordFrame(startFrame("t1"));
  rk.recordFrame(endFrame("t1"));

  let first = rk.elapsedMs();
  let second = rk.elapsedMs();
  expect(first == second);
  expect(rk.finishedElapsedMs == first);
});

test("starting the next turn resets the previous turn's settled totals so they do not bleed into it", () => {
  let rk = new TurnStatusTracker();
  let tracker = new TurnTracker();
  rk.bind(tracker, noRunning);

  tracker.setCurrent("t1");
  rk.recordFrame(startFrame("t1"));
  tracker.addTokens(500);
  rk.recordFrame(endFrame("t1"));
  expect(rk.turnTokens() == 500);
  expect(rk.finishedElapsedMs != NO_TURN);

  tracker.setCurrent("t2");
  rk.recordFrame(startFrame("t2"));

  expect(rk.turnTokens() == 0);
  expect(rk.finishedElapsedMs == NO_TURN);
  expect(rk.statusInfo("auto-edit").turnLive == true);

  tracker.addTokens(80);
  expect(rk.turnTokens() == 80);
});
