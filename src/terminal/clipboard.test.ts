import { MACOS, COPY_TOOL, COPY_TERMINAL, COPY_NOWHERE, CopyPlan, chooseTool, copySelection, currentPlan, hasDisplay, isRemoteSession, needsDisplay, onPathNow, planText, toolCandidates, toolScript, writeThroughTool } from "./clipboard.ts";
import { WINDOWS, isWindows, tempDir } from "../vendor/platform/platform.ts";

function never(name: string): bool {
  return false;
}

function always(name: string): bool {
  return true;
}

function only(wanted: string): (name: string) => bool {
  return (name: string) => { return name == wanted; };
}

function plan(remote: bool, tool: string): CopyPlan {
  let made: CopyPlan = { remote: remote, tool: tool };
  return made;
}

test("a session is remote when either ssh variable carries anything", () => {
  expect(isRemoteSession("10.0.0.1 51000 10.0.0.2 22", ""));
  expect(isRemoteSession("", "/dev/pts/3"));
  expect(!isRemoteSession("", ""));
  expect(!isRemoteSession("  ", " "));
});

test("macOS and Windows always have a clipboard, an X11 or Wayland box only with a display", () => {
  expect(!needsDisplay(MACOS));
  expect(!needsDisplay(WINDOWS));
  expect(needsDisplay("linux"));
  expect(hasDisplay(":0", ""));
  expect(hasDisplay("", "wayland-0"));
  expect(!hasDisplay("", ""));
});

test("the candidate list is the platform's, and Wayland's own tool is tried first only under Wayland", () => {
  expect(toolCandidates(MACOS, "").length == 1);
  expect(toolCandidates(MACOS, "")[0] == "pbcopy");
  expect(toolCandidates(WINDOWS, "")[0] == "clip.exe");
  expect(toolCandidates("linux", "wayland-0")[0] == "wl-copy");
  expect(toolCandidates("linux", "")[0] == "xclip");
  expect(toolCandidates("linux", "")[1] == "xsel");
});

test("a missing tool is a normal answer rather than a failure, on every platform", () => {
  expect(chooseTool("linux", ":0", "", never) == "");
  expect(chooseTool(MACOS, "", "", never) == "");
  expect(chooseTool(WINDOWS, "", "", never) == "");
});

test("a headless box has no clipboard even with every tool installed", () => {
  expect(chooseTool("linux", "", "", always) == "");
  expect(chooseTool("linux", ":0", "", always) == "xclip");
  expect(chooseTool("linux", "", "wayland-0", always) == "wl-copy");
});

test("the second candidate is taken when the first is not installed", () => {
  expect(chooseTool("linux", ":0", "", only("xsel")) == "xsel");
  expect(chooseTool("linux", ":0", "", only("wl-copy")) == "wl-copy");
  expect(chooseTool("linux", ":0", "", only("pbcopy")) == "");
  expect(chooseTool(MACOS, "", "", only("pbcopy")) == "pbcopy");
});

test("every tool script names the handoff file quoted, and none of them is left in the foreground holding a pipe", () => {
  expect(toolScript("pbcopy", "/tmp/a b") == "pbcopy < '/tmp/a b'");
  expect(toolScript("xclip", "/tmp/x").indexOf("-selection clipboard") >= 0);
  expect(toolScript("xsel", "/tmp/x").indexOf("--clipboard --input") >= 0);
  expect(toolScript("xclip", "/tmp/x").endsWith(">/dev/null 2>&1"));
  expect(toolScript("xsel", "/tmp/x").endsWith(">/dev/null 2>&1"));
  expect(toolScript("wl-copy", "/tmp/x").endsWith(">/dev/null 2>&1"));
  expect(toolScript("clip.exe", "C:\\Temp\\x").indexOf("'C:\\Temp\\x'") >= 0);
  expect(toolScript("nothing-like-this", "/tmp/x") == "");
});

test("a handoff path carrying a quote cannot break out of the script it is put in", () => {
  expect(toolScript("pbcopy", "/tmp/it's") == "pbcopy < '/tmp/it'\\''s'");
  expect(toolScript("clip.exe", "C:\\it's").indexOf("'C:\\it''s'") >= 0);
});

test("the plan says which of the three things will happen, in a line an 80 column banner keeps whole", () => {
  expect(planText(plan(false, "pbcopy")).indexOf("pbcopy") >= 0);
  expect(planText(plan(false, "pbcopy")).indexOf("OSC 52") < 0);
  expect(planText(plan(true, "")).indexOf("ssh") >= 0);
  expect(planText(plan(true, "")).indexOf("OSC 52") >= 0);
  expect(planText(plan(false, "")).indexOf("OSC 52") >= 0);
  expect(planText(plan(false, "xclip")).length <= 78);
  expect(planText(plan(true, "")).length <= 78);
  expect(planText(plan(false, "")).length <= 78);
});

test("a remote session is never given the local machine's clipboard, however many tools it has", () => {
  let here = currentPlan();
  if (here.remote) { expect(here.tool == ""); }
  expect(here.tool == "" || !here.remote);
});

test("onPathNow finds a command every machine running these tests has, and invents none", () => {
  if (isWindows()) {
    expect(onPathNow("cmd.exe"));
  } else {
    expect(onPathNow("sh") || onPathNow("env"));
  }
  expect(!onPathNow("joule-clipboard-command-that-does-not-exist"));
});

test("a tool the platform has no script for is refused before anything is written", () => {
  expect(!writeThroughTool("joule-clipboard-command-that-does-not-exist", "text"));
});

test("a tool that is not installed reports failure and takes its handoff file with it", () => {
  if (!isWindows() && !onPathNow("xsel")) {
    expect(!writeThroughTool("xsel", "text"));
    let left = fs.readdirSync(tempDir());
    let i = 0;
    while (i < left.length) {
      expect(left[i].indexOf("joule-clip-") != 0);
      i = i + 1;
    }
  }
});

test("an empty selection reaches no clipboard and is not reported as one", () => {
  expect(copySelection("") == COPY_NOWHERE);
  expect(COPY_TOOL != COPY_TERMINAL);
  expect(COPY_TERMINAL != COPY_NOWHERE);
});
