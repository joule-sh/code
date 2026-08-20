import { VERSION } from "../version.ts";
import { SessionStore } from "./store.ts";
import { socketHandler } from "./http_transport.ts";
import { PeerRegistry, serveRelayWebSocket } from "./ws.ts";

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

let store = new SessionStore();
let registry = new PeerRegistry();

function runHttpListener(): int {
  net.createServer(HTTP_PORT, socketHandler(store, WS_BROWSER_PORT));
  return 0;
}

function runTerminalWsListener(): int {
  serveRelayWebSocket(WS_PORT, store, registry);
  return 0;
}

function runRelay(): void {
  console.log("relay: pairing on :" + `${HTTP_PORT}` + ", terminal ws on :" + `${WS_PORT}` + ", browser ws on :" + `${WS_BROWSER_PORT}`);
  Worker.run(runHttpListener);
  Worker.run(runTerminalWsListener);
  serveRelayWebSocket(WS_BROWSER_PORT, store, registry);
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
