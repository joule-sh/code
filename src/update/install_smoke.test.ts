import { runInstallOnceWith, RESULT_INSTALLED, RESULT_ERROR, ShellResult, FetchTagResult } from "./installer.ts";
import { PLATFORM_LINUX_X64 } from "./platform.ts";
import { chmodPath } from "../vendor/platform/platform.ts";

const TARGET: string = PLATFORM_LINUX_X64;
const FIXTURES: string = "/tmp/joule-update-smoke-fixtures";
const SHIM_SOURCE: string = "#include <stdio.h>\nconst char pad[300000] = {1};\nint main(void) { printf(\"%s\\n\", MSG); return CODE; }\n";
const SIDE_SOURCE: string = "int joule_side(void) { return 0; }\n";
const NEEDS_SOURCE: string = "#include <stdio.h>\nextern int joule_side(void);\nconst char pad[300000] = {1};\nint main(void) { printf(\"joule 0.2.0 %d\\n\", joule_side()); return 0; }\n";
const SIDE_LIB: string = "jouleside";

export type Release = { joule: string, relay: string, daemon: string };
export type Layout = { root: string, bin: string };
export type Attempt = { layout: Layout, kind: string, error: string };

let g_old: string = "";
let g_new: string = "";
let g_dead_loader: string = "";
let g_dead_exit: string = "";

function run(cmd: string, args: string[]): ShellResult {
  let r = child_process.spawnSync(cmd, args);
  let out: ShellResult = { status: r.status, stdout: r.stdout, stderr: r.stderr };
  return out;
}

function shell(status: int, stdout: string, stderr: string): ShellResult {
  let r: ShellResult = { status: status, stdout: stdout, stderr: stderr };
  return r;
}

function buildShim(scratch: string, name: string, msg: string, code: int): string {
  let out = FIXTURES + "/" + name;
  if (fs.existsSync(out)) { return out; }
  let staged = scratch + "/" + name;
  run("cc", ["-DMSG=\"" + msg + "\"", "-DCODE=" + `${code}`, scratch + "/shim.c", "-o", staged]);
  fs.renameSync(staged, out);
  return out;
}

function buildLoaderCasualty(scratch: string, nonce: string, name: string): string {
  let out = FIXTURES + "/" + name;
  if (fs.existsSync(out)) { return out; }
  let side = SIDE_LIB + nonce;
  let lib = scratch + "/lib" + side + ".so";
  let staged = scratch + "/" + name;
  run("cc", ["-shared", "-fPIC", "-o", lib, scratch + "/side.c"]);
  run("cc", [scratch + "/needs.c", "-L" + scratch, "-l" + side, "-Wl,-rpath," + scratch, "-o", staged]);
  fs.rmSync(lib, false);
  fs.renameSync(staged, out);
  return out;
}

function ensureFixtures(): void {
  if (g_new != "") { return; }
  if (!fs.existsSync(FIXTURES)) { fs.mkdirSync(FIXTURES, true); }
  let nonce = `${Date.now()}`;
  let scratch = FIXTURES + "/build-" + nonce;
  fs.mkdirSync(scratch, true);
  fs.writeFileSync(scratch + "/shim.c", SHIM_SOURCE);
  fs.writeFileSync(scratch + "/side.c", SIDE_SOURCE);
  fs.writeFileSync(scratch + "/needs.c", NEEDS_SOURCE);
  g_old = buildShim(scratch, "joule-0.1.0", "joule 0.1.0", 0);
  g_dead_loader = buildLoaderCasualty(scratch, nonce, "joule-dead-loader");
  g_dead_exit = buildShim(scratch, "joule-dead-exit", "joule 0.2.0", 1);
  g_new = buildShim(scratch, "joule-0.2.0", "joule 0.2.0", 0);
  fs.rmSync(scratch, true);
}

function place(src: string, dst: string): void {
  if (src == "") { return; }
  run("cp", [src, dst]);
  chmodPath(dst, 0o755);
}

function versionOf(path: string): string {
  let r = run("/bin/sh", ["-c", "exec \"$0\" --version", path]);
  if (r.status != 0) { return ""; }
  return r.stdout.trim();
}

function existingInstall(name: string): Layout {
  let l: Layout = { root: "/tmp/joule-update-smoke-root-" + name, bin: "/tmp/joule-update-smoke-bin-" + name };
  if (fs.existsSync(l.root)) { fs.rmSync(l.root, true); }
  if (fs.existsSync(l.bin)) { fs.rmSync(l.bin, true); }
  fs.mkdirSync(l.root + "/0.1.0", true);
  fs.mkdirSync(l.bin, true);
  place(g_old, l.root + "/0.1.0/joule");
  place(g_old, l.root + "/0.1.0/relay");
  place(g_old, l.root + "/0.1.0/joule-daemon");
  fs.symlinkSync(l.root + "/0.1.0/joule", l.bin + "/joule");
  fs.symlinkSync(l.root + "/0.1.0/relay", l.bin + "/relay");
  return l;
}

