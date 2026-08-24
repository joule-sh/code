import { runInstallOnceWith, verifyDownloadedJoule, ensureCodeSignature, refusalReason, putInPlaceError, versionDirPath, tmpRootPath, binLinkPath, parseLatestTag, CODESIGN, RESULT_INSTALLED, RESULT_UP_TO_DATE, RESULT_ERROR, ShellResult, FetchTagResult } from "./installer.ts";
import { MIN_BINARY_BYTES } from "./archive.ts";
import { PLATFORM_LINUX_X64, PLATFORM_MACOS_ARM64 } from "./platform.ts";

const TARGET: string = PLATFORM_LINUX_X64;
const ELF_MAGIC: string = String.fromCharCode(0x7f) + String.fromCharCode(0x45) + String.fromCharCode(0x4c) + String.fromCharCode(0x46);
const MACH_O_MAGIC: string = String.fromCharCode(0xcf) + String.fromCharCode(0xfa) + String.fromCharCode(0xed) + String.fromCharCode(0xfe);
const MACOS_TARGET: string = PLATFORM_MACOS_ARM64;

function padding(n: int): string {
  let out = "x";
  while (out.length < n) { out = out + out; }
  return out.slice(0, n);
}

function validJouleBytes(): string {
  return ELF_MAGIC + padding(MIN_BINARY_BYTES);
}

function validMachOBytes(): string {
  return MACH_O_MAGIC + padding(MIN_BINARY_BYTES);
}

function freshDir(name: string): string {
  let root = "/tmp/installer-test-" + name;
  if (fs.existsSync(root)) { fs.rmSync(root, true); }
  fs.mkdirSync(root, true);
  return root;
}

function ok(tag: string): () => FetchTagResult {
  return () => {
    let r: FetchTagResult = { ok: true, tag: tag, error: "" };
    return r;
  };
}

function fetchFails(msg: string): () => FetchTagResult {
  return () => {
    let r: FetchTagResult = { ok: false, tag: "", error: msg };
    return r;
  };
}

function shell(status: int, stdout: string, stderr: string): ShellResult {
  let r: ShellResult = { status: status, stdout: stdout, stderr: stderr };
  return r;
}

function lastArg(args: string[]): string {
  return args[args.length - 1];
}

class Counter {
  n: int;
  constructor() { this.n = 0; }
  inc(): void { this.n = this.n + 1; }
}

function baseHappyRun(reportedVersion: string): (cmd: string, args: string[]) => ShellResult {
  return (cmd: string, args: string[]) => {
    if (cmd == "curl") {
      fs.writeFileSync(lastArg(args), "fake-archive-bytes");
      return shell(0, "", "");
    }
    if (cmd == "tar" && args[0] == "-tzf") {
      return shell(0, "code-" + TARGET + "/joule\ncode-" + TARGET + "/relay\ncode-" + TARGET + "/joule-daemon\n", "");
    }
    if (cmd == "tar" && args[0] == "-xzf") {
      let innerDir = lastArg(args) + "/code-" + TARGET;
      fs.mkdirSync(innerDir, true);
      fs.writeFileSync(innerDir + "/joule", validJouleBytes());
      fs.writeFileSync(innerDir + "/relay", "fake-relay-binary");
      fs.writeFileSync(innerDir + "/joule-daemon", "fake-daemon-binary");
      return shell(0, "", "");
    }
    return shell(0, "joule " + reportedVersion + "\n", "");
  };
}

test("a dev build declines immediately, before ever checking the network", () => {
  let calls = new Counter();
  let fetchTag = () => { calls.inc(); return ok("v9.9.9")(); };
  let result = runInstallOnceWith("dev", "/tmp/installer-test-devguard", "/tmp/installer-test-devguard-bin", "linux", "x64", fetchTag, baseHappyRun("9.9.9"));
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("source build") >= 0);
  expect(calls.n == 0);
});

test("an unsupported platform declines cleanly and names itself", () => {
  let result = runInstallOnceWith("0.1.0", "/tmp/installer-test-unsup", "/tmp/installer-test-unsup-bin", "win32", "x64", ok("v9.9.9"), baseHappyRun("9.9.9"));
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("win32-x64") >= 0);
});

