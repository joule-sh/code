import { SessionStore, CODE_TTL_MS, PAIR_RATE_LIMIT_MAX, PAIR_OK, PAIR_WRONG_CODE, PAIR_EXPIRED, PAIR_USED, PAIR_RATE_LIMITED } from "./store.ts";

const BASE_TIME: i64 = 1700000000000;

test("pairing happy path: the right code binds the session to the uuid", () => {
  let store = new SessionStore();
  let sess = store.create("s1", "secret-1", "/repo", "gpt", "ABCDEF", BASE_TIME, "", "", "");
  let outcome = store.pairByCode(sess.code, "user-1", BASE_TIME + 1000);
  expect(outcome.status == PAIR_OK);
  expect(outcome.sessionId == sess.sessionId);
  expect(store.authorizeBrowser(sess.sessionId, "user-1"));
});

test("wrong code is refused and leaves the session unpaired", () => {
  let store = new SessionStore();
  let sess = store.create("s2", "secret-2", "/repo", "gpt", "ABCDEF", BASE_TIME, "", "", "");
  let outcome = store.pairByCode("ZZZZZZ", "user-1", BASE_TIME + 1000);
  expect(outcome.status == PAIR_WRONG_CODE);
  expect(!store.authorizeBrowser(sess.sessionId, "user-1"));
});

test("an expired code is refused even when it is otherwise correct", () => {
  let store = new SessionStore();
  let sess = store.create("s3", "secret-3", "/repo", "gpt", "ABCDEF", BASE_TIME, "", "", "");
  let tooLate = BASE_TIME + CODE_TTL_MS + 1000;
  let outcome = store.pairByCode(sess.code, "user-1", tooLate);
  expect(outcome.status == PAIR_EXPIRED);
});

test("a reused code is refused on the second attempt", () => {
  let store = new SessionStore();
  let sess = store.create("s4", "secret-4", "/repo", "gpt", "ABCDEF", BASE_TIME, "", "", "");
  let first = store.pairByCode(sess.code, "user-1", BASE_TIME + 1000);
  expect(first.status == PAIR_OK);
  let second = store.pairByCode(sess.code, "user-2", BASE_TIME + 2000);
  expect(second.status == PAIR_USED);
  expect(!store.authorizeBrowser(sess.sessionId, "user-2"));
});

test("frames are refused to a browser uuid other than the one paired", () => {
  let store = new SessionStore();
  let sess = store.create("s5", "secret-5", "/repo", "gpt", "ABCDEF", BASE_TIME, "", "", "");
  store.pairByCode(sess.code, "user-1", BASE_TIME + 1000);
  expect(store.authorizeBrowser(sess.sessionId, "user-1"));
  expect(!store.authorizeBrowser(sess.sessionId, "user-2"));
});

test("the pairing rate limit trips after repeated attempts for one uuid", () => {
  let store = new SessionStore();
  let sess = store.create("s8", "secret-8", "/repo", "gpt", "ABCDEF", BASE_TIME, "", "", "");
  let attempt = 0;
  while (attempt < PAIR_RATE_LIMIT_MAX) {
    let bad = store.pairByCode("ZZZZZZ", "flooder", BASE_TIME + attempt);
    expect(bad.status == PAIR_WRONG_CODE);
    attempt = attempt + 1;
  }
  let limited = store.pairByCode(sess.code, "flooder", BASE_TIME + 999);
  expect(limited.status == PAIR_RATE_LIMITED);
});

test("detachTerminal removes the session and reports whether it existed", () => {
  let store = new SessionStore();
  let sess = store.create("s10", "secret-10", "/repo", "gpt", "ABCDEF", BASE_TIME, "", "", "");
  expect(store.authorizeTerminal(sess.sessionId, "secret-10"));

  let removed = store.detachTerminal(sess.sessionId);
  expect(removed);
  expect(!store.authorizeTerminal(sess.sessionId, "secret-10"));

  let removedAgain = store.detachTerminal(sess.sessionId);
  expect(!removedAgain);
});

test("sweepIdle removes only sessions past the idle TTL", () => {
  let store = new SessionStore();
  let sess = store.create("s9", "secret-9", "/repo", "gpt", "ABCDEF", BASE_TIME, "", "", "");
  let removedSoon = store.sweepIdle(BASE_TIME + 1000);
  expect(removedSoon == 0);
  expect(store.authorizeTerminal(sess.sessionId, "secret-9"));
});

