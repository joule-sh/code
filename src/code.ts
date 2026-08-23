import { VERSION } from "./version.ts";
import { runDemo } from "./demo/demo.ts";
import { runTerminal } from "./terminal/terminal.ts";
import { runAttach, runDaemonJoule, runStop } from "./terminal/attach.ts";
import { ENSURE_COMMAND, hasEnsureCommand, runDaemonEnsure } from "./daemon/ensure_cli.ts";

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
} else if (hasEnsureCommand(currentArgs())) {
  runDaemonEnsure(currentArgs());
} else if (hasFlagIn(currentArgs(), "attach")) {
  runAttach(currentArgs());
} else if (!runDaemonJoule(currentArgs())) {
  runTerminal(currentArgs());
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
