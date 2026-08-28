// The two Joule Platform products that make sense as tools for the model to
// call itself: `search` (ranked web results) and `retrieve` (full passages,
// sized for a prompt). `suggest` is a search-box product, not something a
// model calls, and `inference` is how a turn already runs, not a tool - see
// docs/extending/platform.md in joule-sh/console for the wire contract this
// mirrors.
import { jsonMemberStart, jsonStringMemberAt, jsonIntMemberAt } from "https://lumen-lang.org/package/std-contrib/ai/core/jsonscan.ts";
import { ToolSchema } from "../providers/openai.ts";
import { ToolResult } from "../session/types.ts";
import { Credential } from "../auth/credentials.ts";
import { normalizeServer } from "../auth/server.ts";

export const SCOPE_SEARCH: string = "search";
export const SCOPE_RETRIEVE: string = "retrieve";

const SEARCH_PATH: string = "/api/v1/search";
const RETRIEVE_PATH: string = "/api/v1/retrieve";

export const WEB_SEARCH_SCHEMA: ToolSchema = {
  name: "web_search",
  description: "Search the open web through the signed-in Joule Platform account. Returns ranked results (title, url, snippet). Use web_retrieve on a promising url when you need the actual page content rather than a snippet.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"q\":{\"type\":\"string\",\"description\":\"the query\"},\"k\":{\"type\":\"integer\",\"description\":\"how many results, 1-50, default 5\"},\"site\":{\"type\":\"string\",\"description\":\"limit results to one domain\"},\"lang\":{\"type\":\"string\",\"description\":\"filter by page language\"},\"country\":{\"type\":\"string\",\"description\":\"filter by page origin country\"}},\"required\":[\"q\"]}",
};

export const WEB_RETRIEVE_SCHEMA: ToolSchema = {
  name: "web_retrieve",
  description: "Fetch full-text passages from the open web through the signed-in Joule Platform account, sized to paste straight into a prompt - the RAG product. Prefer this over web_search when the actual page content is needed, not just a snippet.",
  parametersJson: "{\"type\":\"object\",\"properties\":{\"q\":{\"type\":\"string\",\"description\":\"the query\"},\"k\":{\"type\":\"integer\",\"description\":\"how many passages, 1-20, default 5\"},\"max_chars\":{\"type\":\"integer\",\"description\":\"total text budget across every passage, 500-200000, default 8000\"},\"site\":{\"type\":\"string\",\"description\":\"limit results to one domain\"}},\"required\":[\"q\"]}",
};

// Whether a Platform key's comma-separated scope list (or the "*" that means
// every product, present and future) covers one product's scope name.
export function hasScope(scopes: string, name: string): bool {
  if (scopes.trim() == "*") { return true; }
  let parts = scopes.split(",");
  let i = 0;
  while (i < parts.length) {
    if (parts[i].trim() == name) { return true; }
    i = i + 1;
  }
  return false;
}

// The tool schemas a signed-in credential's scopes actually cover - [] for a
// key minted with neither search nor retrieve, so the model is offered only
// what it can use. Called only once a credential's secret is known non-empty;
// an empty scope list (a credential that was never signed in) covers nothing.
export function platformToolSchemas(scopes: string): ToolSchema[] {
  let out: ToolSchema[] = [];
  if (hasScope(scopes, SCOPE_SEARCH)) { out.push(WEB_SEARCH_SCHEMA); }
  if (hasScope(scopes, SCOPE_RETRIEVE)) { out.push(WEB_RETRIEVE_SCHEMA); }
  return out;
}

function clampInt(raw: int, def: int, min: int, max: int): int {
  let v = raw;
  if (v == 0) { v = def; }
  if (v < min) { v = min; }
  if (v > max) { v = max; }
  return v;
}

function appendParam(query: string, key: string, value: string): string {
  if (value == "") { return query; }
  return query + "&" + key + "=" + encodeURIComponent(value);
}

export function searchQuery(args: string): string {
  let q = jsonStringMemberAt(args, 0, "q");
  let k = clampInt(jsonIntMemberAt(args, 0, "k"), 5, 1, 50);
  let query = "q=" + encodeURIComponent(q) + "&k=" + `${k}`;
  query = appendParam(query, "site", jsonStringMemberAt(args, 0, "site"));
  query = appendParam(query, "lang", jsonStringMemberAt(args, 0, "lang"));
  query = appendParam(query, "country", jsonStringMemberAt(args, 0, "country"));
  return query;
}

export function retrieveQuery(args: string): string {
  let q = jsonStringMemberAt(args, 0, "q");
  let k = clampInt(jsonIntMemberAt(args, 0, "k"), 5, 1, 20);
  let maxChars = clampInt(jsonIntMemberAt(args, 0, "max_chars"), 8000, 500, 200000);
  let query = "q=" + encodeURIComponent(q) + "&k=" + `${k}` + "&max_chars=" + `${maxChars}`;
  query = appendParam(query, "site", jsonStringMemberAt(args, 0, "site"));
  return query;
}

// A local copy of jsonscan's private string/element walkers (model_picker.ts
// keeps its own for the same reason): finding every element of a named JSON
// array without parsing the whole document.
function stringEnd(s: string, i: int): int {
  let j = i + 1;
  while (j < s.length) {
    let c = s.charAt(j);
    if (c == "\\") { j = j + 2; continue; }
    if (c == "\"") { return j + 1; }
    j = j + 1;
  }
  return -1;
}

