import { connect } from "./miniws.mjs";
import crypto from "node:crypto";

const HOST = "127.0.0.1";
const HTTP_PORT = Number(process.env.JOULE_RELAY_HTTP_PORT || 8090);
const WS_BROWSER_PORT = Number(process.env.JOULE_RELAY_WS_BROWSER_PORT || 8092);
const WS_TERMINAL_PORT = Number(process.env.JOULE_RELAY_WS_PORT || 8091);

let failures = 0;
function ok(cond, label) {
  if (cond) { console.log("ok: " + label); }
  else { failures += 1; console.error("FAIL: " + label); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchJson(path, opts) {
  const resp = await fetch(`http://${HOST}:${HTTP_PORT}${path}`, opts);
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
  return { status: resp.status, ok: resp.ok, body: text, json: parsed };
}

async function checkWebPageServed() {
  const resp = await fetch(`http://${HOST}:${HTTP_PORT}/`);
  const text = await resp.text();
  ok(resp.status === 200, "GET / returns 200");
  ok(text.startsWith("<!doctype html>"), "GET / returns a well-formed doctype");
  ok(text.indexOf("pair-screen") >= 0, "GET / includes the pair screen markup");
  ok(text.indexOf("__JOULE_CONFIG__") >= 0, "GET / bakes in the runtime config");
  const external = [...text.matchAll(/(src|href)=["']https?:\/\//gi)];
  ok(external.length === 0, "no external src/href references (no CDN, no external fetch)");
}

async function scriptedTerminalAndBrowser() {
  const created = await fetchJson("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace: "/tmp/demo-workspace", model: "test-model" }),
  });
  ok(created.status === 200 && created.json && created.json.sessionId, "POST /sessions creates a session");

  const sessionId = created.json.sessionId;
  const secret = created.json.secret;
  const code = created.json.code;

  const terminalConn = await connect(HOST, WS_TERMINAL_PORT, `/sessions/${sessionId}/ws`, { "x-relay-secret": secret });
  ok(true, "scripted terminal connects over the terminal ws port with x-relay-secret");

  const userId = crypto.randomUUID();
  const paired = await fetchJson("/pair", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": userId },
    body: JSON.stringify({ code: code }),
  });
  ok(paired.status === 200 && paired.json && paired.json.sessionId === sessionId, "POST /pair binds the pseudo-identity to the session via x-user header");

  const browserConn = await connect(
    HOST,
    WS_BROWSER_PORT,
    `/w/${sessionId}/ws?x-user=${encodeURIComponent(userId)}`,
    {}
  );
  ok(true, "scripted browser connects over the browser ws port with NO x-user header, only the query-param fallback");

  const received = [];
  browserConn.onMessage((msg) => received.push(msg));

  browserConn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  await sleep(200);

  const fixture = [
    { v: 1, seq: 1, type: "turn.start", turnId: "t1", prompt: "add a health endpoint and a test for it" },
    { v: 1, seq: 2, type: "text.delta", turnId: "t1", text: "No health route yet. I'll add GET /health and a test for it." },
    { v: 1, seq: 3, type: "tool.call", turnId: "t1", callId: "c1", tool: "write", args: "src/routes/health.ts" },
    { v: 1, seq: 4, type: "tool.result", turnId: "t1", callId: "c1", ok: true, output: "wrote 12 lines", truncated: false },
    { v: 1, seq: 5, type: "tool.call", turnId: "t1", callId: "c2", tool: "run", args: "npm test" },
    { v: 1, seq: 6, type: "tool.result", turnId: "t1", callId: "c2", ok: true, output: "2 passed, 0 failed", truncated: false },
    { v: 1, seq: 7, type: "turn.end", turnId: "t1", reason: "done" },
  ];
  for (const f of fixture) {
    terminalConn.send(JSON.stringify(f));
    await sleep(20);
  }
  await sleep(300);

  ok(received.length === fixture.length, `the browser received all ${fixture.length} fixture frames published by the scripted terminal (got ${received.length})`);
  const texts = received.map((m) => JSON.parse(m).type);
  ok(texts.join(",") === fixture.map((f) => f.type).join(","), "frames arrived in publish order");

  const approvalCallId = "c3";
  const decision = { v: 1, seq: 0, type: "approval.reply", callId: approvalCallId, decision: "allow" };
  const relayed = [];
  terminalConn.onMessage((msg) => relayed.push(msg));
  browserConn.send(JSON.stringify(decision));
  await sleep(200);
  ok(relayed.length === 1 && JSON.parse(relayed[0]).type === "approval.reply", "an approval.reply sent by the browser is forwarded to the terminal");

  terminalConn.close();
  browserConn.close();
}

async function main() {
  await checkWebPageServed();
  await scriptedTerminalAndBrowser();
  console.log("");
  if (failures > 0) {
    console.error(failures + " check(s) failed");
    process.exit(1);
  }
  console.log("all e2e relay checks passed");
}

main().catch((e) => {
  console.error("e2e check crashed: " + (e && e.stack || e));
  process.exit(1);
});