function servesRelease(rel: Release): (cmd: string, args: string[]) => ShellResult {
  return (cmd: string, args: string[]) => {
    if (cmd == "curl") {
      fs.writeFileSync(args[args.length - 1], "archive-bytes");
      return shell(0, "", "");
    }
    if (cmd == "tar" && args[0] == "-tzf") {
      return shell(0, "code-" + TARGET + "/joule\n", "");
    }
    if (cmd == "tar" && args[0] == "-xzf") {
      let inner = args[args.length - 1] + "/code-" + TARGET;
      fs.mkdirSync(inner, true);
      place(rel.joule, inner + "/joule");
      place(rel.relay, inner + "/relay");
      place(rel.daemon, inner + "/joule-daemon");
      return shell(0, "", "");
    }
    return run(cmd, args);
  };
}

function tag(v: string): () => FetchTagResult {
  return () => {
    let r: FetchTagResult = { ok: true, tag: v, error: "" };
    return r;
  };
}

function attempt(name: string, rel: Release): Attempt {
  ensureFixtures();
  let l = existingInstall(name);
  let result = runInstallOnceWith("0.1.0", l.root, l.bin, "linux", "x64", tag("v0.2.0"), servesRelease(rel));
  let out: Attempt = { layout: l, kind: result.kind, error: result.error };
  return out;
}

function stillTheOldInstall(l: Layout): bool {
  if (fs.existsSync(l.root + "/0.2.0")) { return false; }
  if (fs.readdirSync(l.root).length != 1) { return false; }
  if (fs.readlinkSync(l.bin + "/joule") != l.root + "/0.1.0/joule") { return false; }
  if (fs.readlinkSync(l.bin + "/relay") != l.root + "/0.1.0/relay") { return false; }
  if (versionOf(l.bin + "/joule") != "joule 0.1.0") { return false; }
  if (versionOf(l.bin + "/relay") != "joule 0.1.0") { return false; }
  return true;
}

test("a new joule missing a library it was linked against is refused, and the joule already installed still runs", () => {
  ensureFixtures();
  let rel: Release = { joule: g_dead_loader, relay: g_new, daemon: g_new };
  let a = attempt("loader", rel);
  expect(a.kind == RESULT_ERROR);
  expect(a.error.indexOf("joule would not run") >= 0);
  expect(a.error.indexOf("cannot open shared object file") >= 0);
  expect(a.error.indexOf("\n") < 0);
  expect(stillTheOldInstall(a.layout));
});

test("a new joule that starts and exits non-zero is refused, and the joule already installed still runs", () => {
  ensureFixtures();
  let rel: Release = { joule: g_dead_exit, relay: g_new, daemon: g_new };
  let a = attempt("exitcode", rel);
  expect(a.kind == RESULT_ERROR);
  expect(a.error.indexOf("would not run") >= 0);
  expect(stillTheOldInstall(a.layout));
});

test("a new relay that will not start stops the update before anything is relinked", () => {
  ensureFixtures();
  let rel: Release = { joule: g_new, relay: g_dead_loader, daemon: g_new };
  let a = attempt("relay", rel);
  expect(a.kind == RESULT_ERROR);
  expect(a.error.indexOf("relay would not run") >= 0);
  expect(stillTheOldInstall(a.layout));
});

test("a new joule-daemon that will not start stops the update before anything is relinked", () => {
  ensureFixtures();
  let rel: Release = { joule: g_new, relay: g_new, daemon: g_dead_exit };
  let a = attempt("daemon", rel);
  expect(a.kind == RESULT_ERROR);
  expect(a.error.indexOf("joule-daemon would not run") >= 0);
  expect(stillTheOldInstall(a.layout));
});

test("an archive carrying no joule-daemon is refused rather than installed without daemon mode", () => {
  ensureFixtures();
  let rel: Release = { joule: g_new, relay: g_new, daemon: "" };
  let a = attempt("nodaemon", rel);
  expect(a.kind == RESULT_ERROR);
  expect(a.error.indexOf("did not contain a joule-daemon") >= 0);
  expect(stillTheOldInstall(a.layout));
});

test("a release whose three binaries all start is installed, linked and runnable", () => {
  ensureFixtures();
  let rel: Release = { joule: g_new, relay: g_new, daemon: g_new };
  let a = attempt("happy", rel);
  let l = a.layout;
  expect(a.kind == RESULT_INSTALLED);
  expect(versionOf(l.root + "/0.2.0/joule") == "joule 0.2.0");
  expect(versionOf(l.root + "/0.2.0/relay") == "joule 0.2.0");
  expect(versionOf(l.root + "/0.2.0/joule-daemon") == "joule 0.2.0");
  expect(fs.readlinkSync(l.bin + "/joule") == l.root + "/0.2.0/joule");
  expect(fs.readlinkSync(l.bin + "/relay") == l.root + "/0.2.0/relay");
  expect(versionOf(l.bin + "/joule") == "joule 0.2.0");
  expect(versionOf(l.bin + "/relay") == "joule 0.2.0");
  expect(fs.existsSync(l.root + "/0.1.0/joule"));
  let leftovers = fs.readdirSync(l.root);
  let i = 0;
  let sawTmp = false;
  while (i < leftovers.length) {
    if (leftovers[i].startsWith(".update-tmp-")) { sawTmp = true; }
    i = i + 1;
  }
  expect(!sawTmp);
});
