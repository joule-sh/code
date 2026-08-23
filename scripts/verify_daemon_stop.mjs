import { connect } from "./miniws.mjs";
import { spawn } from "node:child_process";
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

function waitForPortClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const attempt = () =>
    new Promise((resolve) => {
      const sock = net.createConnection(port, "127.0.0.1");
      sock.once("connect", () => { sock.end(); resolve(false); });
      sock.once("error", () => resolve(true));
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

async function collectUntil(frames, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (frames.some(predicate)) return;
    await sleep(25);
  }
  throw new Error("timed out waiting for " + label);
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "joule-daemon-stop-"));
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n");

  const stubPort = await freePort();
  const daemonPort = await freePort();

  const stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], {
    cwd: workspace,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "inherit",
  });

  const daemonLog = path.join(workspace, "daemon.log");
  const daemon = spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
    cwd: workspace,
    env: {
      ...process.env,
      JOULE_DAEMON_PORT: String(daemonPort),
      JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
      JOULE_CODE_MODEL: "stub-model",
      JOULE_CODE_API_KEY: "test-key",
    },
    stdio: ["ignore", fs.openSync(daemonLog, "w"), fs.openSync(daemonLog, "a")],
  });

  let daemonExited = false;
  daemon.once("exit", () => { daemonExited = true; });

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

    connB.send(JSON.stringify({ v: 1, seq: 0, type: "daemon.stop" }));

    await collectUntil(framesA, (f) => f.type === "daemon.stopping", 5000, "client A (who did not ask) to see daemon.stopping");
    await collectUntil(framesB, (f) => f.type === "daemon.stopping", 5000, "client B (who asked) to see daemon.stopping");
    const stoppingA = framesA.find((f) => f.type === "daemon.stopping");
    ok(typeof stoppingA.reason === "string" && stoppingA.reason.length > 0, "the daemon.stopping frame carries a human-readable reason, got " + JSON.stringify(stoppingA.reason));

    ok(await waitForPortClosed(daemonPort, 5000), "the daemon's port stops accepting connections after the grace period");

    const deadline = Date.now() + 5000;
    while (!daemonExited && Date.now() < deadline) { await sleep(50); }
    ok(daemonExited, "the daemon process itself exited after stopping");

    console.log("PASS: a daemon.stop request from one client is broadcast to every attached client before the daemon exits, and the daemon process actually terminates");
  } finally {
    if (!daemonExited) daemon.kill();
    stub.kill();
    if (!process.env.DEBUG_KEEP) fs.rmSync(workspace, { recursive: true, force: true }); else console.error("workspace kept at " + workspace);
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exitCode = 1;
});
