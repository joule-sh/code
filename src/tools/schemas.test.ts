import { allToolSchemas } from "./schemas.ts";

function toolNamesFor(scopes: string): string[] {
  let out: string[] = [];
  for (const s of allToolSchemas(scopes)) { out.push(s.name); }
  return out;
}

test("allToolSchemas(\"\") is the fixed local-only list, unaffected by sign-in state", () => {
  let list = toolNamesFor("");
  expect(list.indexOf("read") >= 0);
  expect(list.indexOf("run") >= 0);
  expect(list.indexOf("skill") >= 0);
  expect(list.indexOf("web_search") < 0);
  expect(list.indexOf("web_retrieve") < 0);
});

test("a signed-in key's scopes add exactly the platform tools it covers", () => {
  expect(toolNamesFor("search,retrieve,suggest,inference").indexOf("web_search") >= 0);
  expect(toolNamesFor("search,retrieve,suggest,inference").indexOf("web_retrieve") >= 0);
  expect(toolNamesFor("search").indexOf("web_retrieve") < 0);
  expect(toolNamesFor("suggest,inference").indexOf("web_search") < 0);
});

test("the local tools are always present alongside whatever the platform adds", () => {
  let list = toolNamesFor("*");
  expect(list.indexOf("read") >= 0);
  expect(list.indexOf("web_search") >= 0);
  expect(list.indexOf("web_retrieve") >= 0);
});
