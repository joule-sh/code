import { SessionStore, RING_CAPACITY, CODE_TTL_MS, PAIR_RATE_LIMIT_MAX, PAIR_OK, PAIR_WRONG_CODE, PAIR_EXPIRED, PAIR_USED, PAIR_RATE_LIMITED } from "./store.ts";
import { PROTOCOL_VERSION, INPUT, InputFrame, encodeInput } from "../protocol/frames.ts";

const BASE_TIME: i64 = 1700000000000;

function inputFrame(seq: int): string {
  let f: InputFrame = { v: PROTOCOL_VERSION, seq: seq, type: INPUT, text: "hello" };
  return encodeInput(f);
}

test("pairing happy path: the right code binds the session to the uuid", () => {
  let store = new SessionStore();
  let sess = store.create("s1", "secret-1", "/repo", "gpt", "ABCDEF", BASE_TIME);
  let outcome = store.pairByCode(sess.code, "user-1", BASE_TIME + 1000);
  expect(outcome.status == PAIR_OK);
  expect(outcome.sessionId == sess.sessionId);
  expect(store.authorizeBrowser(sess.sessionId, "user-1"));
});

test("wrong code is refused and leaves the session unpaired", () => {
  let store = new SessionStore();
  let sess = store.create("s2", "secret-2", "/repo", "gpt", "ABCDEF", BASE_TIME);
  let outcome = store.pairByCode("ZZZZZZ", "user-1", BASE_TIME + 1000);
  expect(outcome.status == PAIR_WRONG_CODE);
  expect(!store.authorizeBrowser(sess.sessionId, "user-1"));
});

test("an expired code is refused even when it is otherwise correct", () => {
  let store = new SessionStore();
  let sess = store.create("s3", "secret-3", "/repo", "gpt", "ABCDEF", BASE_TIME);
  let tooLate = BASE_TIME + CODE_TTL_MS + 1000;
  let outcome = store.pairByCode(sess.code, "user-1", tooLate);
  expect(outcome.status == PAIR_EXPIRED);
});

test("a reused code is refused on the second attempt", () => {
  let store = new SessionStore();
  let sess = store.create("s4", "secret-4", "/repo", "gpt", "ABCDEF", BASE_TIME);
  let first = store.pairByCode(sess.code, "user-1", BASE_TIME + 1000);
  expect(first.status == PAIR_OK);
  let second = store.pairByCode(sess.code, "user-2", BASE_TIME + 2000);
  expect(second.status == PAIR_USED);
  expect(!store.authorizeBrowser(sess.sessionId, "user-2"));
});

test("frames are refused to a browser uuid other than the one paired", () => {
  let store = new SessionStore();
  let sess = store.create("s5", "secret-5", "/repo", "gpt", "ABCDEF", BASE_TIME);
  store.pairByCode(sess.code, "user-1", BASE_TIME + 1000);
  expect(store.authorizeBrowser(sess.sessionId, "user-1"));
  expect(!store.authorizeBrowser(sess.sessionId, "user-2"));
});

test("replay from a seq returns only the frames after it", () => {
  let store = new SessionStore();
  let sess = store.create("s6", "secret-6", "/repo", "gpt", "ABCDEF", BASE_TIME);
  let n = 1;
  while (n <= 5) {
    store.appendFrame(sess.sessionId, inputFrame(n), BASE_TIME + n);
    n = n + 1;
  }
  let outcome = store.replay(sess.sessionId, 2);
  expect(outcome.ok);
  expect(outcome.frames.length == 3);
});

test("ring eviction is reported as a gap rather than silently replayed", () => {
  let store = new SessionStore();
  let sess = store.create("s7", "secret-7", "/repo", "gpt", "ABCDEF", BASE_TIME);
  let total = RING_CAPACITY + 1;
  let n = 1;
  while (n <= total) {
    store.appendFrame(sess.sessionId, inputFrame(n), BASE_TIME + n);
    n = n + 1;
  }
  let gapOutcome = store.replay(sess.sessionId, 0);
  expect(!gapOutcome.ok);

  let withinRing = total - 100;
  let okOutcome = store.replay(sess.sessionId, withinRing);
  expect(okOutcome.ok);
  expect(okOutcome.frames.length == 100);
});

test("the pairing rate limit trips after repeated attempts for one uuid", () => {
  let store = new SessionStore();
  let sess = store.create("s8", "secret-8", "/repo", "gpt", "ABCDEF", BASE_TIME);
  let attempt = 0;
  while (attempt < PAIR_RATE_LIMIT_MAX) {
    let bad = store.pairByCode("ZZZZZZ", "flooder", BASE_TIME + attempt);
    expect(bad.status == PAIR_WRONG_CODE);
    attempt = attempt + 1;
  }
  let limited = store.pairByCode(sess.code, "flooder", BASE_TIME + 999);
  expect(limited.status == PAIR_RATE_LIMITED);
});

test("sweepIdle removes only sessions past the idle TTL", () => {
  let store = new SessionStore();
  let sess = store.create("s9", "secret-9", "/repo", "gpt", "ABCDEF", BASE_TIME);
  let removedSoon = store.sweepIdle(BASE_TIME + 1000);
  expect(removedSoon == 0);
  expect(store.authorizeTerminal(sess.sessionId, "secret-9"));
});
