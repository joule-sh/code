import { daemonStartup, runtimeDirChoice, RUNTIME_DIR_ENV } from "./startup.ts";
import { MODE_SAFE_AUTO, MODE_FULL_AUTO, MODE_READ_ONLY } from "../approval/gate.ts";
import { daemonRuntimeDir } from "./paths.ts";

test("a daemon given no flags comes up in safe-auto, exactly as it did when that was hardcoded", () => {
  let s = daemonStartup(["joule-daemon"]);
  expect(s.mode == MODE_SAFE_AUTO);
  expect(s.prompt == "");
  expect(s.error == "");
});

test("--mode full-auto is what an unattended daemon comes up in", () => {
  let s = daemonStartup(["joule-daemon", "--mode", "full-auto"]);
  expect(s.mode == MODE_FULL_AUTO);
  expect(s.error == "");
});

test("a mode other than full-auto is honoured too, not special-cased", () => {
  let s = daemonStartup(["joule-daemon", "--mode", "read-only"]);
  expect(s.mode == MODE_READ_ONLY);
  expect(s.error == "");
});

test("plan is refused with the same explanation the terminal gives, not silently downgraded", () => {
  let s = daemonStartup(["joule-daemon", "--mode", "plan"]);
  expect(s.error.indexOf("plan") >= 0);
  expect(s.mode == MODE_SAFE_AUTO);
});

test("an unknown mode is refused rather than started in", () => {
  let s = daemonStartup(["joule-daemon", "--mode", "yolo"]);
  expect(s.error.indexOf("unknown --mode yolo") >= 0);
});

test("a refused mode carries no prompt either, so a bad line starts nothing", () => {
  let s = daemonStartup(["joule-daemon", "--mode", "yolo", "--prompt", "do the thing"]);
  expect(s.error != "");
  expect(s.prompt == "");
});

test("--prompt is read alongside the mode, so a first task can arrive without a frame", () => {
  let s = daemonStartup(["joule-daemon", "--mode", "full-auto", "--prompt", "add a health route"]);
  expect(s.mode == MODE_FULL_AUTO);
  expect(s.prompt == "add a health route");
});

test("an unset runtime directory override leaves the derived path alone", () => {
  let c = runtimeDirChoice("", "/repo", "");
  expect(c.error == "");
  expect(c.dir == daemonRuntimeDir("/repo", ""));
});

test("a whitespace-only override counts as unset rather than as a directory named by spaces", () => {
  let c = runtimeDirChoice("   ", "/repo", "");
  expect(c.error == "");
  expect(c.dir == daemonRuntimeDir("/repo", ""));
});

test("an absolute override is used verbatim, with no key appended to it", () => {
  let c = runtimeDirChoice("/var/run/joule-env", "/repo", "");
  expect(c.error == "");
  expect(c.dir == "/var/run/joule-env");
});

test("the override wins over the session name, which no longer keys anything", () => {
  let c = runtimeDirChoice("/var/run/joule-env", "/repo", "review");
  expect(c.dir == "/var/run/joule-env");
});

test("a relative override is refused, because two processes would resolve it to two directories", () => {
  let c = runtimeDirChoice("runtime/here", "/repo", "");
  expect(c.dir == "");
  expect(c.error.indexOf(RUNTIME_DIR_ENV) >= 0);
  expect(c.error.indexOf("absolute") >= 0);
});
