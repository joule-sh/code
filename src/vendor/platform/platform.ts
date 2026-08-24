// @link ./platform_shim.o
declare function plat_env(name: string): string;
declare function plat_env_present(name: string): int;
declare function plat_chmod(path: string, mode: int): int;

export const WINDOWS: string = "win32";

export function isWindows(): bool {
  return process.platform() == WINDOWS;
}

// Every env read in this repo goes through here rather than `process.env`,
// which Lumen v0.7.2 cannot compile for a Windows target at all: its
// implementation walks a POSIX `environ` block, and naming the target is
// enough to fail the build. `getenv` behind the FFI is the same answer on
// both platforms, so this is not a Windows branch - it is the only reader.
export function envOr(name: string, fallback: string): string {
  if (plat_env_present(name) == 0) { return fallback; }
  return plat_env(name);
}

export function envPresent(name: string): bool {
  return plat_env_present(name) == 1;
}

// HOME first, because a Windows shell that sets it (Git Bash, MSYS, a login
// shell under WSL interop) means it deliberately, and USERPROFILE would
// contradict it. HOMEDRIVE+HOMEPATH is the last resort for a domain profile
// that has no USERPROFILE.
export function homeDir(): string {
  let home = envOr("HOME", "");
  if (home != "") { return home; }
  let profile = envOr("USERPROFILE", "");
  if (profile != "") { return profile; }
  let drive = envOr("HOMEDRIVE", "");
  let rest = envOr("HOMEPATH", "");
  if (drive != "" && rest != "") { return drive + rest; }
  return "";
}

// TMPDIR is what POSIX callers set and what this repo's harnesses set on
// every platform, so it wins; TEMP and TMP are what Windows itself sets.
export function tempDir(): string {
  let named = envOr("TMPDIR", "");
  if (named != "") { return named; }
  named = envOr("TEMP", "");
  if (named != "") { return named; }
  named = envOr("TMP", "");
  if (named != "") { return named; }
  return "/tmp";
}

export function pathListSeparator(): string {
  if (isWindows()) { return ";"; }
  return ":";
}

export function exeSuffix(): string {
  if (isWindows()) { return ".exe"; }
  return "";
}

// `fs.appendFileSync` is the other call Lumen v0.7.2 cannot generate code for
// on a Windows target. Open-for-append, write, close is the same operation
// spelled with three calls that do compile, and is what every mailbox writer
// in this repo now uses.
export function appendFile(filePath: string, text: string): void {
  let fd = fs.openSync(filePath, "a");
  fs.writeSync(fd, text);
  fs.closeSync(fd);
}

export const CHMOD_APPLIED: int = 0;
export const CHMOD_UNSUPPORTED: int = 1;
export const CHMOD_FAILED: int = -1;

// Returns which of the three happened rather than throwing, because on
// Windows "no mode was applied" is the normal outcome and not an error, while
// for a file holding a secret it is still worth saying out loud.
export function chmodPath(filePath: string, mode: int): int {
  return plat_chmod(filePath, mode);
}

export function shellProgram(): string {
  if (isWindows()) { return "cmd.exe"; }
  return "/bin/sh";
}

export function shellArgs(script: string): string[] {
  if (isWindows()) { return ["/c", script]; }
  return ["-c", script];
}

test("envOr returns the fallback for a name nothing has set", () => {
  expect(envOr("JOULE_PLATFORM_UNSET_PROBE_1", "fallback") == "fallback");
  expect(!envPresent("JOULE_PLATFORM_UNSET_PROBE_1"));
});

test("envOr reads a variable the process actually has", () => {
  expect(envPresent("PATH"));
  expect(envOr("PATH", "") != "");
});

test("homeDir finds a home on whatever platform the tests run on", () => {
  expect(homeDir() != "");
});

test("tempDir names a directory rather than an empty string", () => {
  expect(tempDir() != "");
});

test("the shell and its flag are chosen together", () => {
  let args = shellArgs("echo hi");
  expect(args.length == 2);
  expect(args[1] == "echo hi");
  if (isWindows()) {
    expect(shellProgram() == "cmd.exe");
    expect(args[0] == "/c");
    expect(pathListSeparator() == ";");
    expect(exeSuffix() == ".exe");
  } else {
    expect(shellProgram() == "/bin/sh");
    expect(args[0] == "-c");
    expect(pathListSeparator() == ":");
    expect(exeSuffix() == "");
  }
});

test("appendFile adds to a file rather than replacing it", () => {
  let p = tempDir() + "/joule-platform-append-test.log";
  if (fs.existsSync(p)) { fs.unlinkSync(p); }
  appendFile(p, "one\n");
  appendFile(p, "two\n");
  expect(fs.readFileSync(p) == "one\ntwo\n");
  fs.unlinkSync(p);
});

test("chmodPath reports applied on POSIX and unsupported on Windows", () => {
  let p = tempDir() + "/joule-platform-chmod-test.txt";
  fs.writeFileSync(p, "x");
  let outcome = chmodPath(p, 0o600);
  if (isWindows()) {
    expect(outcome == CHMOD_UNSUPPORTED);
  } else {
    expect(outcome == CHMOD_APPLIED);
  }
  fs.unlinkSync(p);
});
