import { sessionIdFromPath, browserUserIdFrom } from "./ws.ts";

test("sessionIdFromPath pulls the id out from between the prefix and suffix", () => {
  expect(sessionIdFromPath("/sessions/abc123/ws", "/sessions/", "/ws") == "abc123");
  expect(sessionIdFromPath("/w/abc123/ws", "/w/", "/ws") == "abc123");
});

test("sessionIdFromPath is empty when there is nothing between prefix and suffix", () => {
  let emptyIdPath = "/w/" + "/ws";
  expect(sessionIdFromPath(emptyIdPath, "/w/", "/ws") == "");
});

test("sessionIdFromPath is empty when the path does not actually have the expected prefix or suffix", () => {
  expect(sessionIdFromPath("/nope/abc123/ws", "/sessions/", "/ws") == "");
  expect(sessionIdFromPath("/sessions/abc123/other", "/sessions/", "/ws") == "");
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
