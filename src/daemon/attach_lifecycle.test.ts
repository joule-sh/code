import { helloWorkspace, attachedMode, attachedModel, nextPortInRange, isTaken, firstFreePort, firstLine, spawnFailureText, daemonBinFailure } from "./attach_lifecycle.ts";
import { PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello } from "../protocol/frames.ts";

function hello(workspace: string): string {
  let f: SessionHelloFrame = {
    v: PROTOCOL_VERSION, seq: 0, type: SESSION_HELLO,
    sessionId: "daemon-8300", workspace: workspace, model: "stub",
    mode: "ask", protocol: PROTOCOL_VERSION,
  };
  return encodeSessionHello(f);
}

function helloSaying(mode: string, model: string): string {
  let f: SessionHelloFrame = {
    v: PROTOCOL_VERSION, seq: 1, type: SESSION_HELLO,
    sessionId: "daemon-8300", workspace: "/tmp/mine", model: model,
    mode: mode, protocol: PROTOCOL_VERSION,
  };
  return encodeSessionHello(f);
}

test("helloWorkspace is empty until a session.hello arrives", () => {
  expect(helloWorkspace([]) == "");
});

test("helloWorkspace reads the workspace out of a session.hello", () => {
  expect(helloWorkspace([hello("/tmp/one/repo")]) == "/tmp/one/repo");
});

test("helloWorkspace skips frames that are not a session.hello", () => {
  let turn = "{\"v\":1,\"seq\":1,\"type\":\"turn.start\",\"turnId\":\"t1\"}";
  expect(helloWorkspace([turn, hello("/tmp/two/repo")]) == "/tmp/two/repo");
});

test("helloWorkspace answers with the first hello it saw", () => {
  expect(helloWorkspace([hello("/tmp/mine"), hello("/tmp/theirs")]) == "/tmp/mine");
});

test("a daemon for another workspace does not read as this one", () => {
  expect(helloWorkspace([hello("/tmp/theirs/repo")]) != "/tmp/mine/repo");
});

test("a client with nothing replayed to it yet falls back to what it guessed", () => {
  expect(attachedMode([], "auto-edit") == "auto-edit");
  expect(attachedModel([], "local-guess") == "local-guess");
});

test("the mode and model a joining client shows come from the session's hello", () => {
  let frames = [helloSaying("safe-auto", "stub-model")];
  expect(attachedMode(frames, "auto-edit") == "safe-auto");
  expect(attachedModel(frames, "local-guess") == "stub-model");
});

test("a hello that names neither leaves the client's own guess alone", () => {
  let frames = [helloSaying("", "")];
  expect(attachedMode(frames, "auto-edit") == "auto-edit");
  expect(attachedModel(frames, "local-guess") == "local-guess");
});

test("a change made before this client joined wins over the hello it replays with", () => {
  let frames = [
    helloSaying("auto-edit", "stub-model"),
    "{\"v\":1,\"seq\":2,\"type\":\"mode.changed\",\"mode\":\"full-auto\"}",
    "{\"v\":1,\"seq\":3,\"type\":\"model.changed\",\"model\":\"other-model\"}",
  ];
  expect(attachedMode(frames, "auto-edit") == "full-auto");
  expect(attachedModel(frames, "local-guess") == "other-model");
});

test("the last change in the replay is the one a joining client lands on", () => {
  let frames = [
    helloSaying("auto-edit", "stub-model"),
    "{\"v\":1,\"seq\":2,\"type\":\"mode.changed\",\"mode\":\"full-auto\"}",
    "{\"v\":1,\"seq\":3,\"type\":\"mode.changed\",\"mode\":\"read-only\"}",
  ];
  expect(attachedMode(frames, "auto-edit") == "read-only");
});

test("nextPortInRange steps to the next port in the range", () => {
  expect(nextPortInRange(8300) == 8301);
  expect(nextPortInRange(8698) == 8699);
});

test("nextPortInRange wraps to the base once it runs off the end", () => {
  expect(nextPortInRange(8699) == 8300);
});

test("isTaken spots a port another workspace already registered", () => {
  expect(isTaken([8301, 8302], 8302));
  expect(!isTaken([8301, 8302], 8303));
  expect(!isTaken([], 8301));
});

test("firstFreePort keeps the hashed port when nobody else holds it", () => {
  expect(firstFreePort(8342, []) == 8342);
  expect(firstFreePort(8342, [8300, 8500]) == 8342);
});

test("firstFreePort steps past every port another workspace holds", () => {
  expect(firstFreePort(8342, [8342]) == 8343);
  expect(firstFreePort(8342, [8342, 8343, 8344]) == 8345);
});

test("firstFreePort wraps around the end of the range", () => {
  expect(firstFreePort(8699, [8699]) == 8300);
});

test("firstLine takes the first non-empty line of what a failed run reported", () => {
  expect(firstLine("dyld: symbol not found\nmore detail\n") == "dyld: symbol not found");
  expect(firstLine("  only one line  ") == "only one line");
  expect(firstLine("") == "");
  expect(firstLine("\n\n") == "");
});

test("a daemon that failed to start is reported with whatever it said", () => {
  let text = spawnFailureText("/home/a/.local/joule-daemon", 1, "libgc.so.1: cannot open shared object file\n");
  expect(text.indexOf("/home/a/.local/joule-daemon") >= 0);
  expect(text.indexOf("libgc.so.1: cannot open shared object file") >= 0);
});

test("a daemon killed on exec says so rather than reporting a blank reason", () => {
  let text = spawnFailureText("/home/a/.local/joule-daemon", -1, "");
  expect(text.indexOf("killed before it could run") >= 0);
});

test("a daemon that exited with a status and said nothing still names the status", () => {
  let text = spawnFailureText("/home/a/.local/joule-daemon", 3, "");
  expect(text.indexOf("status 3") >= 0);
});

test("a daemon binary that is not there is reported without trying to run it", () => {
  let failure = daemonBinFailure("/tmp/joule-daemon-that-does-not-exist");
  expect(failure.indexOf("there is no such file") >= 0);
});

test("a daemon binary that runs and exits cleanly reports no failure", () => {
  expect(daemonBinFailure("/bin/echo") == "");
});
