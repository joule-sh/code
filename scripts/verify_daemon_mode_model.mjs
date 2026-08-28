import { connect } from "./miniws.mjs";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.mjs";

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

async function collectUntil(frames, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (frames.some(predicate)) return;
    await sleep(25);
  }
  throw new Error("timed out waiting for " + label);
}

async function main() {
  const workspace = scratchDir("joule-daemon-modelmode-");
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

    const helloA = framesA.find((f) => f.type === "session.hello");
    ok(!!helloA && helloA.mode === "safe-auto", "client A's session.hello reports the daemon's starting mode");

    connA.send(JSON.stringify({ v: 1, seq: 0, type: "mode.set", mode: "full-auto" }));
    await collectUntil(framesA, (f) => f.type === "mode.changed", 5000, "client A to see mode.changed after setting it itself");
    await collectUntil(framesB, (f) => f.type === "mode.changed", 5000, "client B to see mode.changed from a mode set on client A");
    const modeChangedB = framesB.find((f) => f.type === "mode.changed");
    ok(modeChangedB.mode === "full-auto", "client B's mode.changed carries the new mode, got " + modeChangedB.mode);

    connB.send(JSON.stringify({ v: 1, seq: 0, type: "mode.set", mode: "not-a-real-mode" }));
    await collectUntil(framesA, (f) => f.type === "error" && f.code === "mode.invalid", 5000, "client A to see an error for an invalid mode set on client B");
    const stillFullAutoFrames = framesB.filter((f) => f.type === "mode.changed");
    ok(stillFullAutoFrames.length === 1, "an invalid mode.set produced no second mode.changed broadcast, got " + stillFullAutoFrames.length);

    connB.send(JSON.stringify({ v: 1, seq: 0, type: "model.set", model: "deepseek-chat-v2" }));
    await collectUntil(framesA, (f) => f.type === "model.changed", 5000, "client A to see model.changed from a model set on client B");
    await collectUntil(framesB, (f) => f.type === "model.changed", 5000, "client B to see its own model.changed");
    const modelChangedA = framesA.find((f) => f.type === "model.changed");
    ok(modelChangedA.model === "deepseek-chat-v2", "client A's model.changed carries the new model, got " + modelChangedA.model);

    connA.send(JSON.stringify({ v: 1, seq: 0, type: "tasks.request", arg: "" }));
    await collectUntil(framesA, (f) => f.type === "tasks.response", 5000, "client A to see a tasks.response after asking");
    await collectUntil(framesB, (f) => f.type === "tasks.response", 5000, "client B to also see the tasks.response (broadcast, shared session state)");
    const tasksResp = framesA.find((f) => f.type === "tasks.response");
    ok(typeof tasksResp.text === "string" && tasksResp.text.length > 0, "the tasks.response carries listing text, got " + JSON.stringify(tasksResp.text));

    console.log("PASS: mode.set and model.set from one attached client are visible to a second attached client, invalid input is rejected without side effects, and tasks.request round-trips");
  } finally {
    daemon.kill();
    stub.kill();
    if (!process.env.DEBUG_KEEP) fs.rmSync(workspace, { recursive: true, force: true }); else console.error("workspace kept at " + workspace);
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exitCode = 1;
});
