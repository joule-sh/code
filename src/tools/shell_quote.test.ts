import { shellQuoteSingle } from "./shell_quote.ts";

test("a plain path with no special characters is wrapped in single quotes", () => {
  let q = shellQuoteSingle("/home/user/repo");
  expect(q == "'/home/user/repo'");
});

test("an embedded single quote is escaped so the shell sees it as literal", () => {
  let q = shellQuoteSingle("it's-a-repo");
  expect(q == "'it'\\''s-a-repo'");
});

test("an empty string quotes to an empty pair of quotes", () => {
  let q = shellQuoteSingle("");
  expect(q == "''");
});

test("a path with a space stays intact inside the quotes", () => {
  let q = shellQuoteSingle("/home/user/my repo");
  expect(q == "'/home/user/my repo'");
});