function elementEnd(s: string, i: int): int {
  let depth = 0;
  let k = i;
  while (k < s.length) {
    let d = s.charAt(k);
    if (d == "\"") {
      let e = stringEnd(s, k);
      if (e < 0) { return -1; }
      k = e;
      continue;
    }
    if (d == "{" || d == "[") { depth = depth + 1; }
    if (d == "}" || d == "]") {
      depth = depth - 1;
      if (depth == 0) { return k + 1; }
    }
    k = k + 1;
  }
  return -1;
}

function isSpace(c: string): bool {
  return c == " " || c == "\t" || c == "\n" || c == "\r";
}

// The start index of every `{...}` element of the array at `key`, in order -
// [] when the document carries no such array. Reading a field out of each
// element is then a plain jsonStringMemberAt at that index.
export function arrayElementStarts(body: string, key: string): int[] {
  let out: int[] = [];
  let at = jsonMemberStart(body, 0, key);
  if (at < 0) { return out; }
  let i = at;
  while (i < body.length && isSpace(body.charAt(i))) { i = i + 1; }
  if (i >= body.length || body.charAt(i) != "[") { return out; }
  i = i + 1;
  while (i < body.length) {
    while (i < body.length && (isSpace(body.charAt(i)) || body.charAt(i) == ",")) { i = i + 1; }
    if (i >= body.length || body.charAt(i) == "]") { break; }
    if (body.charAt(i) != "{") { break; }
    out.push(i);
    let e = elementEnd(body, i);
    if (e <= i) { break; }
    i = e;
  }
  return out;
}

const NO_RESULTS: string = "no results";
const NO_PASSAGES: string = "no passages for this query";

export function renderSearchResults(body: string): string {
  let starts = arrayElementStarts(body, "results");
  if (starts.length == 0) { return NO_RESULTS; }
  let out = "";
  let i = 0;
  while (i < starts.length) {
    let at = starts[i];
    let title = jsonStringMemberAt(body, at, "title");
    let url = jsonStringMemberAt(body, at, "url");
    let snippet = jsonStringMemberAt(body, at, "snippet");
    if (i > 0) { out = out + "\n\n"; }
    out = out + `${i + 1}` + ". " + title + "\n" + url;
    if (snippet != "") { out = out + "\n" + snippet; }
    i = i + 1;
  }
  return out;
}

export function renderRetrievePassages(body: string): string {
  let starts = arrayElementStarts(body, "passages");
  if (starts.length == 0) { return NO_PASSAGES; }
  let out = "";
  let i = 0;
  while (i < starts.length) {
    let at = starts[i];
    let title = jsonStringMemberAt(body, at, "title");
    let url = jsonStringMemberAt(body, at, "url");
    let passageText = jsonStringMemberAt(body, at, "text");
    if (i > 0) { out = out + "\n\n---\n\n"; }
    out = out + `${i + 1}` + ". " + title + "\n" + url;
    if (passageText != "") { out = out + "\n\n" + passageText; }
    i = i + 1;
  }
  return out;
}

function authHeadersFor(secret: string): Map<string, string> {
  let h = new Map<string, string>();
  h.set("Authorization", "Bearer " + secret);
  return h;
}

// The sentence a failed call reports, in order of how much the response tells
// us: the platform's own error text, then a status-specific reading of the
// common failure codes (unreachable connection, revoked key, rate limit,
// upstream outage), then a bare fallback for anything else.
export function platformErrorText(status: int, body: string): string {
  if (status < 0) { return "could not reach the platform - check the network and try again"; }
  let fromBody = jsonStringMemberAt(body, 0, "error");
  if (fromBody != "") { return fromBody; }
  if (status == 401) { return "no key, an unknown key, or a revoked one - sign in again with /login"; }
  if (status == 429) { return "rate limited by the platform - wait and try again"; }
  if (status == 503) { return "the platform is temporarily unavailable"; }
  return "the platform answered with status " + `${status}`;
}

function ok(output: string): ToolResult {
  return { ok: true, output: output, truncated: false };
}

function fail(output: string): ToolResult {
  return { ok: false, output: output, truncated: false };
}

// `server` and `credential` come from the workspace's own sign-in - the same
// pair `/login` already wrote to disk. A registry with no signed-in credential
// never offers these schemas in the first place (see platformToolSchemas), so
// reaching here with an empty secret means the model called a tool that was
// withdrawn out from under it mid-session (a /logout), not a normal path.
export function dispatchPlatformTool(server: string, credential: Credential, tool: string, args: string): ToolResult {
  if (credential.secret == "") {
    return fail("not signed in to " + server + " - run /login, then try again");
  }
  let base = normalizeServer(server);
  let headers = authHeadersFor(credential.secret);
  if (tool == "web_search") {
    let resp = http.request(base + SEARCH_PATH + "?" + searchQuery(args), "GET", "", headers);
    if (!resp.ok || resp.status != 200) { return fail(platformErrorText(resp.status, resp.body)); }
    return ok(renderSearchResults(resp.body));
  }
  if (tool == "web_retrieve") {
    let resp = http.request(base + RETRIEVE_PATH + "?" + retrieveQuery(args), "GET", "", headers);
    if (!resp.ok || resp.status != 200) { return fail(platformErrorText(resp.status, resp.body)); }
    return ok(renderRetrievePassages(resp.body));
  }
  return fail("unknown platform tool: " + tool);
}
