import { RelayOwner } from "./relay_owner.ts";
import { StoreCaller } from "./relay_rpc.ts";
import { makeHttpHandler, RelayHttpRequest } from "./http.ts";

const WS_BROWSER_PORT: int = 8092;

type CreatedSession = { sessionId: string, secret: string, code: string, expiresAt: i64 };

function freshRuntimeDir(name: string): string {
  let dir = "/tmp/relay-http-test-" + name;
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(dir, true);
  return dir;
}

function directCaller(owner: RelayOwner): StoreCaller {
  return (commandJson: string) => owner.handleCommand(commandJson);
}

function getRequest(path: string): RelayHttpRequest {
  let req: RelayHttpRequest = { method: "GET", path: path, body: "", headers: new Map<string, string>() };
  return req;
}

test("GET / serves a self-contained html page", () => {
  let owner = new RelayOwner(freshRuntimeDir("web-page"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT);
  let resp = handler(getRequest("/"));
  expect(resp.status == 200);
  expect(resp.headers.get("content-type") == "text/html; charset=utf-8");
  expect(resp.body.indexOf("<!doctype html>") >= 0);
  expect(resp.body.indexOf("pair-screen") >= 0);
});

test("GET / bakes the configured browser websocket port into the page", () => {
  let owner = new RelayOwner(freshRuntimeDir("web-page-port"));
  let handler = makeHttpHandler(directCaller(owner), 9999);
  let resp = handler(getRequest("/"));
  expect(resp.body.indexOf("wsPort: 9999") >= 0);
});

test("an unknown path is still a 404, the web route did not swallow routing", () => {
  let owner = new RelayOwner(freshRuntimeDir("unknown-path"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT);
  let resp = handler(getRequest("/nope"));
  expect(resp.status == 404);
});

test("POST /sessions and POST /pair still work alongside the new GET / route", () => {
  let owner = new RelayOwner(freshRuntimeDir("sessions-and-pair"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT);
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

test("POST /pair with a wrong code is refused with 400", () => {
  let owner = new RelayOwner(freshRuntimeDir("pair-wrong-code"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT);
  let headers = new Map<string, string>();
  headers.set("x-user", "u1");
  let pairReq: RelayHttpRequest = { method: "POST", path: "/pair", body: "{\"code\":\"ZZZZZZ\"}", headers: headers };
  let pairResp = handler(pairReq);
  expect(pairResp.status == 400);
});
