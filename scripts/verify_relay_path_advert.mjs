// A relay reached through a path rather than on a port of its own, which is
// what production is: the shared gateway fronts it at https://joule.sh/relay
// and nothing is listening on a bare host and port a client could dial.
//
// The client used to take the advertised URL apart into a host and a port and
// build the pairing call back out of those, so an advert of
// https://joule.sh/relay was asked as http://joule.sh:443 - the scheme lost
// and the path gone, with the port surviving only as the default the scheme
// had implied. That is #317, and it is why /share against production answered
// "400 The plain HTTP request was sent to HTTPS port" from the edge.
//
// So this harness serves its own relay behind a reverse proxy under /relay,
// advertises that URL, and asserts on the request line the proxy actually
// received - not merely that the share worked. A proxy relaxed enough to
// answer a wrong-but-reachable URL would let a broken client pass, which is
// the pattern #280 documents.
//
// The last phase advertises a bare host and port, because staging still does
// and must keep working while production moves.
import { connect } from "./miniws.mjs";
import { signedInHome, withoutInheritedConfig } from "./lib/signed_in_home.mjs";
import { startConsoleStub } from "./lib/console_stub.mjs";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { scratchDir } from "./scratch.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "/relay";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const attempt = () =>
    new Promise((resolve) => {
      const sock = net.createConnection(port, "127.0.0.1");
      sock.once("connect", () => { sock.end(); resolve(true); });
      sock.once("error", () => resolve(false));
    });
  return (async () => {
    while (Date.now() < deadline) {
      if (await attempt()) return true;
      await sleep(50);
    }
    return false;
  })();
}

let failures = 0;
function ok(cond, label) {
  if (!cond) {
    console.error("FAIL: " + label);
    failures += 1;
  } else {
    console.log("ok: " + label);
  }
}

async function collectUntil(frames, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = frames.find(predicate);
    if (found) return found;
    await sleep(20);
  }
  throw new Error("timed out waiting for " + label);
}

async function fetchJson(url, opts) {
  const resp = await fetch(url, opts);
  const text = await resp.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: resp.status, ok: resp.ok, json: parsed, text };
}

// The gateway's shape, in miniature: everything under /relay is the relay with
// the prefix stripped, and everything else is a 404 that names itself. A
// client that drops the prefix and asks for /sessions gets nothing, and the
// asked list below says so.
function startPathProxy(relayPort) {
  const asked = [];
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      asked.push({ at: Date.now(), line: req.method + " " + req.url });
      const under = req.url === PREFIX || req.url.startsWith(PREFIX + "/");
      if (!under) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "nothing is served at " + req.url + ", only under " + PREFIX }));
        return;
      }
      const rest = req.url.slice(PREFIX.length) || "/";
      const upstream = http.request(
        { host: "127.0.0.1", port: relayPort, method: req.method, path: rest, headers: req.headers },
        (up) => {
          res.writeHead(up.statusCode, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", (e) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      });
      req.pipe(upstream);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, asked, port: srv.address().port }));
  });
}

