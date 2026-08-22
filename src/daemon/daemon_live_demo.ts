// Working evidence for #139 Q1/Q2: the real Session + Gate + LiveProvider,
// served over a real websocket accept loop, in one compiling binary. Tool
// dispatch is stubbed (see docs/03-daemon-spike.md and lumen-lang-org/lumen#29)
// because the real ToolsRegistry/dispatchCoreTool wiring currently fails
// native codegen the moment it joins this same compilation unit -- a filed
// compiler bug, not a design gap in this spike. Everything else here is the
// real production code: real Session, real Gate (including the ~120s
// approval-wait poll loop), real LiveProvider talking to a real model
// endpoint, real frame encode/decode, real websocket transport.
import { Session } from "../session/session.ts";
import { Message, Provider, ProviderReply, ToolRegistry, ToolResult, ApprovalGate, ApprovalDecision } from "../session/types.ts";
import { Peer, send, serveWebSocket } from "../vendor/websocket/server.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { loadConfig } from "../providers/config.ts";
import { Gate, MODE_AUTO_EDIT } from "../approval/gate.ts";
import { RESUME, decodeResume, frameType, PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest } from "../protocol/frames.ts";
import { RelayInputBridge, dispatchInboundFrame } from "../terminal/relay_bridge.ts";

function envPort(name: string, fallback: int): int {
  let raw = process.env(name) ?? "";
  return Number.parseInt(raw, 10) ?? fallback;
}
function currentArgvForDemo(): string[] {
  let result: string[] = [];
  let i = 0;
  while (i < argsCount()) { result.push(arg(i)); i = i + 1; }
  return result;
}

const PORT: int = envPort("JOULE_DAEMON_PORT", 8199);
const WORKSPACE: string = "/tmp/daemon-demo-workspace";

let peers: Peer[] = [];
let sessionSlot: Session[] = [];
let gateSlot: Gate[] = [];

function stubToolRun(t: string, a: string): ToolResult {
  return { ok: true, output: "stub tool ran: " + t + " " + a, truncated: false };
}

function onApprovalRequest(callId: string, tool: string, summary: string, args: string): void {
  if (sessionSlot.length == 0) { return; }
  let s = sessionSlot[0];
  let frame: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: s.takeSeq(), type: APPROVAL_REQUEST, turnId: "", callId: callId, tool: tool, summary: summary, detail: args, args: args };
  s.emit(encodeApprovalRequest(frame));
}

function onApprovalPoll(): void {
}

function broadcastFrame(frameJson: string): void {
  for (const p of peers) {
    if (p.open) { send(p, frameJson); }
  }
}

function onMessage(peer: Peer, message: string): void {
  let t = frameType(message);
  if (t == RESUME) {
    peers.push(peer);
    let resume = decodeResume(message);
    if (sessionSlot.length > 0) {
      let s = sessionSlot[0];
      let hello: SessionHelloFrame = { v: PROTOCOL_VERSION, seq: s.takeSeq(), type: SESSION_HELLO, sessionId: "demo", workspace: WORKSPACE, model: "", mode: s.mode, protocol: PROTOCOL_VERSION };
      send(peer, encodeSessionHello(hello));
    }
    return;
  }
  if (sessionSlot.length == 0 || gateSlot.length == 0) { return; }
  let bridge = new RelayInputBridge();
  dispatchInboundFrame(sessionSlot[0], gateSlot[0], bridge, message);
}

function onClose(peer: Peer, graceful: bool): void {
  if (peer.path == "" && graceful) { return; }
}

export function runDemo(argv: string[]): void {
  let cfg = loadConfig(argv);
  let tracker = new TurnTracker();
  let watch = new CancelWatch();
  let live = new LiveProvider(cfg, [], watch, 0, tracker);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => live.ask(h, d) };
  let tools: ToolRegistry = { run: stubToolRun };
  let g = new Gate(MODE_AUTO_EDIT, 60000, WORKSPACE, onApprovalRequest, onApprovalPoll);
  gateSlot = [g];
  let approval: ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string) => g.check(callId, tool, summary, args) };
  let s = new Session(WORKSPACE, "agent", provider, tools, approval);
  sessionSlot = [s];
  live.setSession(s);

  s.subscribe(broadcastFrame);

  let hello: SessionHelloFrame = { v: PROTOCOL_VERSION, seq: s.takeSeq(), type: SESSION_HELLO, sessionId: "demo", workspace: WORKSPACE, model: cfg.model, mode: s.mode, protocol: PROTOCOL_VERSION };
  console.log(encodeSessionHello(hello));
  console.log("daemon-live-demo listening on 127.0.0.1:" + `${PORT}`);
}

runDemo(currentArgvForDemo());
serveWebSocket(PORT, onMessage, onClose);
