// @link ./platform_shim.o
declare function plat_env(name: string): string;
declare function plat_env_present(name: string): int;
declare function plat_append(path: string, text: string): int;
declare function plat_chmod(path: string, mode: int): int;
declare function plat_gc_interior_pointers(): int;
declare function plat_port_open(host: string, port: int): int;

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
// on a Windows target, and the obvious replacement is a trap: openSync(p, "a")
// writes from offset zero rather than appending, so a mailbox with several
// writers loses everything but the last record. The shim uses O_APPEND and
// FILE_APPEND_DATA, which is the guarantee appendFileSync had.
export function appendFile(filePath: string, text: string): void {
  plat_append(filePath, text);
}

export const GC_INTERIOR_POINTERS_NOT_APPLICABLE: int = -1;

export function gcInteriorPointers(): int {
  return plat_gc_interior_pointers();
}

export const PORT_CLOSED: int = 0;
export const PORT_OPEN: int = 1;
export const PORT_UNKNOWN: int = -1;

export function portOpen(host: string, port: int): int {
  return plat_port_open(host, port);
}

export function worthConnectingTo(host: string, port: int): bool {
  return portOpen(host, port) != PORT_CLOSED;
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

// PowerShell rather than cmd.exe, for a reason that is about argument passing
// and not about taste. Lumen builds a child's command line from the array by
// the C runtime's rules, which escape an embedded quote as \" - correct for
// every program that parses its own argv that way, and meaningless to cmd.exe,
// which sees the backslash. So a cmd.exe script carrying any quote at all
// arrives corrupted, and a workspace path with a space cannot be passed at
// all. PowerShell parses its arguments by the same rules Lumen writes them
// with, so the script survives; that its aliases cover ls, cat, rm and echo is
// a bonus rather than the argument.
export function shellProgram(): string {
  if (isWindows()) { return "powershell.exe"; }
  return "/bin/sh";
}

export function shellArgs(script: string): string[] {
  if (isWindows()) { return ["-NoProfile", "-NonInteractive", "-Command", script]; }
  return ["-c", script];
}

test("a Windows build collects with interior pointers on, which is what keeps a retained line alive", () => {
  if (isWindows()) {
    expect(gcInteriorPointers() == 1);
  } else {
    expect(gcInteriorPointers() == GC_INTERIOR_POINTERS_NOT_APPLICABLE);
  }
});

test("the port probe answers open, closed, or that the platform has nothing to say", () => {
  let answer = portOpen("127.0.0.1", 8422);
  expect(answer == PORT_OPEN || answer == PORT_CLOSED || answer == PORT_UNKNOWN);
  if (!isWindows()) { expect(answer == PORT_UNKNOWN); }
  expect(worthConnectingTo("127.0.0.1", 8422) == (answer != PORT_CLOSED));
});

test("a port worth connecting to is anything the probe did not call closed, so POSIX always tries", () => {
  if (!isWindows()) { expect(worthConnectingTo("127.0.0.1", 8422)); }
  expect(portOpen("not-an-address", 8422) == PORT_UNKNOWN);
  expect(portOpen("127.0.0.1", 0) == PORT_UNKNOWN);
});

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
  expect(args[args.length - 1] == "echo hi");
  if (isWindows()) {
    expect(shellProgram() == "powershell.exe");
    expect(args[0] == "-NoProfile");
    expect(pathListSeparator() == ";");
    expect(exeSuffix() == ".exe");
  } else {
    expect(shellProgram() == "/bin/sh");
    expect(args[0] == "-c");
    expect(pathListSeparator() == ":");
    expect(exeSuffix() == "");
  }
});

test("appendFile keeps every record across reopens, rather than the last one", () => {
  let p = tempDir() + "/joule-platform-append-test.log";
  if (fs.existsSync(p)) { fs.unlinkSync(p); }
  appendFile(p, "one\n");
  appendFile(p, "two\n");
  appendFile(p, "three\n");
  expect(fs.readFileSync(p) == "one\ntwo\nthree\n");
  fs.unlinkSync(p);
});

test("appendFile creates the file when it is not there yet", () => {
  let p = tempDir() + "/joule-platform-append-create.log";
  if (fs.existsSync(p)) { fs.unlinkSync(p); }
  appendFile(p, "first\n");
  expect(fs.readFileSync(p) == "first\n");
  fs.unlinkSync(p);
});

test("chmodPath reports applied on POSIX and unsupported on Windows", () => {
  let p = tempDir() + "/joule-platform-chmod-test.txt";
  fs.writeFileSync(p, "x");
  let outcome = chmodPath(p, 0o600);
  expect(outcome != CHMOD_FAILED);
  if (isWindows()) {
    expect(outcome == CHMOD_UNSUPPORTED);
  } else {
    expect(outcome == CHMOD_APPLIED);
  }
  fs.unlinkSync(p);
});
