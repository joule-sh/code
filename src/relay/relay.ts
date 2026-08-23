import { VERSION } from "../version.ts";
import { socketHandler } from "./http_transport.ts";
import { remoteStoreCaller } from "./relay_rpc.ts";
import { RelayOwner } from "./relay_owner.ts";
import { serveTerminalWebSocket, serveBrowserWebSocket } from "./ws.ts";
import { relayRuntimeDir, sessionsDir } from "./relay_paths.ts";

function hasFlagIn(argv: string[], name: string): bool {
  for (const a of argv) {
    if (a == name) {
      return true;
    }
  }
  return false;
}

function currentArgs(): string[] {
  let result: string[] = [];
  let i = 0;
  while (i < argsCount()) {
    result.push(arg(i));
    i = i + 1;
  }
  return result;
}

function envPort(name: string, fallback: int): int {
  let raw = process.env(name) ?? "";
  return Number.parseInt(raw, 10) ?? fallback;
}

const HTTP_PORT: int = envPort("JOULE_RELAY_HTTP_PORT", 8090);
const WS_PORT: int = envPort("JOULE_RELAY_WS_PORT", 8091);
const WS_BROWSER_PORT: int = envPort("JOULE_RELAY_WS_BROWSER_PORT", WS_PORT + 1);

let runtimeDir = relayRuntimeDir(HTTP_PORT);

function freshRuntimeDir(dir: string): void {
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(sessionsDir(dir), true);
}

function runHttpListener(): int {
  net.createServer(HTTP_PORT, socketHandler(remoteStoreCaller(runtimeDir), WS_BROWSER_PORT));
  return 0;
}

function runTerminalWsListener(): int {
  serveTerminalWebSocket(WS_PORT, runtimeDir);
  return 0;
}

function runBrowserWsListener(): int {
  serveBrowserWebSocket(WS_BROWSER_PORT, runtimeDir);
  return 0;
}

function runRelay(): void {
  freshRuntimeDir(runtimeDir);
  console.log("relay: pairing on :" + `${HTTP_PORT}` + ", terminal ws on :" + `${WS_PORT}` + ", browser ws on :" + `${WS_BROWSER_PORT}`);
  Worker.run(runHttpListener);
  Worker.run(runTerminalWsListener);
  Worker.run(runBrowserWsListener);
  let owner = new RelayOwner(runtimeDir);
  owner.loop();
}

if (hasFlagIn(currentArgs(), "--version")) {
  console.log("relay " + VERSION);
} else {
  runRelay();
}

test("hasFlagIn finds --version among other args", () => {
  expect(hasFlagIn(["prog", "--version"], "--version"));
  expect(hasFlagIn(["prog", "foo", "--version"], "--version"));
});

test("hasFlagIn is false when the flag is absent", () => {
  expect(!hasFlagIn(["prog"], "--version"));
  expect(!hasFlagIn(["prog", "foo"], "--version"));
});

test("envPort falls back when the variable is unset or not a number", () => {
  expect(envPort("JOULE_RELAY_HTTP_PORT_NOPE_1", 8090) == 8090);
});
