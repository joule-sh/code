// Spike for #139: drive the real daemon (daemon_live_demo, built from real
// Session/Gate/LiveProvider/frame-protocol code) over its websocket, the
// same way spike_134_console_link.mjs drove the terminal through the relay.
// Reuses miniws.mjs unchanged.
import { connect } from "./miniws.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.JOULE_DAEMON_PORT || 8199);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let checks = 0;
let failures = 0;
function ok(cond, label) {
  checks += 1;
  if (cond) { console.log("ok  : " + label); }
  else { failures += 1; console.error("FAIL: " + label); }
}
function note(label) { console.log("note: " + label); }

async function client(tag) {
  const conn = await connect(HOST, PORT, "/ws", {});
  const frames = [];
  conn.onMessage((m) => { try { frames.push(JSON.parse(m)); } catch {} });
  conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  return { tag, conn, frames };
}

async function main() {
  note("Q1: a single client attaches to the daemon and drives a real turn over frames, no tty involved anywhere in the daemon process");
  const a = await client("A");
  await sleep(400);
  const hello = a.frames.find((f) => f.type === "session.hello");
  ok(!!hello, "client A received session.hello on connect/resume");

  const beforeCount = a.frames.length;
  a.conn.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "say hello in one word" }));
  let turnEnded = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && !turnEnded) {
    await sleep(300);
    for (const f of a.frames.slice(beforeCount)) {
      if (f.type === "turn.end") { turnEnded = true; }
    }
  }
  ok(turnEnded, "a real turn against the real model completed, driven purely by an `input` frame with no terminal involved");
  const gotDelta = a.frames.some((f) => f.type === "text.delta");
  ok(gotDelta, "text.delta frames flowed back over the socket");

  note("Q2: a second client attaches to the SAME live session concurrently - does it see consistent state, does anything corrupt or crash");
  const b = await client("B");
  await sleep(400);
  const helloB = b.frames.find((f) => f.type === "session.hello");
  note("client B session.hello present: " + !!helloB + " (a fresh connection only gets backlog via resume{since:-1}; whether it sees the earlier hello depends on whether this spike's broadcast-only daemon_store recorded it before B attached)");

  // Fire two concurrent turns from A and B at nearly the same instant - this
  // is exactly the scenario the relay's own SessionStore/PeerRegistry cannot
  // serve today (one peer per role) and that a daemon exists to unblock.
  const beforeA = a.frames.length;
  const beforeB = b.frames.length;
  const p1 = (async () => { a.conn.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "count to 3" })); })();
  const p2 = (async () => { b.conn.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "count to 5" })); })();
  await Promise.all([p1, p2]);

  let aEnded = false, bEnded = false;
  const deadline2 = Date.now() + 30000;
  while (Date.now() < deadline2 && !(aEnded && bEnded)) {
    await sleep(300);
    for (const f of a.frames.slice(beforeA)) { if (f.type === "turn.end") { aEnded = true; } }
    for (const f of b.frames.slice(beforeB)) { if (f.type === "turn.end") { bEnded = true; } }
  }
  note("both clients' input landed while a daemon process (still alive: check separately) processed them - aEnded=" + aEnded + " bEnded=" + bEnded);
  ok(aEnded || bEnded, "at least one of the two concurrently-submitted turns completed without the process dying (RelayInputBridge serializes submit() calls per-frame-arrival, so this is checking the process survives concurrent connection threads dispatching into it, not true simultaneous submit() execution)");

  console.log("");
  console.log(checks + " checks run, " + failures + " failed");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("crashed: " + (e && e.stack || e));
  process.exit(1);
});