async function drive(phase, opts) {
  const workspace = scratchDir("joule-relay-path-" + phase.slug + "-");
  fs.writeFileSync(path.join(workspace, "README.md"), "# demo\n\nNo health route yet.\n");
  const daemonPort = await freePort();
  const stubPort = await freePort();

  const stub = spawn(path.join(REPO_ROOT, "bin", "stub_model"), [], {
    cwd: workspace,
    env: { ...process.env, E2E_STUB_PORT: String(stubPort) },
    stdio: "inherit",
  });

  const homeDir = signedInHome({
    prefix: "joule-relay-path-home-" + phase.slug,
    server: "http://joule-relay-path.invalid",
    secret: opts.secret,
    relayUrl: phase.advert,
    relayWsUrl: `ws://127.0.0.1:${opts.relayWsPort}`,
  });

  const daemonLog = path.join(workspace, "daemon.log");
  const daemon = spawn(path.join(REPO_ROOT, "bin", "joule-daemon"), [], {
    cwd: workspace,
    env: withoutInheritedConfig({
      ...process.env,
      HOME: homeDir,
      JOULE_DAEMON_PORT: String(daemonPort),
      JOULE_CODE_BASE_URL: `http://127.0.0.1:${stubPort}`,
      JOULE_CODE_MODEL: "stub-model",
      JOULE_CODE_API_KEY: "test-key",
      TMPDIR: workspace,
    }),
    stdio: ["ignore", fs.openSync(daemonLog, "w"), fs.openSync(daemonLog, "a")],
  });

  try {
    ok(await waitForPort(stubPort, 10000), phase.name + ": stub model came up");
    ok(await waitForPort(daemonPort, 10000), phase.name + ": daemon came up");

    const attach = await connect("127.0.0.1", daemonPort, "/attach/e2e-relay-path-" + phase.slug + "/ws", {});
    const attachFrames = [];
    attach.onMessage((text) => { try { attachFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await collectUntil(attachFrames, (f) => f.type === "session.hello", 8000, "session.hello");

    const before = opts.asked.length;
    attach.send(JSON.stringify({ v: 1, seq: 0, type: "share.request" }));
    const started = await collectUntil(attachFrames, (f) => f.type === "share.started" || f.type === "share.failed", 15000, "share.started or share.failed");
    ok(started.type === "share.started",
      phase.name + ": the session was created on the relay" + (started.error ? " (" + started.error + ")" : ""));
    if (started.type !== "share.started") { throw new Error("cannot continue: " + started.error); }

    const during = opts.asked.slice(before).map((a) => a.line);
    if (phase.throughProxy) {
      ok(during.length > 0, phase.name + ": the pairing call went through the gateway at all");
      ok(during.every((l) => l === "POST " + PREFIX + "/sessions"),
        phase.name + ": the client asked exactly " + JSON.stringify("POST " + PREFIX + "/sessions")
        + ", the advertised URL joined to /sessions once, got " + JSON.stringify(during));
      ok(!during.some((l) => l === "POST /sessions"),
        phase.name + ": nothing was asked at the root, so the " + PREFIX + " prefix was not dropped");
      ok(!during.some((l) => l.includes("//sessions")),
        phase.name + ": the join produced no doubled slash, got " + JSON.stringify(during));
    } else {
      ok(during.length === 0, phase.name + ": a bare host and port advert dials the relay directly, got " + JSON.stringify(during));
    }

    const userId = crypto.randomUUID();
    const paired = await fetchJson(`http://127.0.0.1:${opts.relayHttpPort}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": userId },
      body: JSON.stringify({ code: started.code }),
    });
    ok(paired.status === 200 && paired.json && paired.json.sessionId,
      phase.name + ": a browser paired against the printed code, got " + paired.status + " " + paired.text);
    const sessionId = paired.json.sessionId;

    const browser = await connect("127.0.0.1", opts.relayWsBrowserPort, `/w/${sessionId}/ws?x-user=${encodeURIComponent(userId)}`, {});
    const browserFrames = [];
    browser.onMessage((text) => { try { browserFrames.push(JSON.parse(text)); } catch { /* ignore */ } });
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "resume", since: -1 }));
    await collectUntil(browserFrames, (f) => f.type === "session.hello", 8000, "session.hello at the browser");
    ok(true, phase.name + ": the terminal's socket is up and the browser is on the same session");

    attach.send(JSON.stringify({ v: 1, seq: 0, type: "input", text: "add a health note to the README" }));
    await collectUntil(browserFrames, (f) => f.type === "turn.start", 15000, "turn.start at the browser");
    await collectUntil(browserFrames, (f) => f.type === "text.delta", 15000, "text.delta at the browser");
    const approval = await collectUntil(browserFrames, (f) => f.type === "approval.request", 20000, "approval.request at the browser");
    browser.send(JSON.stringify({ v: 1, seq: 0, type: "approval.reply", callId: approval.callId, decision: "allow" }));
    const turnEnd = await collectUntil(browserFrames, (f) => f.type === "turn.end", 25000, "turn.end at the browser");
    ok(turnEnd.reason === "done", phase.name + ": the turn streamed to the browser and closed done, got " + turnEnd.reason);
    ok(fs.readFileSync(path.join(workspace, "README.md"), "utf8").includes("Added a health check note."),
      phase.name + ": the tool the browser approved landed on the real workspace");

    browser.close();
    attach.close();
  } finally {
    daemon.kill();
    stub.kill();
    if (!process.env.DEBUG_KEEP) {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(homeDir, { recursive: true, force: true });
    } else {
      console.error("workspace kept at " + workspace + ", HOME kept at " + homeDir);
    }
  }
}

async function main() {
  const relayHttpPort = await freePort();
  const relayWsPort = await freePort();
  const relayWsBrowserPort = await freePort();
  const scratch = scratchDir("joule-relay-path-stack-");

  const secret = "e2e-relay-path-secret";
  const consoleStub = await startConsoleStub(secret, { id: "acct-relay-path", email: "p@example.com" });
  const consolePort = consoleStub.address().port;

  const relayLog = path.join(scratch, "relay.log");
  const relay = spawn(path.join(REPO_ROOT, "bin", "relay"), [], {
    env: {
      ...process.env,
      JOULE_RELAY_HTTP_PORT: String(relayHttpPort),
      JOULE_RELAY_WS_PORT: String(relayWsPort),
      JOULE_RELAY_WS_BROWSER_PORT: String(relayWsBrowserPort),
      JOULE_RELAY_CONSOLE_URL: `http://127.0.0.1:${consolePort}`,
    },
    stdio: ["ignore", fs.openSync(relayLog, "w"), fs.openSync(relayLog, "a")],
  });

  const proxy = await startPathProxy(relayHttpPort);

  try {
    ok(await waitForPort(relayHttpPort, 10000), "relay http came up");
    ok(await waitForPort(relayWsBrowserPort, 10000), "relay browser ws came up");

    // The proxy is the gateway, and it really does hide the relay: asking it
    // the way the old client did finds nothing there.
    const atRoot = await fetchJson(`http://127.0.0.1:${proxy.port}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: "/tmp", model: "stub-model", credentialSecret: secret }),
    });
    ok(atRoot.status === 404,
      "the relay is not at the root of the gateway, so a client that drops the path has nowhere to land, got " + atRoot.status);

    const opts = { secret, relayHttpPort, relayWsPort, relayWsBrowserPort, asked: proxy.asked };

    await drive({ name: "served at " + PREFIX, slug: "path", advert: `http://127.0.0.1:${proxy.port}${PREFIX}`, throughProxy: true }, opts);
    await drive({ name: "advertised with a trailing slash", slug: "slash", advert: `http://127.0.0.1:${proxy.port}${PREFIX}/`, throughProxy: true }, opts);
    await drive({ name: "bare host and port", slug: "bare", advert: `http://127.0.0.1:${relayHttpPort}`, throughProxy: false }, opts);

    if (failures === 0) {
      console.log("PASS: a relay served on a path is shared to with the URL its console advertised - the pairing call arrives as POST " + PREFIX + "/sessions, the socket connects, and a turn streams to a paired browser; a bare host and port advert still works unchanged");
    }
  } finally {
    proxy.srv.close();
    relay.kill();
    consoleStub.close();
    if (!process.env.DEBUG_KEEP) {
      fs.rmSync(scratch, { recursive: true, force: true });
    } else {
      console.error("stack scratch kept at " + scratch);
    }
  }

  if (failures > 0) {
    console.error(failures + " check(s) failed");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exitCode = 1;
});
