import { spawn, execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
import { assertTabSurvivesRestart } from "./restart_check.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const JOULE = path.join(REPO_ROOT, "bin", "joule");
const STUB = path.join(REPO_ROOT, "bin", "stub_model");
const EXTENSION = path.join(REPO_ROOT, "editor");
const SUITE = path.join(HERE, "suite.js");
const CACHE = process.env.JOULE_VSCODE_CACHE || path.join(os.homedir(), ".cache", "joule-editor-window");
const VSCODE_VERSION = "1.134.0";
const OLDER_VSCODE_VERSION = "1.105.1";
const DOWNLOAD_IDLE_MS = 120000;
const ALL_SCENARIOS = [
  { name: "startup-icon", version: VSCODE_VERSION },
  { name: "first-run", version: VSCODE_VERSION },
  { name: "conversation", version: VSCODE_VERSION },
  { name: "transcript", version: VSCODE_VERSION },
  { name: "close-mid-turn", version: VSCODE_VERSION },
  { name: "second-client", version: VSCODE_VERSION },
  { name: "placement", version: OLDER_VSCODE_VERSION },
  { name: "startup-icon", version: OLDER_VSCODE_VERSION },
  { name: "editor-tab", version: VSCODE_VERSION },
  { name: "editor-tab", version: OLDER_VSCODE_VERSION },
];
const ASKED_FOR = (process.env.JOULE_EDITOR_SCENARIOS || "").split(",").map((s) => s.trim()).filter((s) => s !== "");
const SCENARIOS = ASKED_FOR.length === 0
  ? ALL_SCENARIOS
  : ALL_SCENARIOS.filter((s) => ASKED_FOR.includes(s.name));

const teardown = [];
let failed = false;
let display = null;

function note(line) {
  console.log("editor-window: " + line);
}

function die(message) {
  console.error("editor-window: " + message);
  failed = true;
  process.exitCode = 1;
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

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection(port, "127.0.0.1");
    sock.once("connect", () => { sock.end(); resolve(true); });
    sock.once("error", () => resolve(false));
  });
}

async function startDisplay() {
  if (process.platform !== "linux" || process.env.DISPLAY) { return null; }
  for (let n = 90; n < 140; n++) {
    if (fs.existsSync("/tmp/.X" + n + "-lock")) { continue; }
    const child = spawn("Xvfb", [":" + n, "-screen", "0", "1280x900x24", "-nolisten", "tcp"], { stdio: "ignore" });
    let broken = false;
    child.on("error", (e) => {
      broken = true;
      if (e.code === "ENOENT") {
        die("Xvfb is not installed. A real editor window needs a display: install xvfb, or run with DISPLAY set.");
      }
    });
    for (let i = 0; i < 200 && !broken; i++) {
      if (fs.existsSync("/tmp/.X11-unix/X" + n)) {
        note("Xvfb is serving :" + n + " (pid " + child.pid + ")");
        teardown.push(() => { try { child.kill("SIGTERM"); } catch (e) { void e; } });
        return ":" + n;
      }
      await sleep(50);
    }
    try { child.kill("SIGKILL"); } catch (e) { void e; }
    if (broken) { return null; }
  }
  die("could not start an Xvfb display for the editor window");
  return null;
}

function makeRoot(scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "joule-editor-" + scenario + "-"));
  const dirs = {
    root,
    workspace: path.join(root, "workspace"),
    home: path.join(root, "home"),
    tmp: path.join(root, "tmp"),
    userData: path.join(root, "user-data"),
    extensions: path.join(root, "extensions"),
  };
  for (const dir of [dirs.workspace, dirs.home, dirs.tmp, dirs.userData, dirs.extensions]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(dirs.workspace, ".vscode"), { recursive: true });
  fs.writeFileSync(path.join(dirs.workspace, "README.md"), "# demo\n");
  fs.writeFileSync(
    path.join(dirs.workspace, ".vscode", "settings.json"),
    JSON.stringify({ "joule.path": JOULE, "joule.attachOnStartup": false }, null, 2) + "\n",
  );
  const theme = (process.env.JOULE_EDITOR_THEME || "").trim();
  if (theme !== "") {
    fs.mkdirSync(path.join(dirs.userData, "User"), { recursive: true });
    fs.writeFileSync(
      path.join(dirs.userData, "User", "settings.json"),
      JSON.stringify({ "workbench.colorTheme": theme }, null, 2) + "\n",
    );
  }
  return dirs;
}

function daemonRecords(home) {
  try {
    return fs.readdirSync(path.join(home, ".config", "joule-code", "daemon")).filter((f) => f.endsWith(".json"));
  } catch (e) {
    void e;
    return [];
  }
}

function killRecordedStubs(root) {
  const file = path.join(root, "stub.pids");
  if (!fs.existsSync(file)) { return; }
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const pid = Number(line.trim());
    if (!Number.isInteger(pid) || pid <= 0) { continue; }
    try { process.kill(pid, "SIGKILL"); } catch (e) { void e; }
  }
}

function reap(dirs, env) {
  killRecordedStubs(dirs.root);
  try {
    execFileSync(JOULE, ["--stop"], { cwd: dirs.workspace, env, timeout: 60000, stdio: "pipe" });
  } catch (e) {
    void e;
  }
}