test("listForAccount finds only sessions created with that accountId", () => {
  let store = new SessionStore();
  store.create("s20", "secret-20", "/repo-a", "gpt", "AAAAAA", BASE_TIME, "acct-1", "a@example.com", "");
  store.create("s21", "secret-21", "/repo-b", "gpt", "BBBBBB", BASE_TIME, "acct-1", "a@example.com", "");
  store.create("s22", "secret-22", "/repo-c", "gpt", "CCCCCC", BASE_TIME, "acct-2", "b@example.com", "");

  let mine = store.listForAccount("acct-1");
  expect(mine.length == 2);
  let workspaces = [mine[0].workspace, mine[1].workspace];
  expect(workspaces.indexOf("/repo-a") >= 0);
  expect(workspaces.indexOf("/repo-b") >= 0);
  expect(workspaces.indexOf("/repo-c") < 0);
});

test("listForAccount never includes the code or the secret", () => {
  let store = new SessionStore();
  let sess = store.create("s23", "topsecret", "/repo", "gpt", "DDDDDD", BASE_TIME, "acct-1", "a@example.com", "");
  let mine = store.listForAccount("acct-1");
  expect(mine.length == 1);
  expect(JSON.stringify(mine).indexOf("topsecret") < 0);
  expect(JSON.stringify(mine).indexOf(sess.code) < 0);
});

test("listForAccount reflects paired status, and an unowned session never appears for anyone", () => {
  let store = new SessionStore();
  let owned = store.create("s24", "secret-24", "/repo", "gpt", "EEEEEE", BASE_TIME, "acct-1", "a@example.com", "");
  store.create("s25", "secret-25", "/repo-unowned", "gpt", "FFFFFF", BASE_TIME, "", "", "");

  let beforePairing = store.listForAccount("acct-1");
  expect(beforePairing.length == 1);
  expect(!beforePairing[0].paired);

  store.pairByCode(owned.code, "browser-user", BASE_TIME + 10);
  let afterPairing = store.listForAccount("acct-1");
  expect(afterPairing[0].paired);

  expect(store.listForAccount("").length == 0);
});

test("a browser under the owner user the console vouched for is admitted with no code", () => {
  let store = new SessionStore();
  let sess = store.create("s30", "secret-30", "/repo", "gpt", "GGGGGG", BASE_TIME, "acct-1", "a@example.com", "owner-token-1");
  expect(store.ownerAdmits(sess.sessionId, "owner-token-1"));
  expect(store.authorizeBrowser(sess.sessionId, "owner-token-1"));
});

test("admitting the owner spends nothing: the code is still there for a third party", () => {
  let store = new SessionStore();
  let sess = store.create("s31", "secret-31", "/repo", "gpt", "HHHHHH", BASE_TIME, "acct-1", "a@example.com", "owner-token-1");
  expect(store.authorizeBrowser(sess.sessionId, "owner-token-1"));
  let listed = store.listForAccount("acct-1");
  expect(!listed[0].paired);
  let outcome = store.pairByCode(sess.code, "guest-user", BASE_TIME + 1000);
  expect(outcome.status == PAIR_OK);
  expect(store.authorizeBrowser(sess.sessionId, "guest-user"));
  expect(store.authorizeBrowser(sess.sessionId, "owner-token-1"));
});

test("a browser for any other account is refused exactly as before", () => {
  let store = new SessionStore();
  let sess = store.create("s32", "secret-32", "/repo", "gpt", "IIIIII", BASE_TIME, "acct-1", "a@example.com", "owner-token-1");
  expect(!store.authorizeBrowser(sess.sessionId, "owner-token-2"));
  expect(!store.authorizeBrowser(sess.sessionId, "acct-1"));
});

test("a session no console vouched for admits nobody without a code, whatever they present", () => {
  let store = new SessionStore();
  let sess = store.create("s33", "secret-33", "/repo", "gpt", "JJJJJJ", BASE_TIME, "", "", "");
  expect(!store.ownerAdmits(sess.sessionId, ""));
  expect(!store.ownerAdmits(sess.sessionId, "owner-token-1"));
  expect(!store.authorizeBrowser(sess.sessionId, "anyone"));
  let outcome = store.pairByCode(sess.code, "some-uuid", BASE_TIME + 1000);
  expect(outcome.status == PAIR_OK);
  expect(store.authorizeBrowser(sess.sessionId, "some-uuid"));
});

test("an owner user without an accountId beside it admits nobody", () => {
  let store = new SessionStore();
  let sess = store.create("s34", "secret-34", "/repo", "gpt", "KKKKKK", BASE_TIME, "", "", "owner-token-1");
  expect(!store.ownerAdmits(sess.sessionId, "owner-token-1"));
});

test("an empty presented user never matches an empty owner user", () => {
  let store = new SessionStore();
  let sess = store.create("s35", "secret-35", "/repo", "gpt", "LLLLLL", BASE_TIME, "acct-1", "a@example.com", "");
  expect(!store.ownerAdmits(sess.sessionId, ""));
  expect(!store.authorizeBrowser(sess.sessionId, ""));
});