test("an unreachable GitHub API surfaces its error rather than crashing or guessing", () => {
  let result = runInstallOnceWith("0.1.0", "/tmp/installer-test-neterr", "/tmp/installer-test-neterr-bin", "linux", "x64", fetchFails("GitHub returned status 0 while checking the latest release"), baseHappyRun("9.9.9"));
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("GitHub") >= 0);
});

test("an already-current version reports up to date without touching the filesystem", () => {
  let root = freshDir("uptodate");
  let bin = freshDir("uptodate-bin");
  let calls = new Counter();
  let runCmd = (cmd: string, args: string[]) => { calls.inc(); return shell(0, "", ""); };
  let result = runInstallOnceWith("0.6.1", root, bin, "linux", "x64", ok("v0.6.1"), runCmd);
  expect(result.kind == RESULT_UP_TO_DATE);
  expect(result.fromVersion == "0.6.1");
  expect(calls.n == 0);
});

test("a full successful install lands the new version alongside the old one and repoints the symlinks", () => {
  let root = freshDir("happy-root");
  let bin = freshDir("happy-bin");
  let oldVersionDir = root + "/0.6.1";
  fs.mkdirSync(oldVersionDir, true);
  fs.writeFileSync(oldVersionDir + "/joule", validJouleBytes());
  fs.symlinkSync(oldVersionDir + "/joule", bin + "/joule");

  let result = runInstallOnceWith("0.6.1", root, bin, "linux", "x64", ok("v0.6.2"), baseHappyRun("0.6.2"));

  expect(result.kind == RESULT_INSTALLED);
  expect(result.fromVersion == "0.6.1");
  expect(result.toVersion == "0.6.2");
  expect(fs.existsSync(root + "/0.6.2/joule"));
  expect(fs.existsSync(root + "/0.6.2/relay"));
  expect(fs.existsSync(root + "/0.6.2/joule-daemon"));
  expect(fs.existsSync(oldVersionDir + "/joule"));
  expect(fs.readlinkSync(bin + "/joule") == root + "/0.6.2/joule");
  expect(fs.readlinkSync(bin + "/relay") == root + "/0.6.2/relay");
  let leftovers = fs.readdirSync(root);
  let i = 0;
  let sawTmp = false;
  while (i < leftovers.length) {
    if (leftovers[i].startsWith(".update-tmp-")) { sawTmp = true; }
    i = i + 1;
  }
  expect(!sawTmp);
});

test("a stale scratch directory from a previously killed attempt is swept before a new install starts", () => {
  let root = freshDir("stale-sweep");
  let bin = freshDir("stale-sweep-bin");
  fs.mkdirSync(root + "/.update-tmp-1111", true);
  fs.writeFileSync(root + "/.update-tmp-1111/leftover.tar.gz", "junk");

  let result = runInstallOnceWith("0.1.0", root, bin, "linux", "x64", ok("v0.2.0"), baseHappyRun("0.2.0"));

  expect(result.kind == RESULT_INSTALLED);
  expect(!fs.existsSync(root + "/.update-tmp-1111"));
});

test("a curl failure leaves nothing behind and reports the exit code", () => {
  let root = freshDir("curlfail");
  let bin = freshDir("curlfail-bin");
  let runCmd = (cmd: string, args: string[]) => {
    if (cmd == "curl") { return shell(6, "", "curl: (6) Could not resolve host"); }
    return shell(0, "", "");
  };
  let result = runInstallOnceWith("0.1.0", root, bin, "linux", "x64", ok("v0.2.0"), runCmd);
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("download failed") >= 0);
  expect(!fs.existsSync(bin + "/joule"));
  let leftovers = fs.readdirSync(root);
  expect(leftovers.length == 0);
});

test("a corrupt or truncated archive is refused before extraction, and cleaned up", () => {
  let root = freshDir("corrupt");
  let bin = freshDir("corrupt-bin");
  let runCmd = (cmd: string, args: string[]) => {
    if (cmd == "curl") { fs.writeFileSync(lastArg(args), "not-actually-gzip"); return shell(0, "", ""); }
    if (cmd == "tar" && args[0] == "-tzf") { return shell(2, "", "tar: Unexpected EOF in archive"); }
    return shell(0, "", "");
  };
  let result = runInstallOnceWith("0.1.0", root, bin, "linux", "x64", ok("v0.2.0"), runCmd);
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("corrupt or incomplete") >= 0);
  expect(fs.readdirSync(root).length == 0);
});

