import { hasScope, platformToolSchemas, searchQuery, retrieveQuery, arrayElementStarts, renderSearchResults, renderRetrievePassages, platformErrorText, dispatchPlatformTool, WEB_SEARCH_SCHEMA, WEB_RETRIEVE_SCHEMA } from "./platform_tools.ts";
import { emptyCredential, Credential } from "../auth/credentials.ts";

test("hasScope reads a comma-separated list, and * covers everything", () => {
  expect(hasScope("search,retrieve,suggest,inference", "search"));
  expect(hasScope("search,retrieve,suggest,inference", "retrieve"));
  expect(!hasScope("search,suggest", "retrieve"));
  expect(hasScope("*", "retrieve"));
  expect(hasScope(" search , retrieve ", "retrieve"));
  expect(!hasScope("", "search"));
});

test("platformToolSchemas offers only what the key's scopes cover", () => {
  expect(platformToolSchemas("search,retrieve").length == 2);
  expect(platformToolSchemas("search").length == 1);
  expect(platformToolSchemas("search")[0].name == "web_search");
  expect(platformToolSchemas("retrieve")[0].name == "web_retrieve");
  expect(platformToolSchemas("suggest,inference").length == 0);
  expect(platformToolSchemas("*").length == 2);
});

test("searchQuery carries q and clamps k into 1..50, defaulting to 5", () => {
  expect(searchQuery("{\"q\":\"battery storage\"}") == "q=battery%20storage&k=5");
  expect(searchQuery("{\"q\":\"x\",\"k\":3}") == "q=x&k=3");
  expect(searchQuery("{\"q\":\"x\",\"k\":999}") == "q=x&k=50");
  expect(searchQuery("{\"q\":\"x\",\"k\":-5}") == "q=x&k=1");
});

test("searchQuery appends only the filters that were actually given", () => {
  let q = searchQuery("{\"q\":\"x\",\"site\":\"example.com\",\"lang\":\"en\"}");
  expect(q.indexOf("site=example.com") >= 0);
  expect(q.indexOf("lang=en") >= 0);
  expect(q.indexOf("country=") < 0);
});

test("retrieveQuery clamps k into 1..20 and max_chars into 500..200000", () => {
  expect(retrieveQuery("{\"q\":\"x\"}") == "q=x&k=5&max_chars=8000");
  expect(retrieveQuery("{\"q\":\"x\",\"k\":99}") == "q=x&k=20&max_chars=8000");
  expect(retrieveQuery("{\"q\":\"x\",\"max_chars\":1}") == "q=x&k=5&max_chars=500");
  expect(retrieveQuery("{\"q\":\"x\",\"max_chars\":9999999}") == "q=x&k=5&max_chars=200000");
});

test("arrayElementStarts finds every element of the named array, and [] when it is absent", () => {
  let body = "{\"results\":[{\"a\":1},{\"a\":2},{\"a\":3}]}";
  expect(arrayElementStarts(body, "results").length == 3);
  expect(arrayElementStarts(body, "passages").length == 0);
  expect(arrayElementStarts("{}", "results").length == 0);
});

test("renderSearchResults numbers each hit with title, url and snippet", () => {
  let body = "{\"results\":[" +
    "{\"url\":\"https://a.example/1\",\"title\":\"First\",\"snippet\":\"about a battery\"}," +
    "{\"url\":\"https://a.example/2\",\"title\":\"Second\",\"snippet\":\"\"}" +
    "]}";
  let out = renderSearchResults(body);
  expect(out.indexOf("1. First") >= 0);
  expect(out.indexOf("https://a.example/1") >= 0);
  expect(out.indexOf("about a battery") >= 0);
  expect(out.indexOf("2. Second") >= 0);
});

test("renderSearchResults says plainly when there is nothing to show", () => {
  expect(renderSearchResults("{\"results\":[]}") == "no results");
  expect(renderSearchResults("{}") == "no results");
});

test("renderRetrievePassages carries the full text per hit, separated from the next", () => {
  let body = "{\"passages\":[" +
    "{\"url\":\"https://a.example/1\",\"title\":\"First\",\"text\":\"a long passage of prose\"}" +
    "]}";
  let out = renderRetrievePassages(body);
  expect(out.indexOf("1. First") >= 0);
  expect(out.indexOf("a long passage of prose") >= 0);
});

test("renderRetrievePassages says plainly when there is nothing to show", () => {
  expect(renderRetrievePassages("{\"passages\":[]}") == "no passages for this query");
});

test("platformErrorText prefers the platform's own error text", () => {
  expect(platformErrorText(500, "{\"error\":\"index is rebuilding\"}") == "index is rebuilding");
});

test("platformErrorText reads the common status codes when the body carries nothing", () => {
  expect(platformErrorText(401, "{}").indexOf("revoked") >= 0);
  expect(platformErrorText(429, "{}").indexOf("rate limited") >= 0);
  expect(platformErrorText(503, "{}").indexOf("unavailable") >= 0);
  expect(platformErrorText(-1, "").indexOf("could not reach") >= 0);
  expect(platformErrorText(500, "{}").indexOf("500") >= 0);
});

function credentialWith(secret: string): Credential {
  let c: Credential = {
    server: "", secret: secret, accountId: "", accountEmail: "",
    keyId: "", keyPrefix: "", scopes: "", savedAt: "",
    relayUrl: "", relayWsUrl: "", webUrl: "",
  };
  return c;
}

test("dispatchPlatformTool refuses an unsigned-in call rather than reaching the network", () => {
  let r = dispatchPlatformTool("https://joule.sh", emptyCredential(), "web_search", "{\"q\":\"x\"}");
  expect(!r.ok);
  expect(r.output.indexOf("/login") >= 0);
});

test("dispatchPlatformTool rejects a tool name that is not one of the two it knows", () => {
  let r = dispatchPlatformTool("https://joule.sh", credentialWith("jl_test"), "web_translate", "{}");
  expect(!r.ok);
  expect(r.output.indexOf("unknown platform tool") >= 0);
});

test("both schemas require q and describe their own clamp ranges", () => {
  expect(WEB_SEARCH_SCHEMA.parametersJson.indexOf("\"required\":[\"q\"]") >= 0);
  expect(WEB_RETRIEVE_SCHEMA.parametersJson.indexOf("\"required\":[\"q\"]") >= 0);
  expect(WEB_SEARCH_SCHEMA.parametersJson.indexOf("1-50") >= 0);
  expect(WEB_RETRIEVE_SCHEMA.parametersJson.indexOf("1-20") >= 0);
});
