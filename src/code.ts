import { VERSION } from "./version.ts";

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
} else {
  console.log("joule: v0 skeleton, run with --version");
}

test("hasFlagIn finds --version among other args", () => {
  expect(hasFlagIn(["prog", "--version"], "--version"));
  expect(hasFlagIn(["prog", "foo", "--version"], "--version"));
});

test("hasFlagIn is false when the flag is absent", () => {
  expect(!hasFlagIn(["prog"], "--version"));
  expect(!hasFlagIn(["prog", "foo"], "--version"));
});