test("an extraction failure after a valid-looking listing is still refused and cleaned up", () => {
  let root = freshDir("extractfail");
  let bin = freshDir("extractfail-bin");
  let runCmd = (cmd: string, args: string[]) => {
    if (cmd == "curl") { fs.writeFileSync(lastArg(args), "bytes"); return shell(0, "", ""); }
    if (cmd == "tar" && args[0] == "-tzf") { return shell(0, "code-" + TARGET + "/joule\n", ""); }
    if (cmd == "tar" && args[0] == "-xzf") { return shell(1, "", "tar: disk full"); }
    return shell(0, "", "");
  };
  let result = runInstallOnceWith("0.1.0", root, bin, "linux", "x64", ok("v0.2.0"), runCmd);
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("extract") >= 0);
  expect(fs.readdirSync(root).length == 0);
});

test("verifyDownloadedJoule rejects a missing binary", () => {
  let v = verifyDownloadedJoule("/tmp/installer-test-does-not-exist/joule", TARGET, "0.2.0", (cmd: string, args: string[]) => shell(0, "joule 0.2.0", ""));
  expect(!v.ok);
  expect(v.error.indexOf("did not contain") >= 0);
});

test("verifyDownloadedJoule rejects a binary that is too small or has the wrong magic", () => {
  let p = "/tmp/installer-test-badmagic-" + `${Date.now()}`;
  fs.writeFileSync(p, "PK\x03\x04" + padding(MIN_BINARY_BYTES));
  let v = verifyDownloadedJoule(p, TARGET, "0.2.0", (cmd: string, args: string[]) => shell(0, "joule 0.2.0", ""));
  expect(!v.ok);
  expect(v.error.indexOf("does not look like a valid") >= 0);
  fs.rmSync(p, false);
});

test("verifyDownloadedJoule rejects a binary that will not run", () => {
  let p = "/tmp/installer-test-wontrun-" + `${Date.now()}`;
  fs.writeFileSync(p, validJouleBytes());
  let v = verifyDownloadedJoule(p, TARGET, "0.2.0", (cmd: string, args: string[]) => shell(126, "", "permission denied"));
  expect(!v.ok);
  expect(v.error.indexOf("would not run") >= 0);
  fs.rmSync(p, false);
});

test("verifyDownloadedJoule rejects a binary that reports a different version than expected", () => {
  let p = "/tmp/installer-test-mismatch-" + `${Date.now()}`;
  fs.writeFileSync(p, validJouleBytes());
  let v = verifyDownloadedJoule(p, TARGET, "0.2.0", (cmd: string, args: string[]) => shell(0, "joule 0.1.9\n", ""));
  expect(!v.ok);
  expect(v.error.indexOf("reports version 0.1.9") >= 0);
  fs.rmSync(p, false);
});

test("a binary that will not start is quoted in one line, without the shell's own noise around it", () => {
  let p = "/opt/.joule-code/0.2.0/joule";
  expect(refusalReason(p, 127, p + ": 1: exec: " + p + ": not found", "") == "exit 127: not found");
  expect(refusalReason(p, 127, p + ": /lib/x86_64-linux-gnu/libc.so.6: version GLIBC_2.36 not found\n", "") == "exit 127: /lib/x86_64-linux-gnu/libc.so.6: version GLIBC_2.36 not found");
  expect(refusalReason(p, 1, "", "") == "exit 1");
});

test("verifyDownloadedJoule accepts a well-formed, runnable, correctly-versioned binary", () => {
  let p = "/tmp/installer-test-good-" + `${Date.now()}`;
  fs.writeFileSync(p, validJouleBytes());
  let v = verifyDownloadedJoule(p, TARGET, "0.2.0", (cmd: string, args: string[]) => shell(0, "joule 0.2.0\n", ""));
  expect(v.ok);
  fs.rmSync(p, false);
});

