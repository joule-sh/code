import { ShellResult, RESULT_INSTALLED, RESULT_UP_TO_DATE, RESULT_ERROR } from "./installer.ts";
import { NPM_PACKAGE, npmViewArgs, npmInstallArgs, npmCommandText, npmErrorCode, isPermissionCode, isNetworkCode, firstNpmErrorLine, npmMissingText, npmFailureText, reportedVersion, runNpmUpdateWith } from "./npm_update.ts";

function shell(status: int, stdout: string, stderr: string): ShellResult {
  let r: ShellResult = { status: status, stdout: stdout, stderr: stderr };
  return r;
}

type Call = { cmd: string, args: string[] };

class FakeNpm {
  calls: Call[];
  viewStatus: int;
  viewOut: string;
  viewErr: string;
  installStatus: int;
  installErr: string;
  probeStatus: int;
  exeStatus: int;
  exeOut: string;

  constructor(latest: string) {
    this.calls = [];
    this.viewStatus = 0;
    this.viewOut = latest + "\n";
    this.viewErr = "";
    this.installStatus = 0;
    this.installErr = "";
    this.probeStatus = 0;
    this.exeStatus = 0;
    this.exeOut = "joule " + latest + "\n";
  }

  run(cmd: string, args: string[]): ShellResult {
    let call: Call = { cmd: cmd, args: args };
    this.calls.push(call);
    if (cmd != "npm") { return shell(this.exeStatus, this.exeOut, "boom"); }
    if (args.length > 0 && args[0] == "--version") { return shell(this.probeStatus, "10.9.8\n", ""); }
    if (args.length > 0 && args[0] == "view") { return shell(this.viewStatus, this.viewOut, this.viewErr); }
    return shell(this.installStatus, "", this.installErr);
  }

  runner(): (cmd: string, args: string[]) => ShellResult {
    return (cmd: string, args: string[]) => { return this.run(cmd, args); };
  }

  ranInstall(): bool {
    for (const c of this.calls) {
      if (c.cmd == "npm" && c.args.length > 0 && c.args[0] == "install") { return true; }
    }
    return false;
  }
}

test("the update runs npm's own global install, pinned to the version it just looked up", () => {
  let args = npmInstallArgs("0.22.0");
  expect(args[0] == "install");
  expect(args[1] == "--global");
  expect(args[2] == NPM_PACKAGE + "@0.22.0");
  expect(npmCommandText(args).startsWith("npm install --global " + NPM_PACKAGE + "@0.22.0"));
});

test("npmViewArgs asks npm, not GitHub, what the latest published version is", () => {
  let args = npmViewArgs();
  expect(args[0] == "view");
  expect(args[1] == NPM_PACKAGE);
  expect(args[2] == "version");
});

test("npmErrorCode reads the code npm prints, in either of npm's two formats", () => {
  expect(npmErrorCode("npm error code EACCES\nnpm error syscall mkdir") == "EACCES");
  expect(npmErrorCode("npm ERR! code ENOTFOUND") == "ENOTFOUND");
  expect(npmErrorCode("something else entirely") == "");
});

test("a prefix needing elevation is named as that, with a way out", () => {
  let text = npmFailureText("install it", npmInstallArgs("0.22.0"), 1, "npm error code EACCES\nnpm error EACCES: permission denied, mkdir '/usr/lib'");
  expect(text.indexOf("EACCES") >= 0);
  expect(text.indexOf("rights") >= 0);
  expect(text.indexOf("npm config set prefix") >= 0);
});

test("an unreachable registry is named as that, not as a generic failure", () => {
  let text = npmFailureText("check the latest published version", npmViewArgs(), 1, "npm error code ECONNREFUSED\nnpm error FetchError: request failed");
  expect(text.indexOf("registry") >= 0);
  expect(text.indexOf("ECONNREFUSED") >= 0);
  expect(isNetworkCode("ECONNREFUSED"));
  expect(isNetworkCode("EAI_AGAIN"));
  expect(!isNetworkCode("EACCES"));
  expect(isPermissionCode("EPERM"));
});

