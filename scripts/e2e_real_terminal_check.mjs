import { connect } from "./miniws.mjs";
import crypto from "node:crypto";

const HOST = "127.0.0.1";
const HTTP_PORT = Number(process.env.JOULE_RELAY_HTTP_PORT || 18090);
const WS_BROWSER_PORT = Number(process.env.JOULE_RELAY_WS_BROWSER_PORT || 18092);
const CODE = process.argv[2];

if (!CODE) {
  console.error("usage: node e2e_real_terminal_check.mjs <pairing-code>");
  process.exit(1);
}

let failures = 0;
function ok(cond, label) {
  if (cond) { console.log("ok: " + label); }
  else { failures += 1; console.error("FAIL: " + label); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const userId = crypto.randomUUID();
  const resp = await fetch(`http://${HOST}:${HTTP_PORT}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": userId },
    body: JSON.stringify({ code: CODE }),
  });
  const body = await resp.json();
  ok(resp.status === 200 && body.sessionId, "POST /pair against the real joule --share terminal's printed code succeeds");

  const conn = await connect(
    HOST,
    WS_BROWSER_PORT,
    `/w/${body.sessionId}/ws?x-user=${encodeURIComponent(userId)}`,
    {}
  );
  ok(true, "browser ws connects with the query-param x-user fallback, no header at all");

  const frames = [];
  conn.onMessage((m) => frames.push(JSON.parse(m)));
  conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  await sleep(500);

  ok(frames.length >= 1, `received at least one real frame from the live joule --share process (got ${frames.length})`);
  const hello = frames.find((f) => f.type === "session.hello");
  ok(!!hello, "the received frame(s) include a real session.hello published by the actual terminal binary");
  if (hello) {
    console.log("session.hello payload: " + JSON.stringify(hello));
  }

  conn.close();
  console.log("");
  if (failures > 0) {
    console.error(failures + " check(s) failed");
    process.exit(1);
  }
  console.log("real-terminal e2e check passed");
}

main().catch((e) => {
  console.error("crashed: " + (e && e.stack || e));
  process.exit(1);
});
