// A daemon that comes up headless: the approval mode it runs in is answered
// on its command line, its first task can be answered there too, and the
// directory it keeps its inbox and broadcast log in can be named from outside
// (#348).
//
// Everything here is asserted against broadcast.log rather than against a
// websocket client, because that is the surface the thing driving an
// unattended daemon actually reads - it reaches into a container with
// `docker exec` and has no socket to dial. The one client this harness does
// use is a file: a frame line appended to <runtimeDir>/inbox/<connId>.in,
// which is the same path the websocket connection handler writes to.
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAEMON = path.join(REPO_ROOT, "bin", "joule-daemon");
const STUB = path.join(REPO_ROOT, "bin", "stub_model");

const failures = [];

function ok(cond, label) {
  if (cond) {
    console.log("ok: " + label);
    return;
  }
  console.error("FAIL: " + label);
  failures.push(label);
}

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

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const up = await new Promise((resolve) => {
      const sock = net.createConnection(port, "127.0.0.1");
      sock.once("connect", () => { sock.end(); resolve(true); });
      sock.once("error", () => resolve(false));
    });
    if (up) return true;
    await sleep(50);
  }
  return false;
}

function seedWorkspace(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# demo\n");
  return dir;
}

// A HOME with a config file in it, so the daemon reads credentials from the
// environment rather than from whoever is running this.
function seedHome(dir) {
  fs.mkdirSync(path.join(dir, ".config", "joule-code"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".config", "joule-code", "config.json"), JSON.stringify({
    baseUrl: "", model: "", apiKey: "", server: "", updateCheck: "", mouse: "",
  }));
  return dir;
}

// One line per frame: `${epochMs}|F|<json>`, with no newline inside the JSON.
function readFrames(logPath) {
  if (!fs.existsSync(logPath)) return [];
  const out = [];
  for (const line of fs.readFileSync(logPath, "utf8").split("\n")) {
    if (line === "") continue;
    const bar1 = line.indexOf("|");
    const bar2 = line.indexOf("|", bar1 + 1);
    if (bar1 < 0 || bar2 < 0) continue;
    if (line.slice(bar1 + 1, bar2) !== "F") continue;
    try {
      out.push(JSON.parse(line.slice(bar2 + 1)));
    } catch {
      // A frame still being written is not a frame yet.
    }
  }
  return out;
}

async function framesUntil(logPath, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const frames = readFrames(logPath);
    if (frames.some(predicate)) return frames;
    await sleep(100);
  }
  throw new Error("timed out waiting for " + label + " in " + logPath);
}

function sendInput(runtimeDir, connId, text) {
  const frame = JSON.stringify({ v: 1, seq: 0, type: "input", text });
  fs.appendFileSync(path.join(runtimeDir, "inbox", connId + ".in"), `${Date.now()}|F|${frame}\n`);
}

function derivedRuntimeDir(home) {
  const base = path.join(home, ".config", "joule-code", "daemon");
  if (!fs.existsSync(base)) return "";
  for (const name of fs.readdirSync(base)) {
    const full = path.join(base, name);
    if (fs.statSync(full).isDirectory()) return full;
  }
  return "";
}

// What the override moves: the inbox and the broadcast log. The daemon's own
// record beside them - `<key>.json`, which is how `joule attach` finds a
// daemon by workspace - is not runtime state and stays where a client looks
// for it, so this deliberately ignores it.
function derivedRuntimeArtifacts(home) {
  const dir = derivedRuntimeDir(home);
  if (dir === "") return [];
  return ["broadcast.log", "inbox"].map((n) => path.join(dir, n)).filter((p) => fs.existsSync(p));
}

function daemonEnv(home, stubPort, port, extra) {
  return {
    ...process.env,
    HOME: home,
    JOULE_DAEMON_PORT: String(port),
    JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
    JOULE_CODE_MODEL: "stub-model",
    JOULE_CODE_API_KEY: "test-key",
    ...extra,
  };
}

function kill(child) {
  if (!child) return;
  try { child.kill("SIGKILL"); } catch { /* already gone */ }
}