test("an archive missing the joule binary for this platform is refused end to end", () => {
  let root = freshDir("nobinary");
  let bin = freshDir("nobinary-bin");
  let runCmd = (cmd: string, args: string[]) => {
    if (cmd == "curl") { fs.writeFileSync(lastArg(args), "bytes"); return shell(0, "", ""); }
    if (cmd == "tar" && args[0] == "-tzf") { return shell(0, "code-" + TARGET + "/README.md\n", ""); }
    if (cmd == "tar" && args[0] == "-xzf") {
      let innerDir = lastArg(args) + "/code-" + TARGET;
      fs.mkdirSync(innerDir, true);
      fs.writeFileSync(innerDir + "/README.md", "hi");
      return shell(0, "", "");
    }
    return shell(0, "", "");
  };
  let result = runInstallOnceWith("0.1.0", root, bin, "linux", "x64", ok("v0.2.0"), runCmd);
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("did not contain") >= 0);
  expect(fs.readdirSync(root).length == 0);
});

class Signing {
  verifies: int;
  signs: int;
  signed: string[];
  constructor() { this.verifies = 0; this.signs = 0; this.signed = []; }
}

function signingRun(trace: Signing, verifyStatus: int, signStatus: int): (cmd: string, args: string[]) => ShellResult {
  return (cmd: string, args: string[]) => {
    if (cmd == CODESIGN && args[0] == "--verify") {
      trace.verifies = trace.verifies + 1;
      return shell(verifyStatus, "", "code object is not signed at all");
    }
    if (cmd == CODESIGN && args[0] == "--sign") {
      trace.signs = trace.signs + 1;
      trace.signed.push(lastArg(args));
      return shell(signStatus, "", "the codesign tool is not on this machine");
    }
    return shell(0, "joule 0.2.0\n", "");
  };
}

test("a Linux install never reaches for codesign", () => {
  let trace = new Signing();
  let v = ensureCodeSignature("/tmp/anywhere/joule-daemon", "joule-daemon", PLATFORM_LINUX_X64, signingRun(trace, 1, 0));
  expect(v.ok);
  expect(trace.verifies == 0);
  expect(trace.signs == 0);
});

test("a macOS binary whose signature already verifies is left exactly as it came", () => {
  let trace = new Signing();
  let v = ensureCodeSignature("/tmp/anywhere/joule-daemon", "joule-daemon", PLATFORM_MACOS_ARM64, signingRun(trace, 0, 0));
  expect(v.ok);
  expect(trace.verifies == 1);
  expect(trace.signs == 0);
});

test("a macOS binary carrying no signature this machine accepts is signed before anything tries to run it", () => {
  let trace = new Signing();
  let v = ensureCodeSignature("/tmp/anywhere/joule-daemon", "joule-daemon", PLATFORM_MACOS_ARM64, signingRun(trace, 1, 0));
  expect(v.ok);
  expect(trace.verifies == 1);
  expect(trace.signs == 1);
});

test("a macOS binary that cannot be signed is named and refused, not installed to be killed on exec", () => {
  let trace = new Signing();
  let v = ensureCodeSignature("/tmp/anywhere/joule-daemon", "joule-daemon", PLATFORM_MACOS_ARM64, signingRun(trace, 1, 1));
  expect(!v.ok);
  expect(v.error.indexOf("joule-daemon") >= 0);
  expect(v.error.indexOf("signing it here failed") >= 0);
  expect(v.error.indexOf("existing install still works") >= 0);
});

test("a macOS update signs the daemon too, not only the two commands a person launches", () => {
  let root = freshDir("macos-signing");
  let bin = freshDir("macos-signing-bin");
  let trace = new Signing();
  let runCmd = (cmd: string, args: string[]) => {
    if (cmd == CODESIGN) { return signingRun(trace, 1, 0)(cmd, args); }
    if (cmd == "curl") { fs.writeFileSync(lastArg(args), "fake-archive-bytes"); return shell(0, "", ""); }
    if (cmd == "tar" && args[0] == "-tzf") { return shell(0, "code-" + MACOS_TARGET + "/joule\n", ""); }
    if (cmd == "tar" && args[0] == "-xzf") {
      let innerDir = lastArg(args) + "/code-" + MACOS_TARGET;
      fs.mkdirSync(innerDir, true);
      fs.writeFileSync(innerDir + "/joule", validMachOBytes());
      fs.writeFileSync(innerDir + "/relay", validMachOBytes());
      fs.writeFileSync(innerDir + "/joule-daemon", validMachOBytes());
      return shell(0, "", "");
    }
    return shell(0, "joule 0.2.0\n", "");
  };
  let result = runInstallOnceWith("0.1.0", root, bin, "darwin", "arm64", ok("v0.2.0"), runCmd);
  expect(result.kind == RESULT_INSTALLED);
  expect(trace.signs == 3);
  let sawDaemon = false;
  let i = 0;
  while (i < trace.signed.length) {
    if (trace.signed[i].endsWith("/joule-daemon")) { sawDaemon = true; }
    i = i + 1;
  }
  expect(sawDaemon);
});

