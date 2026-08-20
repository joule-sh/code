import { splitPathAndQuery, queryParam } from "./query.ts";

test("a path with no query string splits into itself and an empty query", () => {
  let out = splitPathAndQuery("/w/abc123/ws");
  expect(out.pathname == "/w/abc123/ws");
  expect(out.query == "");
});

test("a path with a query string splits at the first question mark", () => {
  let out = splitPathAndQuery("/w/abc123/ws?x-user=u1&other=2");
  expect(out.pathname == "/w/abc123/ws");
  expect(out.query == "x-user=u1&other=2");
});

test("a bare question mark still splits, leaving an empty query", () => {
  let out = splitPathAndQuery("/w/abc123/ws?");
  expect(out.pathname == "/w/abc123/ws");
  expect(out.query == "");
});

test("queryParam finds a value among several pairs", () => {
  expect(queryParam("a=1&x-user=u1&b=2", "x-user") == "u1");
});

test("queryParam returns empty when the name is absent", () => {
  expect(queryParam("a=1&b=2", "x-user") == "");
});

test("queryParam returns empty on an empty query string", () => {
  expect(queryParam("", "x-user") == "");
});

test("queryParam url-decodes the value it returns", () => {
  expect(queryParam("x-user=a%20b%2Fc", "x-user") == "a b/c");
});

test("queryParam treats a valueless key as empty rather than missing", () => {
  expect(queryParam("x-user&b=2", "x-user") == "");
});
