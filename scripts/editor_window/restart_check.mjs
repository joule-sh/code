import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "../scratch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const PACKAGER = path.join(REPO_ROOT, "scripts", "package_editor.mjs");
const VSIX = path.join(REPO_ROOT, "dist", "joule-editor-0.0.0.vsix");
const INPUT_MARK = "mainThreadWebview-joule.session";
const SETTLE_MS = 45000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function codeBin(cache, version) {
  return path.join(cache, "vscode-linux-x64-" + version, "bin", "code");
}

function makeProfile(joule, openInEditorTab) {
  const root = scratchDir("joule-tab-restart-");
  const dirs = {
    root,
    workspace: path.join(root, "workspace"),
    userData: path.join(root, "user-data"),
    extensions: path.join(root, "extensions"),
  };
  for (const dir of [dirs.workspace, dirs.userData, dirs.extensions]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(dirs.workspace, ".vscode"), { recursive: true });
  fs.writeFileSync(path.join(dirs.workspace, "README.md"), "# demo\n");
  writeSetting(dirs, joule, openInEditorTab);
  return dirs;
}

function writeSetting(dirs, joule, openInEditorTab) {
  const settings = { "joule.path": joule, "joule.attachOnStartup": false };
  if (openInEditorTab !== null) { settings["joule.openInEditorTab"] = openInEditorTab; }
  fs.writeFileSync(
    path.join(dirs.workspace, ".vscode", "settings.json"),
    JSON.stringify(settings, null, 2) + "\n",
  );
}

function packaged(note) {
  if (fs.existsSync(VSIX)) { return true; }
  note("packaging the extension so the restart runs against an installed build, not a source folder");
  const built = spawnSync(process.execPath, [PACKAGER], { cwd: REPO_ROOT, stdio: "pipe" });
  return built.status === 0 && fs.existsSync(VSIX);
}

function install(cache, version, dirs) {
  execFileSync(codeBin(cache, version), [
    "--user-data-dir", dirs.userData,
    "--extensions-dir", dirs.extensions,
    "--no-sandbox",
    "--install-extension", VSIX,
    "--force",
  ], { stdio: "pipe", timeout: 180000 });
}

function launch(cache, version, dirs, display) {
  const env = Object.assign({}, process.env);
  if (display !== null) { env.DISPLAY = display; }
  return spawn(codeBin(cache, version), [
    dirs.workspace,
    "--user-data-dir", dirs.userData,
    "--extensions-dir", dirs.extensions,
    "--disable-workspace-trust",
    "--disable-gpu",
    "--disable-updates",
    "--no-sandbox",
    "--skip-welcome",
    "--skip-release-notes",
  ], { env, stdio: "ignore", detached: true });
}

function livePids(dirs) {
  const out = spawnSync("pgrep", ["-f", dirs.userData], { encoding: "utf8" });
  return (out.stdout || "").split("\n").map((l) => Number(l.trim())).filter((n) => Number.isInteger(n) && n > 0);
}

function mainPids(dirs) {
  return livePids(dirs).filter((pid) => {
    try {
      return !fs.readFileSync("/proc/" + pid + "/cmdline", "utf8").includes("--type=");
    } catch (e) {
      void e;
      return false;
    }
  });
}

async function quitGracefully(dirs) {
  for (const pid of mainPids(dirs)) {
    try { process.kill(pid, "SIGTERM"); } catch (e) { void e; }
  }
  for (let i = 0; i < 120 && livePids(dirs).length > 0; i++) { await sleep(1000); }
  return livePids(dirs).length === 0;
}

function stateHoldsTheTab(dirs) {
  const storage = path.join(dirs.userData, "User", "workspaceStorage");
  if (!fs.existsSync(storage)) { return false; }
  for (const entry of fs.readdirSync(storage)) {
    const db = path.join(storage, entry, "state.vscdb");
    if (!fs.existsSync(db)) { continue; }
    if (fs.readFileSync(db).includes(INPUT_MARK)) { return true; }
  }
  return false;
}

async function openThenQuit(kit, dirs, label) {
  const child = launch(kit.cache, kit.version, dirs, kit.display);
  child.unref();
  await sleep(SETTLE_MS);
  const quiet = await quitGracefully(dirs);
  kit.note("restart check: " + label + " closed cleanly: " + quiet);
  return quiet;
}

function scrub(dirs) {
  for (const pid of livePids(dirs)) {
    try { process.kill(pid, "SIGKILL"); } catch (e) { void e; }
  }
  fs.rmSync(dirs.root, { recursive: true, force: true });
}

export async function assertTabSurvivesRestart(kit) {
  const { note, die, version } = kit;
  if (!packaged(note)) {
    die("restart check: the extension could not be packaged, so nothing was installed to restart");
    return;
  }

  const asked = makeProfile(kit.joule, null);
  const control = makeProfile(kit.joule, false);
  try {
    note("restart check: VS Code " + version + ", installed from " + path.basename(VSIX));
    install(kit.cache, version, asked);
    install(kit.cache, version, control);

    await openThenQuit(kit, asked, "a window that set the tab setting nowhere");
    if (!stateHoldsTheTab(asked)) {
      die("restart check: an installed extension left to its own default opened no session tab, so the tab"
        + " is not the placement a window opens in");
      return;
    }
    note("restart check: the default opened the session tab in an installed build, and the editor saved it"
      + " as an editor of the workspace");

    await openThenQuit(kit, control, "a window that turned the setting off");
    if (stateHoldsTheTab(control)) {
      die("restart check: a window with the setting off opened a tab anyway, so the setting no longer turns"
        + " the default off and the check cannot tell a restored tab from a fresh one");
      return;
    }
    note("restart check: turning the setting off leaves the editor area alone, so the mark means what it says");

    writeSetting(asked, kit.joule, false);
    await openThenQuit(kit, asked, "the same profile reopened with the setting turned off");
    if (!stateHoldsTheTab(asked)) {
      die("restart check: reopening the profile lost the session tab, so it did not survive the restart");
      return;
    }
    note("restart check: the tab was still open in a window that did nothing to open it, so the editor"
      + " restored it across the restart");
  } catch (e) {
    die("restart check: " + (e && e.message ? e.message : e));
  } finally {
    scrub(asked);
    scrub(control);
  }
}
