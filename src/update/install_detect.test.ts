import { resolveInstallRoot, resolveBinDir, defaultInstallRoot, defaultBinDir, isUnderInstallRoot, resolveArgv0Path, isUpdateTmpName, pathSegments, isUnderNpmPackage, detectInstallMethod, canSelfUpdate, INSTALL_METHOD_SCRIPT, INSTALL_METHOD_NPM, INSTALL_METHOD_UNKNOWN } from "./install_detect.ts";

function freshRoot(name: string): string {
  let root = "/tmp/install-detect-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

test("resolveInstallRoot honors the env override, else the documented default", () => {
  expect(resolveInstallRoot("/opt/custom-root", "/home/x") == "/opt/custom-root");
  expect(resolveInstallRoot("", "/home/x") == defaultInstallRoot("/home/x"));
  expect(defaultInstallRoot("/home/x") == "/home/x/.joule-code");
});

test("resolveBinDir honors the env override, else the documented default", () => {
  expect(resolveBinDir("/opt/bin", "/home/x") == "/opt/bin");
  expect(resolveBinDir("", "/home/x") == defaultBinDir("/home/x"));
  expect(defaultBinDir("/home/x") == "/home/x/.local/bin");
});

test("a running exe path under the install root is a managed install", () => {
  let root = freshRoot("under");
  let versionDir = root + "/v0.6.0";
  fs.mkdirSync(versionDir, true);
  let exe = versionDir + "/joule";
  fs.writeFileSync(exe, "binary");
  expect(isUnderInstallRoot(exe, root));
  expect(detectInstallMethod(exe, root) == INSTALL_METHOD_SCRIPT);
});

test("a running exe path elsewhere, such as a source build, is not a managed install", () => {
  let root = freshRoot("elsewhere-root");
  fs.mkdirSync(root + "/v0.6.0", true);
  let elsewhere = freshRoot("elsewhere-exe");
  let exe = elsewhere + "/bin/joule";
  fs.mkdirSync(elsewhere + "/bin", true);
  fs.writeFileSync(exe, "binary");
  expect(!isUnderInstallRoot(exe, root));
});

test("an undetectable exe path (empty) is never treated as managed", () => {
  let root = freshRoot("undetectable");
  fs.mkdirSync(root + "/v0.6.0", true);
  expect(!isUnderInstallRoot("", root));
});

test("a nonexistent install root is never a match", () => {
  expect(!isUnderInstallRoot("/tmp/install-detect-test-under/v0.6.0/joule", "/tmp/install-detect-test-does-not-exist"));
});

test("a path that merely shares the install root as a text prefix, not a real subpath, does not match", () => {
  let root = freshRoot("prefix-trap");
  let sneaky = root + "-evil/joule";
  expect(!isUnderInstallRoot(sneaky, root));
});

function fakeFs(present: string[]): (path: string) => bool {
  return (p: string) => {
    let i = 0;
    while (i < present.length) {
      if (present[i] == p) { return true; }
      i = i + 1;
    }
    return false;
  };
}

test("resolveArgv0Path finds a bare command name on PATH, macOS-style (no /proc)", () => {
  let exists = fakeFs(["/opt/homebrew/bin/joule"]);
  let found = resolveArgv0Path("joule", "/usr/bin:/opt/homebrew/bin", "/Users/x", exists);
  expect(found == "/opt/homebrew/bin/joule");
});

test("resolveArgv0Path stops at the first PATH entry that has the command", () => {
  let exists = fakeFs(["/usr/bin/joule", "/opt/homebrew/bin/joule"]);
  let found = resolveArgv0Path("joule", "/usr/bin:/opt/homebrew/bin", "/Users/x", exists);
  expect(found == "/usr/bin/joule");
});

test("resolveArgv0Path returns empty when the command is on no PATH entry", () => {
  let exists = fakeFs(["/opt/homebrew/bin/joule"]);
  let found = resolveArgv0Path("joule", "/usr/bin:/usr/local/bin", "/Users/x", exists);
  expect(found == "");
});

test("resolveArgv0Path skips empty PATH entries without matching them", () => {
  let exists = fakeFs(["/opt/homebrew/bin/joule"]);
  let found = resolveArgv0Path("joule", "::/opt/homebrew/bin:", "/Users/x", exists);
  expect(found == "/opt/homebrew/bin/joule");
});

test("resolveArgv0Path resolves a relative argv0 against cwd", () => {
  let exists = fakeFs(["/Users/x/bin/joule"]);
  let found = resolveArgv0Path("bin/joule", "/usr/bin", "/Users/x", exists);
  expect(found == "/Users/x/bin/joule");
});

test("resolveArgv0Path uses an absolute argv0 directly, without consulting PATH", () => {
  let exists = fakeFs(["/Users/x/.joule-code/0.6.1/joule"]);
  let found = resolveArgv0Path("/Users/x/.joule-code/0.6.1/joule", "/usr/bin", "/Users/x", exists);
  expect(found == "/Users/x/.joule-code/0.6.1/joule");
});

test("resolveArgv0Path reports empty for an empty argv0", () => {
  let exists = fakeFs(["/opt/homebrew/bin/joule"]);
  expect(resolveArgv0Path("", "/opt/homebrew/bin", "/Users/x", exists) == "");
});

test("isUpdateTmpName recognizes the scratch-directory naming convention", () => {
  expect(isUpdateTmpName(".update-tmp-1700000000000"));
  expect(!isUpdateTmpName("0.6.1"));
  expect(!isUpdateTmpName("latest"));
});

test("pathSegments splits on either separator and drops the empty runs", () => {
  let posix = pathSegments("/usr/lib/node_modules/@joule-sh/code-linux-x64/bin/joule");
  expect(posix[0] == "usr");
  expect(posix[3] == "@joule-sh");
  expect(posix[posix.length - 1] == "joule");
  let win = pathSegments("C:\\Users\\a\\node_modules\\@joule-sh\\code-win32-x64\\bin\\joule.exe");
  expect(win[3] == "node_modules");
  expect(win[4] == "@joule-sh");
});

test("the binary npm installs is recognized under the per-platform optional dependency", () => {
  expect(isUnderNpmPackage("/usr/lib/node_modules/@joule-sh/code/node_modules/@joule-sh/code-linux-x64/bin/joule"));
  expect(isUnderNpmPackage("/home/a/.npm-global/lib/node_modules/@joule-sh/code-darwin-arm64/bin/joule"));
});

test("the binary npm installs is recognized when the wrapper vendored it itself", () => {
  expect(isUnderNpmPackage("/usr/lib/node_modules/@joule-sh/code/vendor/bin/joule"));
});

test("a Windows npm layout is recognized too, backslashes and all", () => {
  expect(isUnderNpmPackage("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\@joule-sh\\code-win32-x64\\bin\\joule.exe"));
});

test("some other package under a node_modules is not joule's npm install", () => {
  expect(!isUnderNpmPackage("/usr/lib/node_modules/@joule-sh/codex/bin/joule"));
  expect(!isUnderNpmPackage("/usr/lib/node_modules/@other/code-linux-x64/bin/joule"));
  expect(!isUnderNpmPackage("/home/a/src/project/node_modules/.bin/joule"));
  expect(!isUnderNpmPackage(""));
});

test("detectInstallMethod names the script install for a binary under the install root", () => {
  let root = freshRoot("method-script");
  let versionDir = root + "/0.22.0";
  fs.mkdirSync(versionDir, true);
  fs.writeFileSync(versionDir + "/joule", "binary");
  expect(detectInstallMethod(versionDir + "/joule", root) == INSTALL_METHOD_SCRIPT);
});

test("detectInstallMethod names npm for a binary under an npm package", () => {
  let root = freshRoot("method-npm");
  let exe = "/usr/lib/node_modules/@joule-sh/code-linux-x64/bin/joule";
  expect(detectInstallMethod(exe, root) == INSTALL_METHOD_NPM);
});

test("detectInstallMethod declines to guess for a binary neither installer owns", () => {
  let root = freshRoot("method-unknown");
  expect(detectInstallMethod("/usr/local/bin/joule", root) == INSTALL_METHOD_UNKNOWN);
  expect(detectInstallMethod("", root) == INSTALL_METHOD_UNKNOWN);
});

test("only the two installers joule knows how to drive can self-update", () => {
  expect(canSelfUpdate(INSTALL_METHOD_SCRIPT));
  expect(canSelfUpdate(INSTALL_METHOD_NPM));
  expect(!canSelfUpdate(INSTALL_METHOD_UNKNOWN));
  expect(!canSelfUpdate(""));
});
