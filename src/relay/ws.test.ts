import { roleForPath, sessionIdFromPath, browserUserIdFrom, ROLE_TERMINAL, ROLE_BROWSER, ROLE_UNKNOWN } from "./ws.ts";

test("roleForPath recognises a terminal path", () => {
  expect(roleForPath("/sessions/abc123/ws") == ROLE_TERMINAL);
});

test("roleForPath recognises a browser path", () => {
  expect(roleForPath("/w/abc123/ws") == ROLE_BROWSER);
});

test("roleForPath is unknown for anything else", () => {
  expect(roleForPath("/pair") == ROLE_UNKNOWN);
  expect(roleForPath("/") == ROLE_UNKNOWN);
});

test("roleForPath only sees the pathname, a query string is stripped upstream", () => {
  expect(roleForPath("/w/abc123/ws?x-user=u1") == ROLE_UNKNOWN);
});

test("sessionIdFromPath pulls the id out from between the prefix and suffix", () => {
  expect(sessionIdFromPath("/sessions/abc123/ws", "/sessions/", "/ws") == "abc123");
  expect(sessionIdFromPath("/w/abc123/ws", "/w/", "/ws") == "abc123");
});

test("sessionIdFromPath is empty when there is nothing between prefix and suffix", () => {
  let emptyIdPath = "/w/" + "/ws";
  expect(sessionIdFromPath(emptyIdPath, "/w/", "/ws") == "");
});

test("browserUserIdFrom prefers a real header when one is present", () => {
  expect(browserUserIdFrom("u1", "x-user=u2") == "u1");
});

test("browserUserIdFrom falls back to the query string when the header is empty", () => {
  expect(browserUserIdFrom("", "x-user=u2") == "u2");
});

test("browserUserIdFrom is empty when neither the header nor the query has it", () => {
  expect(browserUserIdFrom("", "") == "");
  expect(browserUserIdFrom("", "other=1") == "");
});

test("browserUserIdFrom url-decodes a query fallback the same way any query value is", () => {
  expect(browserUserIdFrom("", "x-user=a%2Fb") == "a/b");
});