function printSuiteLog(root) {
  const file = path.join(root, "suite.log");
  if (!fs.existsSync(file)) {
    note("the suite left no log, so it never reached its first assertion");
    return 0;
  }
  const text = fs.readFileSync(file, "utf8");
  process.stdout.write(text);
  return text.split("\n").filter((line) => line.startsWith("ok: ") || line.startsWith("FAIL")).length;
}

async function runScenario({ name: scenario, version }) {
  const dirs = makeRoot(scenario);
  const stubPort = await freePort();
  const env = {
    ...process.env,
    HOME: dirs.home,
    TMPDIR: dirs.tmp,
    JOULE_CODE_BASE_URL: "http://127.0.0.1:" + stubPort,
    JOULE_CODE_MODEL: "stub-model",
    JOULE_CODE_API_KEY: "test-key",
    JOULE_EDITOR_TEST_SCENARIO: scenario,
    JOULE_EDITOR_TEST_ROOT: dirs.root,
    JOULE_EDITOR_TEST_WORKSPACE: dirs.workspace,
    JOULE_EDITOR_TEST_STUB: STUB,
    JOULE_EDITOR_TEST_STUB_PORT: String(stubPort),
    E2E_STUB_SCRIPT: scenario === "transcript" ? "transcript" : "",
  };
  if (display !== null) { env.DISPLAY = display; }
  if (scenario === "first-run") {
    delete env.JOULE_CODE_BASE_URL;
    delete env.JOULE_CODE_MODEL;
    delete env.JOULE_CODE_API_KEY;
  }

  const cleanup = () => {
    reap(dirs, env);
    if (process.env.DEBUG_KEEP) {
      note("DEBUG_KEEP is set, leaving " + dirs.root);
      return;
    }
    fs.rmSync(dirs.root, { recursive: true, force: true });
  };
  teardown.push(cleanup);

  note("scenario " + scenario + " in " + dirs.workspace + ", stub model on :" + stubPort
    + ", VS Code " + version + " from " + CACHE);

  let launchFailure = null;
  try {
    await runTests({
      version,
      cachePath: CACHE,
      timeout: DOWNLOAD_IDLE_MS,
      extensionDevelopmentPath: EXTENSION,
      extensionTestsPath: SUITE,
      extensionTestsEnv: env,
      launchArgs: [
        dirs.workspace,
        "--user-data-dir", dirs.userData,
        "--extensions-dir", dirs.extensions,
        "--disable-workspace-trust",
        "--disable-gpu",
        "--disable-updates",
        "--no-sandbox",
        "--skip-welcome",
        "--skip-release-notes",
      ],
    });
  } catch (e) {
    launchFailure = e;
  }

  const asserted = printSuiteLog(dirs.root);
  if (launchFailure !== null) {
    die(scenario + ": the editor window run failed: " + (launchFailure.message || launchFailure));
  } else if (asserted === 0) {
    die(scenario + ": the editor window opened and closed again without the suite asserting anything,"
      + " so this scenario proved nothing");
  }

  reap(dirs, env);

  let left = daemonRecords(dirs.home);
  for (let i = 0; i < 100 && left.length > 0; i++) {
    await sleep(100);
    left = daemonRecords(dirs.home);
  }
  if (left.length > 0) {
    die(scenario + ": the run left " + left.length + " daemon record(s) behind: " + left.join(", "));
  } else {
    note(scenario + ": no daemon record survived the run");
  }

  if (!failed && scenario === "editor-tab") {
    await assertTabSurvivesRestart({ version, cache: CACHE, joule: JOULE, note, die, display });
  }

  if (await portOpen(stubPort)) {
    die(scenario + ": something is still listening on the stub model port " + stubPort);
  }
}

async function main() {
  for (const bin of [JOULE, STUB]) {
    if (!fs.existsSync(bin)) {
      die("missing " + bin + " - run `make build bin/stub_model` first");
      return;
    }
  }

  display = await startDisplay();
  if (failed) { return; }

  for (const scenario of SCENARIOS) {
    await runScenario(scenario);
    await sleep(3000);
  }

  if (!failed) {
    note("PASS: a real editor window showed an unconfigured person the first-run screen, opened the panel, ran a turn,"
      + " drove the approval mode from the composer, approved a tool from the webview onto disk, painted a tool call as"
      + " a fact with its output collapsed behind one line and its escape codes as colour, painted a mode and a"
      + " prompt a second client on the same session produced, learned that session's state when it attached to it"
      + " afterwards, painted nothing of a previous session in the same folder, left no daemon behind,"
      + " and both pinned editors showed the joule icon in the activity bar at startup"
      + " without the view ever being opened, and opened the session in an editor tab without being asked,"
      + " beside the open file and without taking focus from it");
  }
}

function runTeardown() {
  while (teardown.length > 0) {
    const fn = teardown.pop();
    try { fn(); } catch (e) { void e; }
  }
}

process.on("exit", runTeardown);
process.on("SIGINT", () => { runTeardown(); process.exit(130); });
process.on("SIGTERM", () => { runTeardown(); process.exit(143); });

main().then(runTeardown).catch((e) => {
  console.error("editor-window:", e);
  process.exitCode = 1;
  runTeardown();
});
