import { resolveInstallRoot, resolveBinDir, defaultInstallRoot, defaultBinDir, isUnderInstallRoot, isManagedInstall, resolveArgv0Path, isUpdateTmpName } from "./install_detect.ts";

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
  expect(isManagedInstall(exe, root));
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