// A bad --mode is a startup refusal, not a daemon that comes up in some other
// mode: the process says why and exits non-zero, exactly as `joule` does.
function runToExit(args, env, cwd) {
  return new Promise((resolve) => {
    const child = spawn(DAEMON, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b) => { out += b.toString(); });
    child.stderr.on("data", (b) => { out += b.toString(); });
    child.on("exit", (code) => resolve({ code, out }));
  });
}

async function main() {
  const workDir = scratchDir("joule-348-mode-flag-");
  // A stub model counts the requests it has answered and walks its script by
  // that count, so each scenario gets its own: sharing one would leave the
  // second daemon talking to a model that had already finished its script.
  const stubs = [];
  const freshStub = async () => {
    const port = await freePort();
    stubs.push(spawn(STUB, [], { env: { ...process.env, E2E_STUB_PORT: String(port) }, stdio: "ignore" }));
    if (!(await waitForPort(port, 10000))) throw new Error("the stub model did not come up on " + port);
    return port;
  };
  let daemon = null;

  try {
    // 1. --mode full-auto, with the runtime directory named from outside.
    {
      const stubPort = await freshStub();
      const workspace = seedWorkspace(path.join(workDir, "full-auto", "repo"));
      const home = seedHome(path.join(workDir, "full-auto", "home"));
      const runtimeDir = path.join(workDir, "full-auto", "runtime");
      const port = await freePort();
      daemon = spawn(DAEMON, ["--mode", "full-auto"], {
        cwd: workspace,
        env: daemonEnv(home, stubPort, port, { JOULE_DAEMON_RUNTIME_DIR: runtimeDir }),
        stdio: ["ignore", fs.openSync(path.join(workDir, "full-auto-daemon.log"), "w"), "ignore"],
      });
      ok(await waitForPort(port, 20000), "the daemon came up with --mode full-auto");

      const logPath = path.join(runtimeDir, "broadcast.log");
      const hello = (await framesUntil(logPath, (f) => f.type === "session.hello", 10000, "session.hello"))
        .find((f) => f.type === "session.hello");
      ok(hello.mode === "full-auto", "session.hello carries mode full-auto, got " + hello.mode);

      ok(fs.existsSync(path.join(runtimeDir, "inbox")), "the inbox is in the named runtime directory");
      const strays = derivedRuntimeArtifacts(home);
      ok(strays.length === 0, "no inbox or broadcast log was written under HOME, found " + JSON.stringify(strays));

      sendInput(runtimeDir, "engine", "add a health check note to the README");
      const frames = await framesUntil(logPath, (f) => f.type === "turn.end", 60000, "turn.end");
      const asked = frames.filter((f) => f.type === "approval.request");
      ok(asked.length === 0, "no approval.request was emitted for a write tool, got " + asked.length);
      const calls = frames.filter((f) => f.type === "tool.call").map((f) => f.tool);
      ok(calls.includes("run"), "the turn actually ran the gated write tool, calls were " + JSON.stringify(calls));
      const readme = fs.readFileSync(path.join(workspace, "README.md"), "utf8");
      ok(readme.includes("Added a health check note."), "the write landed on disk unattended");

      kill(daemon);
      daemon = null;
    }

    // 2. No flag at all: safe-auto, the derived runtime directory, and an
    //    approval nobody can answer - the behaviour this slice preserves.
    {
      const stubPort = await freshStub();
      const workspace = seedWorkspace(path.join(workDir, "default", "repo"));
      const home = seedHome(path.join(workDir, "default", "home"));
      const port = await freePort();
      daemon = spawn(DAEMON, [], {
        cwd: workspace,
        env: daemonEnv(home, stubPort, port, {}),
        stdio: ["ignore", fs.openSync(path.join(workDir, "default-daemon.log"), "w"), "ignore"],
      });
      ok(await waitForPort(port, 20000), "the daemon came up with no flags");

      const runtimeDir = derivedRuntimeDir(home);
      ok(runtimeDir !== "", "with no override the runtime directory is still derived under HOME");
      const logPath = path.join(runtimeDir, "broadcast.log");
      const hello = (await framesUntil(logPath, (f) => f.type === "session.hello", 10000, "session.hello"))
        .find((f) => f.type === "session.hello");
      ok(hello.mode === "safe-auto", "an unflagged daemon still comes up in safe-auto, got " + hello.mode);

      sendInput(runtimeDir, "engine", "add a health check note to the README");
      const frames = await framesUntil(logPath, (f) => f.type === "approval.request", 60000, "approval.request");
      const asked = frames.find((f) => f.type === "approval.request");
      ok(asked.tool === "run", "the default mode still parks the same write tool in an approval");

      kill(daemon);
      daemon = null;
    }

    // 3. --prompt: a first task with no client and no frame.
    {
      const stubPort = await freshStub();
      const workspace = seedWorkspace(path.join(workDir, "prompt", "repo"));
      const home = seedHome(path.join(workDir, "prompt", "home"));
      const runtimeDir = path.join(workDir, "prompt", "runtime");
      const port = await freePort();
      daemon = spawn(DAEMON, ["--mode", "full-auto", "--prompt", "add a health check note to the README"], {
        cwd: workspace,
        env: daemonEnv(home, stubPort, port, { JOULE_DAEMON_RUNTIME_DIR: runtimeDir }),
        stdio: ["ignore", fs.openSync(path.join(workDir, "prompt-daemon.log"), "w"), "ignore"],
      });
      ok(await waitForPort(port, 20000), "the daemon came up with --prompt");

      const logPath = path.join(runtimeDir, "broadcast.log");
      const frames = await framesUntil(logPath, (f) => f.type === "turn.end", 60000, "turn.end from --prompt");
      ok(frames.some((f) => f.type === "turn.start"), "the prompt started a turn with nothing attached to the daemon");
      ok(frames.filter((f) => f.type === "approval.request").length === 0, "the prompted turn asked nobody for approval");
      const readme = fs.readFileSync(path.join(workspace, "README.md"), "utf8");
      ok(readme.includes("Added a health check note."), "the prompted turn's write landed on disk");

      kill(daemon);
      daemon = null;
    }

    // 4. Input the flag refuses, refused the same way the terminal refuses it.
    {
      const stubPort = await freshStub();
      const workspace = seedWorkspace(path.join(workDir, "refused", "repo"));
      const home = seedHome(path.join(workDir, "refused", "home"));
      const port = await freePort();
      const env = daemonEnv(home, stubPort, port, {});

      const plan = await runToExit(["--mode", "plan"], env, workspace);
      ok(plan.code !== 0, "--mode plan exits non-zero, got " + plan.code);
      ok(plan.out.includes("plan"), "--mode plan says why, got " + JSON.stringify(plan.out.trim()));

      const unknown = await runToExit(["--mode", "yolo"], env, workspace);
      ok(unknown.code !== 0, "an unknown --mode exits non-zero, got " + unknown.code);
      ok(unknown.out.includes("unknown --mode yolo"), "an unknown --mode names what was wrong, got " + JSON.stringify(unknown.out.trim()));

      ok(derivedRuntimeArtifacts(home).length === 0, "a refused daemon truncated no broadcast log on its way out");

      const relative = await runToExit([], { ...env, JOULE_DAEMON_RUNTIME_DIR: "runtime/here" }, workspace);
      ok(relative.code !== 0, "a relative JOULE_DAEMON_RUNTIME_DIR exits non-zero, got " + relative.code);
      ok(relative.out.includes("absolute"), "a relative JOULE_DAEMON_RUNTIME_DIR says why, got " + JSON.stringify(relative.out.trim()));
    }

    if (failures.length === 0) {
      console.log("PASS: a daemon comes up in the mode its command line names, runs a task named there too, keeps its runtime directory where it is told, and refuses what the terminal refuses");
    }
  } finally {
    kill(daemon);
    for (const s of stubs) kill(s);
    if (failures.length === 0 && !process.env.DEBUG_KEEP) {
      fs.rmSync(workDir, { recursive: true, force: true });
    } else {
      console.error("workspace kept at " + workDir);
    }
  }

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exitCode = 1;
});
