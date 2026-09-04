import { VERSION } from "./version.ts";
import { runDemo } from "./demo/demo.ts";
import { runTerminal } from "./terminal/terminal.ts";
import { runAttach, runDaemonJoule, runDaemonJouleFor, runStop } from "./terminal/attach.ts";
import { ENSURE_COMMAND, hasEnsureCommand, runDaemonEnsure } from "./daemon/ensure_cli.ts";
import { cleanScratch } from "./session/scratch.ts";
import { workspaceRoot } from "./vendor/platform/platform.ts";

function hasFlagIn(argv: string[], name: string): bool {
  for (const a of argv) {
    if (a == name) {
      return true;
    }
  }
  return false;
}

function currentArgs(): string[] {
  let result: string[] = [];
  let i = 0;
  while (i < argsCount()) {
    result.push(arg(i));
    i = i + 1;
  }
  return result;
}

if (hasFlagIn(currentArgs(), "--version")) {
  console.log("joule " + VERSION);
} else if (hasFlagIn(currentArgs(), "--demo")) {
  runDemo();
} else if (hasFlagIn(currentArgs(), "--stop")) {
  runStop(currentArgs());
} else if (hasFlagIn(currentArgs(), "--clean-scratch")) {
  if (cleanScratch(workspaceRoot())) {
    console.log("joule: removed this workspace's scratch directory.");
  } else {
    console.log("joule: no scratch directory to remove for this workspace.");
  }
} else if (hasEnsureCommand(currentArgs())) {
  runDaemonEnsure(currentArgs());
} else if (hasFlagIn(currentArgs(), "attach")) {
  runAttach(currentArgs());
} else {
  let attempt = runDaemonJoule(currentArgs());
  if (!attempt.attached) {
    let target = runTerminal(currentArgs(), attempt.notes);
    if (target != "") {
      let moved = runDaemonJouleFor(currentArgs(), target);
      if (!moved.attached) {
        for (const n of moved.notes) { console.log(n); }
      }
    }
  }
}

test("hasFlagIn finds --version among other args", () => {
  expect(hasFlagIn(["prog", "--version"], "--version"));
  expect(hasFlagIn(["prog", "foo", "--version"], "--version"));
});

test("hasFlagIn is false when the flag is absent", () => {
  expect(!hasFlagIn(["prog"], "--version"));
  expect(!hasFlagIn(["prog", "foo"], "--version"));
});

test("hasFlagIn finds attach among other args", () => {
  expect(hasFlagIn(["prog", "attach"], "attach"));
  expect(!hasFlagIn(["prog"], "attach"));
});

test("the daemon-ensure subcommand is recognised and is not confused with attach", () => {
  expect(hasEnsureCommand(["joule", ENSURE_COMMAND]));
  expect(!hasFlagIn([ENSURE_COMMAND], "attach"));
});
