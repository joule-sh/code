import { SessionStore } from "./store.ts";
import { makeHttpHandler, RelayHttpRequest } from "./http.ts";

const WS_BROWSER_PORT: int = 8092;

type CreatedSession = { sessionId: string, secret: string, code: string, expiresAt: i64 };

function getRequest(path: string): RelayHttpRequest {
  let req: RelayHttpRequest = { method: "GET", path: path, body: "", headers: new Map<string, string>() };
  return req;
}

test("GET / serves a self-contained html page", () => {
  let store = new SessionStore();
  let handler = makeHttpHandler(store, WS_BROWSER_PORT);
  let resp = handler(getRequest("/"));
  expect(resp.status == 200);
  expect(resp.headers.get("content-type") == "text/html; charset=utf-8");
  expect(resp.body.indexOf("<!doctype html>") >= 0);
  expect(resp.body.indexOf("pair-screen") >= 0);
});

test("GET / bakes the configured browser websocket port into the page", () => {
  let store = new SessionStore();
  let handler = makeHttpHandler(store, 9999);
  let resp = handler(getRequest("/"));
  expect(resp.body.indexOf("wsPort: 9999") >= 0);
});

test("an unknown path is still a 404, the web route did not swallow routing", () => {
  let store = new SessionStore();
  let handler = makeHttpHandler(store, WS_BROWSER_PORT);
  let resp = handler(getRequest("/nope"));
  expect(resp.status == 404);
});

test("POST /sessions and POST /pair still work alongside the new GET / route", () => {
  let store = new SessionStore();
  let handler = makeHttpHandler(store, WS_BROWSER_PORT);
  let createReq: RelayHttpRequest = { method: "POST", path: "/sessions", body: "{\"workspace\":\"/repo\",\"model\":\"gpt\"}", headers: new Map<string, string>() };
  let createResp = handler(createReq);
  expect(createResp.status == 200);
  let created = JSON.parse<CreatedSession>(createResp.body);

  let headers = new Map<string, string>();
  headers.set("x-user", "u1");
  let pairReq: RelayHttpRequest = { method: "POST", path: "/pair", body: "{\"code\":\"" + created.code + "\"}", headers: headers };
  let pairResp = handler(pairReq);
  expect(pairResp.status == 200);
});
