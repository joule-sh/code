import { RelayOwner } from "./relay_owner.ts";
import { StoreCaller } from "./relay_rpc.ts";
import { makeHttpHandler, RelayHttpRequest, AccountVerifier } from "./http.ts";

const CONSOLE: string = "https://console.example.com";
import { AccountVerifyResult, VERIFY_OK, VERIFY_REJECTED } from "./account_verify.ts";

const WS_BROWSER_PORT: int = 8092;

type CreatedSession = { sessionId: string, secret: string, code: string, expiresAt: i64, accountStatus: string, verifiedBy: string };
type MineSessionWire = { sessionId: string, workspace: string, model: string, createdAt: i64, lastActivityAt: i64, paired: bool };
type MineResponse = { sessions: MineSessionWire[] };

function freshRuntimeDir(name: string): string {
  let dir = "/tmp/relay-http-test-" + name;
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(dir, true);
  return dir;
}

function directCaller(owner: RelayOwner): StoreCaller {
  return (commandJson: string) => owner.handleCommand(commandJson);
}

function stubVerifier(knownSecret: string, accountId: string, accountEmail: string): AccountVerifier {
  return (secret: string) => {
    if (secret == knownSecret) {
      let ok: AccountVerifyResult = { status: VERIFY_OK, accountId: accountId, accountEmail: accountEmail, relayUser: "owner-token-" + accountId };
      return ok;
    }
    let rejected: AccountVerifyResult = { status: VERIFY_REJECTED, accountId: "", accountEmail: "", relayUser: "" };
    return rejected;
  };
}

function neverCalled(): AccountVerifier {
  return stubVerifier("unreachable-sentinel-no-request-sends-this", "unused-account", "");
}

function getRequest(path: string): RelayHttpRequest {
  let req: RelayHttpRequest = { method: "GET", path: path, body: "", headers: new Map<string, string>() };
  return req;
}