test("an unclassified npm failure still quotes the command, the exit status and npm's own first line", () => {
  let text = npmFailureText("install it", npmInstallArgs("0.22.0"), 7, "npm warn deprecated x\nnpm error something odd happened");
  expect(text.indexOf("exited 7") >= 0);
  expect(text.indexOf("something odd happened") >= 0);
  expect(firstNpmErrorLine("npm warn deprecated x\nnpm error real") == "npm error real");
});

test("npm missing from PATH is reported as that, and nothing is installed", () => {
  let npm = new FakeNpm("0.22.0");
  npm.probeStatus = 127;
  let result = runNpmUpdateWith("0.21.0", "/n/bin/joule", npm.runner());
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("not on PATH") >= 0);
  expect(!npm.ranInstall());
  expect(npmMissingText().indexOf("npm install -g") >= 0);
});

test("an offline machine is told the registry was unreachable, and nothing is installed", () => {
  let npm = new FakeNpm("0.22.0");
  npm.viewStatus = 1;
  npm.viewErr = "npm error code EAI_AGAIN\nnpm error request failed";
  let result = runNpmUpdateWith("0.21.0", "/n/bin/joule", npm.runner());
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("registry") >= 0);
  expect(!npm.ranInstall());
});

test("an already-current install is left alone rather than reinstalled", () => {
  let npm = new FakeNpm("0.22.0");
  let result = runNpmUpdateWith("0.22.0", "/n/bin/joule", npm.runner());
  expect(result.kind == RESULT_UP_TO_DATE);
  expect(!npm.ranInstall());
});

test("a source build is declined before npm is consulted at all", () => {
  let npm = new FakeNpm("0.22.0");
  let result = runNpmUpdateWith("dev", "/n/bin/joule", npm.runner());
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("source build") >= 0);
  expect(npm.calls.length == 0);
});

test("a newer version installs, and is confirmed by running the path the old binary came from", () => {
  let npm = new FakeNpm("0.22.0");
  let result = runNpmUpdateWith("0.21.0", "/n/bin/joule", npm.runner());
  expect(result.kind == RESULT_INSTALLED);
  expect(result.fromVersion == "0.21.0");
  expect(result.toVersion == "0.22.0");
  expect(npm.ranInstall());
  let last = npm.calls[npm.calls.length - 1];
  expect(last.cmd == "/n/bin/joule");
  expect(last.args[0] == "--version");
});

test("npm claiming success while the old build is still on that path is reported, not celebrated", () => {
  let npm = new FakeNpm("0.22.0");
  npm.exeOut = "joule 0.21.0\n";
  let result = runNpmUpdateWith("0.21.0", "/n/bin/joule", npm.runner());
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("still reports version 0.21.0") >= 0);
});

test("a newly installed binary that will not run is reported, not celebrated", () => {
  let npm = new FakeNpm("0.22.0");
  npm.exeStatus = 126;
  let result = runNpmUpdateWith("0.21.0", "/n/bin/joule", npm.runner());
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("will not run") >= 0);
});

test("a failed install is reported and never claimed as installed", () => {
  let npm = new FakeNpm("0.22.0");
  npm.installStatus = 1;
  npm.installErr = "npm error code EACCES\nnpm error permission denied";
  let result = runNpmUpdateWith("0.21.0", "/n/bin/joule", npm.runner());
  expect(result.kind == RESULT_ERROR);
  expect(result.error.indexOf("EACCES") >= 0);
});

test("reportedVersion reads joule's own --version line, with or without a leading v", () => {
  expect(reportedVersion("joule 0.22.0\n") == "0.22.0");
  expect(reportedVersion("v0.22.0") == "0.22.0");
  expect(reportedVersion("  joule v0.22.0  ") == "0.22.0");
});
