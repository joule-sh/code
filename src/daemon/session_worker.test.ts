import { Session } from "../session/session.ts";
import { Gate, MODE_AUTO_EDIT } from "../approval/gate.ts";
import { Message, ProviderReply, Provider, ToolResult, ToolRegistry, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { LiveProvider, CancelWatch, TurnTracker } from "../providers/live.ts";
import { TaskManager } from "../tasks/manager.ts";
import { RelayInputBridge } from "../terminal/relay_bridge.ts";
import { SessionWorker } from "./session_worker.ts";
import { ShareController, ShareResult } from "./share_controller.ts";
import { inboxDir } from "./paths.ts";
import { appendInbound } from "./inbox.ts";
import { PROTOCOL_VERSION, DaemonStopFrame, encodeDaemonStop, ShareRequestFrame, encodeShareRequest, frameType, SHARE_FAILED } from "../protocol/frames.ts";

class Echoer {
  run(tool: string, args: string): ToolResult {
    let r: ToolResult = { ok: true, output: "", truncated: false };
    return r;
  }
}

class FrameCapture {
  frames: string[];
  constructor() { this.frames = []; }
  add(frameJson: string): void { this.frames.push(frameJson); }
}

class EchoProvider {
  ask(history: Message[], onDelta: (text: string) => void): ProviderReply {
    let r: ProviderReply = { text: "ok", calls: [], failed: false, errorCode: "", errorMessage: "", tokens: 0 };
    return r;
  }
}

function allowAll(): ApprovalGate {
  return { check: (callId: string, tool: string, summary: string, args: string): ApprovalDecision => {
    let d: ApprovalDecision = { allow: true };
    return d;
  } };
}

function newSession(): Session {
  let ep = new EchoProvider();
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => ep.ask(h, d) };
  let echoer = new Echoer();
  let tools: ToolRegistry = { run: (t: string, a: string) => echoer.run(t, a) };
  return new Session("/repo", "agent", provider, tools, allowAll());
}

function newWorker(runtimeDir: string): SessionWorker {
  let session = newSession();
  let gate = new Gate(MODE_AUTO_EDIT, 1000, "/repo", (c: string, t: string, s: string, a: string) => {}, () => {});
  let live = new LiveProvider({ baseUrl: "http://x", model: "m", apiKey: "k" }, [], new CancelWatch(), -1, new TurnTracker());
  let tasks = new TaskManager("/repo", { baseUrl: "http://x", model: "m", apiKey: "k" }, () => "auto-edit");
  return new SessionWorker(runtimeDir, session, gate, live, tasks);
}

function freshRuntimeDir(name: string): string {
  let dir = "/tmp/daemon-session-worker-test-" + name;
  if (fs.existsSync(dir)) { fs.rmSync(dir, true); }
  fs.mkdirSync(inboxDir(dir), true);
  return dir;
}

function fakeUplink(): ShareController {
  return {
    ensureStarted: (workspaceRoot: string, model: string) => {
      let r: ShareResult = { ok: true, code: "ABCDEF", url: "https://console.example.com/terminal/sessions?code=ABCDEF", error: "" };
      return r;
    },
    pump: () => {},
    tick: (session: Session, gate: Gate, bridge: RelayInputBridge) => {},
  };
}

class UplinkCalls {
  pumps: int;
  ticks: int;
  constructor() {
    this.pumps = 0;
    this.ticks = 0;
  }
  notePump(): void {
    this.pumps = this.pumps + 1;
  }
  noteTick(): void {
    this.ticks = this.ticks + 1;
  }
  asController(): ShareController {
    return {
      ensureStarted: (workspaceRoot: string, model: string) => {
        let r: ShareResult = { ok: true, code: "ABCDEF", url: "", error: "" };
        return r;
      },
      pump: () => this.notePump(),
      tick: (session: Session, gate: Gate, bridge: RelayInputBridge) => this.noteTick(),
    };
  }
}

test("a fresh worker is not stopping", () => {
  let worker = newWorker(freshRuntimeDir("fresh"));
  expect(!worker.shouldStop());
  expect(worker.running);
});

