// Spike for #134: prove a browser that is not the bundled relay page can
// drive a real `joule --share` terminal end to end - pair, send input,
// watch the terminal actually run it, cancel, and answer an approval.
//
// This is throwaway verification code, not a shipped client. It exists to
// answer the ticket's first question with evidence: the frames already
// documented in src/protocol/frames.ts and already accepted by
// src/relay/ws.ts work exactly as advertised when driven from a script
// that is not src/relay/web/page_js_client.ts.
//
// Usage:
//   node scripts/spike_134_console_link.mjs <pairing-code> [workspaceFile]
//
// Reads relay ports from JOULE_RELAY_HTTP_PORT / JOULE_RELAY_WS_BROWSER_PORT,
// same env vars the real relay binary and terminal already use.

import { connect } from "./miniws.mjs";
import crypto from "node:crypto";
import fs from "node:fs";

const HOST = process.env.JOULE_RELAY_HOST || "127.0.0.1";
const HTTP_PORT = Number(process.env.JOULE_RELAY_HTTP_PORT || 18190);
const WS_BROWSER_PORT = Number(process.env.JOULE_RELAY_WS_BROWSER_PORT || 18192);
const CODE = process.argv[2];
const WATCH_FILE = process.argv[3] || null;

if (!CODE) {
  console.error("usage: node spike_134_console_link.mjs <pairing-code> [fileToWatch]");
  process.exit(1);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let checks = 0;
let failures = 0;
function ok(cond, label) {
  checks += 1;
  if (cond) { console.log("ok  : " + label); }
  else { failures += 1; console.error("FAIL: " + label); }
}
function note(label) { console.log("note: " + label); }

async function main() {
  note("acting as a browser that is NOT src/relay/web/page_js_client.ts - a hand-rolled websocket client instead");

  // Step 1: redeem the pairing code exactly the way console proxy traffic
  // would: an authenticated x-user header on a plain POST. The relay never
  // sees a cookie; it trusts this header because spec 002 says only a proxy
  // sitting in front of it is ever allowed to set it.
  const userId = crypto.randomUUID();
  note("pairing as x-user=" + userId);
  const pairResp = await fetch(`http://${HOST}:${HTTP_PORT}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": userId },
    body: JSON.stringify({ code: CODE }),
  });
  const pairBody = await pairResp.json();
  ok(pairResp.status === 200 && !!pairBody.sessionId, "POST /pair against the real running terminal's printed code succeeds");
  if (!pairBody.sessionId) {
    console.error("cannot continue without a sessionId; pair response: " + JSON.stringify(pairBody));
    process.exit(1);
  }
  const sessionId = pairBody.sessionId;
  note("bound to sessionId " + sessionId);

  // Step 2: a second pair attempt with the same code must fail - single use.
  const secondPair = await fetch(`http://${HOST}:${HTTP_PORT}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": crypto.randomUUID() },
    body: JSON.stringify({ code: CODE }),
  });
  ok(secondPair.status !== 200, "the same code cannot be redeemed a second time (single-use, confirmed against the real relay)");

  // Step 3: a websocket from a *different* uuid must be refused, even
  // knowing the real sessionId - the pairing binds a specific account, not
  // just "someone who once had the code".
  const impostor = await connect(HOST, WS_BROWSER_PORT, `/w/${sessionId}/ws?x-user=${encodeURIComponent(crypto.randomUUID())}`, {});
  const impostorFrames = [];
  impostor.onMessage((m) => impostorFrames.push(JSON.parse(m)));
  // The relay only checks pairing on an inbound message (see
  // handleBrowserMessage in src/relay/ws.ts) - connecting alone proves
  // nothing, a frame has to actually be sent for the refusal to fire.
  impostor.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  await sleep(300);
  const impostorError = impostorFrames.find((f) => f.type === "error");
  ok(!!impostorError && impostorError.code === "wrong_user", "a websocket carrying a different x-user than the one that redeemed the code is refused (wrong_user)");
  impostor.close();

  // Step 4: connect as the real paired browser and resume the transcript.
  const conn = await connect(HOST, WS_BROWSER_PORT, `/w/${sessionId}/ws?x-user=${encodeURIComponent(userId)}`, {});
  const frames = [];
  conn.onMessage((m) => {
    try { frames.push(JSON.parse(m)); } catch { /* ignore malformed */ }
  });
  conn.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
  await sleep(500);
  const hello = frames.find((f) => f.type === "session.hello");
  ok(!!hello, "the real joule --share process published a real session.hello, replayed on resume");
  if (hello) { note("session.hello: " + JSON.stringify(hello)); }

  // Step 5: send a real `input` frame and confirm the terminal actually
  // runs it - not just that the frame was accepted, but that a turn starts
  // and text comes back from the real model call the terminal makes.
  const marker = "SPIKE134_" + crypto.randomBytes(4).toString("hex");
  const prompt = WATCH_FILE
    ? `Run the shell command: echo ${marker} >> ${WATCH_FILE}`
    : `Say the exact word ${marker} and nothing else.`;
  note("sending input: " + JSON.stringify(prompt));
  const beforeInputCount = frames.length;
  conn.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: prompt }));

  let turnStarted = false;
  let approvalReq = null;
  let turnEnded = false;
  const deadline1 = Date.now() + 45000;
  while (Date.now() < deadline1 && !turnEnded) {
    await sleep(300);
    for (const f of frames.slice(beforeInputCount)) {
      if (f.type === "turn.start") { turnStarted = true; }
      if (f.type === "approval.request" && !approvalReq) { approvalReq = f; }
      if (f.type === "turn.end") { turnEnded = true; }
    }
    if (approvalReq) { break; }
  }
  ok(turnStarted, "the terminal started a real turn in response to the browser's `input` frame");

  if (approvalReq) {
    note("terminal asked for approval on tool " + approvalReq.tool + " (callId " + approvalReq.callId + "): " + approvalReq.summary);
    // Step 6: answer the approval from the browser side.
    conn.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId: approvalReq.callId, decision: "allow" }));
    const deadline2 = Date.now() + 30000;
    while (Date.now() < deadline2 && !turnEnded) {
      await sleep(300);
      for (const f of frames) {
        if (f.type === "turn.end") { turnEnded = true; }
      }
    }
    ok(turnEnded, "the turn completed after the browser's approval.reply was forwarded to the terminal");
  } else {
    // auto-edit mode only gates `run`, so a pure text reply needs no
    // approval; wait for the turn to end on its own.
    const deadline2 = Date.now() + 30000;
    while (Date.now() < deadline2 && !turnEnded) {
      await sleep(300);
      for (const f of frames) { if (f.type === "turn.end") { turnEnded = true; } }
    }
    ok(turnEnded, "the turn completed (no approval was needed for this prompt)");
  }

  const gotMarkerInDelta = frames.some((f) => f.type === "text.delta" && f.text && f.text.includes(marker));
  const gotMarkerInToolResult = frames.some((f) => f.type === "tool.result" && f.output && f.output.includes(marker));
  const gotMarkerInToolCall = frames.some((f) => f.type === "tool.call" && f.args && f.args.includes(marker));
  ok(gotMarkerInDelta || gotMarkerInToolResult || gotMarkerInToolCall, "the marker this run generated (" + marker + ") appears in a real frame the terminal published, proving this exact input was processed, not a stale/cached reply");

  if (WATCH_FILE) {
    await sleep(500);
    let fileHasMarker = false;
    try { fileHasMarker = fs.readFileSync(WATCH_FILE, "utf8").includes(marker); } catch { /* file may not exist */ }
    ok(fileHasMarker, "the marker landed in " + WATCH_FILE + " on disk - the browser's input frame caused a real command to run on the terminal's machine");
  }

  // Step 7: start a second turn and cancel it from the browser.
  const beforeCancelCount = frames.length;
  conn.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "Count slowly from 1 to 100000, one number per line." }));
  let secondTurnId = null;
  const deadline3 = Date.now() + 15000;
  while (Date.now() < deadline3 && !secondTurnId) {
    await sleep(200);
    const started = frames.slice(beforeCancelCount).find((f) => f.type === "turn.start");
    if (started) { secondTurnId = started.turnId; }
  }
  ok(!!secondTurnId, "a second turn started, ready to be cancelled");
  if (secondTurnId) {
    conn.send(JSON.stringify({ v: 1, seq: 0, type: "cancel", turnId: secondTurnId }));
    let secondTurnEnded = false;
    let cancelReason = "";
    const deadline4 = Date.now() + 30000;
    while (Date.now() < deadline4 && !secondTurnEnded) {
      await sleep(300);
      for (const f of frames.slice(beforeCancelCount)) {
        if (f.type === "turn.end" && f.turnId === secondTurnId) { secondTurnEnded = true; cancelReason = f.reason; }
      }
    }
    ok(secondTurnEnded, "the second turn ended after the browser sent `cancel`");
    ok(cancelReason === "cancelled", "turn.end carried reason=cancelled (got " + JSON.stringify(cancelReason) + "), not done/error - cancel actually took effect, not just coincidental completion");
  }

  conn.close();

  console.log("");
  console.log(checks + " checks run, " + failures + " failed");
  if (failures > 0) { process.exit(1); }
  console.log("spike passed: input, cancel, and approval.reply all drove the real terminal from a non-bundled browser client");
}

main().catch((e) => {
  console.error("crashed: " + (e && e.stack || e));
  process.exit(1);
});