test("GET / serves a self-contained html page", () => {
  let owner = new RelayOwner(freshRuntimeDir("web-page"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, neverCalled(), CONSOLE);
  let resp = handler(getRequest("/"));
  expect(resp.status == 200);
  expect(resp.headers.get("content-type") == "text/html; charset=utf-8");
  expect(resp.body.indexOf("<!doctype html>") >= 0);
  expect(resp.body.indexOf("pair-screen") >= 0);
});

test("GET / bakes the configured browser websocket port into the page", () => {
  let owner = new RelayOwner(freshRuntimeDir("web-page-port"));
  let handler = makeHttpHandler(directCaller(owner), 9999, neverCalled(), CONSOLE);
  let resp = handler(getRequest("/"));
  expect(resp.body.indexOf("wsPort: 9999") >= 0);
});

test("an unknown path is still a 404, the web route did not swallow routing", () => {
  let owner = new RelayOwner(freshRuntimeDir("unknown-path"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, neverCalled(), CONSOLE);
  let resp = handler(getRequest("/nope"));
  expect(resp.status == 404);
});

test("POST /sessions and POST /pair still work alongside the new GET / route", () => {
  let owner = new RelayOwner(freshRuntimeDir("sessions-and-pair"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, neverCalled(), CONSOLE);
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
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, neverCalled(), CONSOLE);
  let headers = new Map<string, string>();
  headers.set("x-user", "u1");
  let pairReq: RelayHttpRequest = { method: "POST", path: "/pair", body: "{\"code\":\"ZZZZZZ\"}", headers: headers };
  let pairResp = handler(pairReq);
  expect(pairResp.status == 400);
});

test("POST /sessions with no credentialSecret never calls the verifier, and the session is unowned", () => {
  let owner = new RelayOwner(freshRuntimeDir("sessions-no-cred"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, neverCalled(), CONSOLE);
  let createReq: RelayHttpRequest = { method: "POST", path: "/sessions", body: "{\"workspace\":\"/repo\",\"model\":\"gpt\"}", headers: new Map<string, string>() };
  let createResp = handler(createReq);
  expect(createResp.status == 200);

  let listHeaders = new Map<string, string>();
  listHeaders.set("x-user", "acct-1");
  let mine = handler({ method: "GET", path: "/sessions/mine", body: "", headers: listHeaders });
  let parsed = JSON.parse<MineResponse>(mine.body);
  expect(parsed.sessions.length == 0);
});

test("POST /sessions with a credentialSecret that verifies associates the session, visible only to that account", () => {
  let owner = new RelayOwner(freshRuntimeDir("sessions-owned"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, stubVerifier("real-secret", "acct-1", "a@example.com"), CONSOLE);
  let createReq: RelayHttpRequest = { method: "POST", path: "/sessions", body: "{\"workspace\":\"/repo\",\"model\":\"gpt\",\"credentialSecret\":\"real-secret\"}", headers: new Map<string, string>() };
  let createResp = handler(createReq);
  expect(createResp.status == 200);

  let mineHeaders = new Map<string, string>();
  mineHeaders.set("x-user", "acct-1");
  let mine = handler({ method: "GET", path: "/sessions/mine", body: "", headers: mineHeaders });
  expect(mine.status == 200);
  let parsed = JSON.parse<MineResponse>(mine.body);
  expect(parsed.sessions.length == 1);
  expect(parsed.sessions[0].workspace == "/repo");

  let otherHeaders = new Map<string, string>();
  otherHeaders.set("x-user", "acct-2");
  let notMine = handler({ method: "GET", path: "/sessions/mine", body: "", headers: otherHeaders });
  let notMineParsed = JSON.parse<MineResponse>(notMine.body);
  expect(notMineParsed.sessions.length == 0);
});

test("a create that verifies says so, and names the console it asked, so a client can tell an owned session from an unowned one", () => {
  let owner = new RelayOwner(freshRuntimeDir("sessions-status-ok"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, stubVerifier("real-secret", "acct-1", "a@example.com"), CONSOLE);
  let createResp = handler({ method: "POST", path: "/sessions", body: "{\"workspace\":\"/repo\",\"model\":\"gpt\",\"credentialSecret\":\"real-secret\"}", headers: new Map<string, string>() });
  expect(createResp.status == 200);
  expect(createResp.body.indexOf("\"accountStatus\":\"ok\"") >= 0);
  expect(createResp.body.indexOf(CONSOLE) >= 0);
});

test("a create whose credential the console does not know says rejected and names that console, rather than looking like a success", () => {
  let owner = new RelayOwner(freshRuntimeDir("sessions-status-rejected"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, stubVerifier("real-secret", "acct-1", "a@example.com"), CONSOLE);
  let createResp = handler({ method: "POST", path: "/sessions", body: "{\"workspace\":\"/repo\",\"model\":\"gpt\",\"credentialSecret\":\"issued-by-a-different-console\"}", headers: new Map<string, string>() });
  expect(createResp.status == 200);
  expect(createResp.body.indexOf("\"accountStatus\":\"rejected\"") >= 0);
  expect(createResp.body.indexOf(CONSOLE) >= 0);
});

test("a create that offered no credential at all claims no account status and names no console", () => {
  let owner = new RelayOwner(freshRuntimeDir("sessions-status-none"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, neverCalled(), CONSOLE);
  let createResp = handler({ method: "POST", path: "/sessions", body: "{\"workspace\":\"/repo\",\"model\":\"gpt\"}", headers: new Map<string, string>() });
  expect(createResp.status == 200);
  expect(createResp.body.indexOf("\"accountStatus\":\"\"") >= 0);
  expect(createResp.body.indexOf(CONSOLE) < 0);
});

test("POST /sessions with a credentialSecret that fails verification still creates the session, just unowned", () => {
  let owner = new RelayOwner(freshRuntimeDir("sessions-rejected-cred"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, stubVerifier("real-secret", "acct-1", "a@example.com"), CONSOLE);
  let createReq: RelayHttpRequest = { method: "POST", path: "/sessions", body: "{\"workspace\":\"/repo\",\"model\":\"gpt\",\"credentialSecret\":\"stale-or-revoked\"}", headers: new Map<string, string>() };
  let createResp = handler(createReq);
  expect(createResp.status == 200);

  let mineHeaders = new Map<string, string>();
  mineHeaders.set("x-user", "acct-1");
  let mine = handler({ method: "GET", path: "/sessions/mine", body: "", headers: mineHeaders });
  let parsed = JSON.parse<MineResponse>(mine.body);
  expect(parsed.sessions.length == 0);
});

test("GET /sessions/mine without x-user is refused with 401", () => {
  let owner = new RelayOwner(freshRuntimeDir("mine-no-user"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, neverCalled(), CONSOLE);
  let resp = handler({ method: "GET", path: "/sessions/mine", body: "", headers: new Map<string, string>() });
  expect(resp.status == 401);
});

test("GET /sessions/mine never leaks a code or a secret onto the wire", () => {
  let owner = new RelayOwner(freshRuntimeDir("mine-no-leak"));
  let handler = makeHttpHandler(directCaller(owner), WS_BROWSER_PORT, stubVerifier("real-secret", "acct-1", "a@example.com"), CONSOLE);
  let createReq: RelayHttpRequest = { method: "POST", path: "/sessions", body: "{\"workspace\":\"/repo\",\"model\":\"gpt\",\"credentialSecret\":\"real-secret\"}", headers: new Map<string, string>() };
  let createResp = handler(createReq);
  let created = JSON.parse<CreatedSession>(createResp.body);

  let mineHeaders = new Map<string, string>();
  mineHeaders.set("x-user", "acct-1");
  let mine = handler({ method: "GET", path: "/sessions/mine", body: "", headers: mineHeaders });
  expect(mine.body.indexOf(created.secret) < 0);
  expect(mine.body.indexOf(created.code) < 0);
});
