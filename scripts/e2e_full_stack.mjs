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

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
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
      sock.once("connect", () => {
        sock.end();
        resolve(true);
      });
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

async function waitForMatch(getText, regex, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = stripAnsi(getText()).match(regex);
    if (m) return m;
    await sleep(50);
  }
  throw new Error("timed out waiting for " + label);
}

async function waitForFrame(frames, pred, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = frames.find(pred);
    if (found) return found;
    await sleep(50);
  }
  throw new Error("timed out waiting for " + label);
}

function spawnBg(command, args, options) {
  const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

function runSync(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${r.stderr}`);
  }
}

function seedRepo(repoDir) {
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(repoDir, "README.md"), "# demo\n\nNo health route yet.\n");
  runSync("git", ["init", "-q"], repoDir);
  runSync("git", ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", "add", "."], repoDir);
  runSync("git", ["-c", "user.email=e2e@example.com", "-c", "user.name=e2e", "commit", "-q", "-m", "seed"], repoDir);
}

async function runScenario(name, approve) {
  const failures = [];
  const ok = (cond, label) => {
    if (cond) { console.log("ok: " + name + ": " + label); }
    else { failures.push(label); console.error("FAIL: " + name + ": " + label); }
  };

  const ports = {
    http: await freePort(),
    ws: await freePort(),
    wsBrowser: await freePort(),
    stub: await freePort(),
  };

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "joule-e2e-"));
  const repoDir = path.join(workDir, "repo");
  seedRepo(repoDir);
  const readmePath = path.join(repoDir, "README.md");
  const originalReadme = fs.readFileSync(readmePath, "utf8");

  const stubLog = path.join(workDir, "stub_requests.log");
  const termLog = path.join(workDir, "terminal.log");
  fs.writeFileSync(termLog, "");

  let stub, relay, term;
  try {
    stub = spawnBg(path.join(REPO_ROOT, "bin/stub_model"), [], {
      env: { ...process.env, E2E_STUB_PORT: String(ports.stub), E2E_STUB_LOG: stubLog },
    });
    if (!(await waitForPort(ports.stub, 5000))) throw new Error(name + ": stub model server did not start");

    relay = spawnBg(path.join(REPO_ROOT, "bin/relay"), [], {
      env: {
        ...process.env,
        JOULE_RELAY_HTTP_PORT: String(ports.http),
        JOULE_RELAY_WS_PORT: String(ports.ws),
        JOULE_RELAY_WS_BROWSER_PORT: String(ports.wsBrowser),
      },
    });
    if (!(await waitForPort(ports.http, 5000))) throw new Error(name + ": relay http port did not start");
    if (!(await waitForPort(ports.ws, 5000))) throw new Error(name + ": relay terminal ws port did not start");
    if (!(await waitForPort(ports.wsBrowser, 5000))) throw new Error(name + ": relay browser ws port did not start");

    term = spawnBg("script", ["-qec", `${REPO_ROOT}/bin/joule --share`, termLog], {
      cwd: repoDir,
      env: {
        ...process.env,
        JOULE_CODE_BASE_URL: `http://127.0.0.1:${ports.stub}`,
        JOULE_CODE_MODEL: "stub",
        JOULE_CODE_API_KEY: "stub-key", // non-empty so the first-run wizard (#46) does not trigger; the stub model does not check it
        JOULE_RELAY_HOST: "127.0.0.1",
        JOULE_RELAY_HTTP_PORT: String(ports.http),
        JOULE_RELAY_WS_PORT: String(ports.ws),
        TMPDIR: workDir,
      },
    });
    let termBuf = "";
    term.stdout.on("data", (d) => { termBuf += d.toString("utf8"); });
    term.stderr.on("data", (d) => { termBuf += d.toString("utf8"); });

    const codeMatch = await waitForMatch(() => termBuf, /attached - code (\S+) -/, 10000, name + ": terminal pairing code");
    const code = codeMatch[1];

    const userId = crypto.randomUUID();
    const pairResp = await fetch(`http://127.0.0.1:${ports.http}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId },
      body: JSON.stringify({ code }),
    });
    ok(pairResp.status === 200, "POST /pair against the printed code succeeds");
    const pairBody = await pairResp.json();
    const sessionId = pairBody.sessionId;

    const browser = await connect(
      "127.0.0.1",
      ports.wsBrowser,
      `/w/${sessionId}/ws?x-user=${encodeURIComponent(userId)}`,
      {}
    );
    const frames = [];
    browser.onMessage((raw) => {
      try { frames.push(JSON.parse(raw)); } catch { /* ignore malformed */ }
    });
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await sleep(150);

    browser.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "add a health note to the README" }));

    const readCall = await waitForFrame(frames, (f) => f.type === "tool.call" && f.tool === "read", 10000, name + ": read tool.call");
    ok(!!readCall, "the browser saw the read tool.call");
    const readResult = await waitForFrame(frames, (f) => f.type === "tool.result" && f.callId === readCall.callId, 10000, name + ": read tool.result");
    ok(readResult.ok === true, "the read tool.result reports ok");

    const approvalReq = await waitForFrame(frames, (f) => f.type === "approval.request", 10000, name + ": approval.request");
    ok(approvalReq.tool === "run", "the approval.request is for the run tool");

    browser.send(JSON.stringify({
      v: 1, seq: 0, type: "approval.reply", callId: approvalReq.callId, decision: approve ? "allow" : "deny",
    }));

    const turnEnd = await waitForFrame(frames, (f) => f.type === "turn.end", 15000, name + ": turn.end");
    ok(turnEnd.reason === "done", "turn.end reason is done, got " + turnEnd.reason);

    const runCall = frames.find((f) => f.type === "tool.call" && f.tool === "run");
    if (approve) {
      ok(!!runCall, "a run tool.call was emitted after approval");
      const runResult = frames.find((f) => f.type === "tool.result" && f.callId === (runCall && runCall.callId));
      ok(!!runResult && runResult.ok === true, "the run tool.result reports ok");
      const afterReadme = fs.readFileSync(readmePath, "utf8");
      ok(afterReadme.indexOf("Added a health check note.") >= 0, "the file on disk changed after approval");
    } else {
      ok(!runCall, "no run tool.call was emitted after denial");
      const afterReadme = fs.readFileSync(readmePath, "utf8");
      ok(afterReadme === originalReadme, "the file on disk did not change after denial");
      const readLog = () => (fs.existsSync(stubLog) ? fs.readFileSync(stubLog, "utf8") : "");
      let sawDenial = false;
      try {
        await waitForMatch(readLog, /run: denied/, 5000, name + ": denial recorded in the stub model's request log");
        sawDenial = true;
      } catch { /* reported below via ok() */ }
      ok(sawDenial, "the model's next request carried the denial as a tool result");
    }

    browser.close();
  } finally {
    killTree(term);
    killTree(relay);
    killTree(stub);
  }

  return failures;
}

async function main() {
  const start = Date.now();
  const results = [];
  results.push(...(await runScenario("demo", true)));
  results.push(...(await runScenario("guard", false)));
  const elapsedMs = Date.now() - start;
  console.log(`e2e finished in ${elapsedMs}ms`);
  if (results.length > 0) {
    console.error(`${results.length} check(s) failed: ${results.join("; ")}`);
    process.exit(1);
  }
  console.log("e2e full stack check passed");
}

main().catch((e) => {
  console.error("crashed: " + (e && e.stack ? e.stack : e));
  process.exit(1);
});
