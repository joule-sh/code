import { resolveInstallRoot, resolveBinDir, defaultInstallRoot, defaultBinDir, isUnderInstallRoot, isManagedInstall } from "./install_detect.ts";

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