test("a macOS update that cannot sign the daemon relinks nothing and keeps the working install", () => {
  let root = freshDir("macos-signing-fail");
  let bin = freshDir("macos-signing-fail-bin");
  let trace = new Signing();
  let runCmd = (cmd: string, args: string[]) => {
    if (cmd == CODESIGN) {
      if (args[0] == "--sign" && lastArg(args).endsWith("/joule-daemon")) { return shell(1, "", "codesign refused"); }
      return signingRun(trace, 1, 0)(cmd, args);
    }
    if (cmd == "curl") { fs.writeFileSync(lastArg(args), "fake-archive-bytes"); return shell(0, "", ""); }
    if (cmd == "tar" && args[0] == "-tzf") { return shell(0, "code-" + MACOS_TARGET + "/joule\n", ""); }
    if (cmd == "tar" && args[0] == "-xzf") {
      let innerDir = lastArg(args) + "/code-" + MACOS_TARGET;
      fs.mkdirSync(innerDir, true);
      fs.writeFileSync(innerDir + "/joule", validMachOBytes());
      fs.writeFileSync(innerDir + "/relay", validMachOBytes());
      fs.writeFileSync(innerDir + "/joule-daemon", validMachOBytes());
      return shell(0, "", "");
    }
    return shell(0, "joule 0.2.0\n", "");
  };
  let result = runInstallOnceWith("0.1.0", root, bin, "darwin", "arm64", ok("v0.2.0"), runCmd);
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("joule-daemon") >= 0);
  expect(!fs.existsSync(bin + "/joule"));
  expect(fs.readdirSync(root).length == 0);
});

test("a version directory that is already there is displaced whole, never written into", () => {
  let root = freshDir("displace");
  let bin = freshDir("displace-bin");
  let stale = root + "/0.6.2";
  fs.mkdirSync(stale, true);
  fs.writeFileSync(stale + "/joule", "left over from a killed attempt");
  fs.writeFileSync(stale + "/stowaway", "no file from before may survive the swap");

  let result = runInstallOnceWith("0.6.1", root, bin, "linux", "x64", ok("v0.6.2"), baseHappyRun("0.6.2"));

  expect(result.kind == RESULT_INSTALLED);
  expect(!fs.existsSync(stale + "/stowaway"));
  expect(fs.readFileSync(stale + "/joule") == validJouleBytes());
  expect(fs.readdirSync(root).length == 1);
});

test("putInPlaceError says which install is still working", () => {
  expect(putInPlaceError("/opt/.joule-code/0.6.2", true).indexOf("was put back") >= 0);
  expect(putInPlaceError("/opt/.joule-code/0.6.2", false).indexOf("existing install still works") >= 0);
});

test("pure path helpers build the expected on-disk layout", () => {
  expect(versionDirPath("/opt/.joule-code", "0.6.2") == "/opt/.joule-code/0.6.2");
  expect(tmpRootPath("/opt/.joule-code", "123") == "/opt/.joule-code/.update-tmp-123");
  expect(binLinkPath("/opt/bin", "joule") == "/opt/bin/joule");
});

test("parseLatestTag reads tag_name out of the GitHub releases API shape", () => {
  expect(parseLatestTag("{\"tag_name\":\"v0.6.2\",\"name\":\"v0.6.2\"}") == "v0.6.2");
  expect(parseLatestTag("{}") == "");
  expect(parseLatestTag("not json") == "");
});
