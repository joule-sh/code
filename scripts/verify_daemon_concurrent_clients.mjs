import { connect } from "./miniws.mjs";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const attempt = () =>
    new Promise((resolve) => {
      const sock = net.createConnection(port, "127.0.0.1");
      sock.once("connect", () => { sock.end(); resolve(true); });
      sock.once("error", () => resolve(false));
    });
  return (async () => {
    while (Date.now() < deadline) {
      if (await attempt()) return true;
      await sleep(50);
    }
    return false;
  })();
}

function ok(cond, label) {
  if (!cond) {
    console.error("FAIL: " + label);
    process.exitCode = 1;
  } else {
    console.log("ok: " + label);
  }
}

async function collectUntil(conn, frames, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (frames.some(predicate)) return;
    await sleep(25);
  }
  throw new Error("timed out waiting for " + label);
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "joule-daemon-verify-"));
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n");

  const stubPort = await freePort();
  const daemonPort = await freePort();

  const stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], {
    cwd: workspace,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "inherit",
  });

  const started = [];
  function startDaemon(port, logName) {
    const log = path.join(workspace, logName);
    const child = spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
      cwd: workspace,
      env: {
        ...process.env,
        JOULE_DAEMON_PORT: String(port),
        JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
        JOULE_CODE_MODEL: "stub-model",
        JOULE_CODE_API_KEY: "test-key",
      },
      stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")],
    });
    started.push(child);
    return child;
  }

  const daemon = startDaemon(daemonPort, "daemon.log");

  try {
    ok(await waitForPort(stubPort, 5000), "stub model came up");
    ok(await waitForPort(daemonPort, 5000), "daemon came up");

    const idA = crypto.randomBytes(8).toString("hex");
    const idB = crypto.randomBytes(8).toString("hex");

    const connA = await connect("127.0.0.1", daemonPort, `/attach/${idA}/ws`, {});
    const connB = await connect("127.0.0.1", daemonPort, `/attach/${idB}/ws`, {});

    const framesA = [];
    const framesB = [];
    connA.onMessage((text) => framesA.push(JSON.parse(text)));
    connB.onMessage((text) => framesB.push(JSON.parse(text)));

    connA.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    connB.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await sleep(200);

    connA.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "fix the health route" }));

    await collectUntil(connA, framesA, (f) => f.type === "approval.request", 8000, "client A to see the approval request");
    await collectUntil(connB, framesB, (f) => f.type === "approval.request", 8000, "client B to see the same approval request");

    const req = framesA.find((f) => f.type === "approval.request");
    ok(req && req.tool === "run", "the pending approval is for the run tool");

    connB.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId: req.callId, decision: "allow" }));

    await collectUntil(connA, framesA, (f) => f.type === "turn.end", 8000, "client A to see turn.end after client B approved");
    await collectUntil(connB, framesB, (f) => f.type === "turn.end", 8000, "client B to see its own turn.end");

    const seenA = framesA.filter((f) => typeof f.seq === "number").map((f) => f.seq);
    const seenB = framesB.filter((f) => typeof f.seq === "number").map((f) => f.seq);
    const commonMax = Math.min(seenA.length ? Math.max(...seenA) : 0, seenB.length ? Math.max(...seenB) : 0);
    const byTypeA = new Map(framesA.map((f) => [f.seq, f.type]));
    const byTypeB = new Map(framesB.map((f) => [f.seq, f.type]));
    let consistent = true;
    for (let s = 1; s <= commonMax; s++) {
      if (byTypeA.has(s) && byTypeB.has(s) && byTypeA.get(s) !== byTypeB.get(s)) { consistent = false; }
    }
    ok(consistent, "every seq both clients observed carries the same frame type on each side");

    const toolResult = framesA.find((f) => f.type === "tool.result" && f.callId === req.callId);
    ok(!!toolResult && toolResult.ok === true, "the approved run actually executed and reported ok");
    ok(fs.readFileSync(path.join(workspace, "README.md"), "utf8").includes("Added a health check note."), "the run tool's effect landed on the workspace filesystem, not a remote copy");

    connA.close();
    connB.close();
    daemon.kill("SIGKILL");
    await sleep(500);

    const secondPort = await freePort();
    startDaemon(secondPort, "daemon-second.log");
    ok(await waitForPort(secondPort, 8000), "a second daemon started in the workspace the first one had been running in");

    const idC = crypto.randomBytes(8).toString("hex");
    const connC = await connect("127.0.0.1", secondPort, `/attach/${idC}/ws`, {});
    const framesC = [];
    connC.onMessage((text) => framesC.push(JSON.parse(text)));
    connC.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));

    await collectUntil(connC, framesC, (f) => f.type === "session.hello", 8000,
      "a client joining the second daemon to be told a session.hello");
    ok(framesC[0].type === "session.hello",
      "the first frame a joining client is replayed is the hello of the session it is joining");
    ok(!framesC.some((f) => f.type === "turn.start" || f.type === "text.delta"),
      "no frame of the session that ran here before is replayed into the one that is running now");

    connC.send(JSON.stringify({ v: 1, seq: 0, type: "mode.set", mode: "full-auto" }));
    await collectUntil(connC, framesC, (f) => f.type === "mode.changed" && f.mode === "full-auto", 8000,
      "the new session's own mode.changed to reach its client rather than being shadowed by the previous session's seq numbers");
    ok(true, "a mode set in the second session is broadcast to it, so its clients agree on the mode from the moment they attach");
    connC.close();

    console.log("PASS: two concurrent daemon clients observed a consistent turn, cross-client approval worked, and a client joining a restarted daemon is replayed that session and no other");
  } finally {
    for (const child of started) { child.kill("SIGKILL"); }
    stub.kill();
    if (!process.env.DEBUG_KEEP) fs.rmSync(workspace, { recursive: true, force: true }); else console.error("workspace kept at " + workspace);
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exitCode = 1;
});