test("requestStop with zero grace makes shouldStop true right away", () => {
  let worker = newWorker(freshRuntimeDir("zero-grace"));
  worker.requestStop(0);
  expect(worker.shouldStop());
});

test("requestStop with a positive grace does not stop immediately", () => {
  let worker = newWorker(freshRuntimeDir("graced"));
  worker.requestStop(60000);
  expect(!worker.shouldStop());
});

test("requestStop only latches the first deadline it is given", () => {
  let worker = newWorker(freshRuntimeDir("latch"));
  worker.requestStop(0);
  let firstDeadline = worker.stopAt;
  worker.requestStop(60000);
  expect(worker.stopAt == firstDeadline);
});

test("stop() ends the loop immediately regardless of grace", () => {
  let worker = newWorker(freshRuntimeDir("stop-now"));
  worker.stop();
  expect(!worker.running);
});

test("drainOnce sees a daemon.stop frame from the inbox and requests a stop", () => {
  let dir = freshRuntimeDir("drain-stop");
  let worker = newWorker(dir);
  let f: DaemonStopFrame = { v: PROTOCOL_VERSION, seq: 0, type: "daemon.stop" };
  appendInbound(dir, "conn-a", encodeDaemonStop(f));
  worker.drainOnce();
  expect(worker.stopAt != 0);
});

test("drainOnce does not request a stop for an ordinary input frame", () => {
  let dir = freshRuntimeDir("drain-input");
  let worker = newWorker(dir);
  appendInbound(dir, "conn-a", "{\"v\":1,\"seq\":0,\"type\":\"input\",\"text\":\"hi\"}");
  worker.drainOnce();
  expect(worker.stopAt == 0);
});

test("a fresh worker has no relay uplink until one is set", () => {
  let worker = newWorker(freshRuntimeDir("no-uplink"));
  expect(worker.currentUplink() == null);
});

test("setRelayUplink makes currentUplink return it", () => {
  let worker = newWorker(freshRuntimeDir("set-uplink"));
  worker.setRelayUplink(fakeUplink());
  expect(worker.currentUplink() != null);
});

test("pollForApproval drains the inbox without touching task polling, and tolerates no uplink", () => {
  let dir = freshRuntimeDir("poll-for-approval");
  let worker = newWorker(dir);
  appendInbound(dir, "conn-a", "{\"v\":1,\"seq\":0,\"type\":\"input\",\"text\":\"hi\"}");
  worker.pollForApproval();
  expect(worker.stopAt == 0);
});

test("a share.request with no uplink set answers share.failed rather than crashing", () => {
  let dir = freshRuntimeDir("drain-share-no-uplink");
  let worker = newWorker(dir);
  let cap = new FrameCapture();
  worker.session.subscribe((f: string) => cap.add(f));

  let f: ShareRequestFrame = { v: PROTOCOL_VERSION, seq: 0, type: "share.request" };
  appendInbound(dir, "conn-a", encodeShareRequest(f));
  worker.drainOnce();

  expect(cap.frames.length > 0);
  expect(frameType(cap.frames[cap.frames.length - 1]) == SHARE_FAILED);
});

test("pumpRelayUplink pushes the uplink on its own, without waiting for a tick", () => {
  let worker = newWorker(freshRuntimeDir("pump-uplink"));
  let calls = new UplinkCalls();
  worker.setRelayUplink(calls.asController());

  worker.pumpRelayUplink();
  worker.pumpRelayUplink();

  expect(calls.pumps == 2);
  expect(calls.ticks == 0);
});

test("pumpRelayUplink with no uplink set does nothing rather than crashing", () => {
  let worker = newWorker(freshRuntimeDir("pump-no-uplink"));
  worker.pumpRelayUplink();
  expect(worker.currentUplink() == null);
});

test("a turn's frames each push the uplink as they are emitted, not once the turn is over", () => {
  let worker = newWorker(freshRuntimeDir("pump-per-frame"));
  let calls = new UplinkCalls();
  worker.setRelayUplink(calls.asController());
  worker.session.subscribe((frameJson: string) => { worker.pumpRelayUplink(); });

  let before = calls.pumps;
  worker.session.submit("say something");

  expect(calls.pumps > before + 1);
  expect(calls.ticks == 0);
});
