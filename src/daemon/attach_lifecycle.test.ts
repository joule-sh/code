import { helloWorkspace, nextPortInRange, isTaken, firstFreePort } from "./attach_lifecycle.ts";
import { PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello } from "../protocol/frames.ts";

function hello(workspace: string): string {
  let f: SessionHelloFrame = {
    v: PROTOCOL_VERSION, seq: 0, type: SESSION_HELLO,
    sessionId: "daemon-8300", workspace: workspace, model: "stub",
    mode: "ask", protocol: PROTOCOL_VERSION,
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
