// #139 spike: the real, intended daemon wiring -- Session, Gate, LiveProvider,
// ToolsRegistry and TaskManager constructed exactly the way
// src/terminal/terminal.ts already constructs them, served over
// src/daemon/daemon_ws.ts's websocket accept loop instead of a tty.
//
// This file does not currently compile. Importing ToolsRegistry (tools/
// registry.ts) into the same compilation unit as vendor/websocket/server.ts
// alongside Session/Gate/LiveProvider fails native codegen with "ambiguous
// reference" -- filed as lumen-lang-org/lumen#29 with a minimal repro. Left
// in the tree deliberately, not deleted or worked around, so the shape of
// the real daemon is visible rather than only its stub. See
// src/daemon/daemon_live_demo.ts for the version that actually compiles and
// runs today (real Session/Gate/LiveProvider, stubbed tool dispatch) and
// docs/03-daemon-spike.md for the full writeup.

import { loadConfig } from "../providers/config.ts";
import { allToolSchemas } from "../tools/schemas.ts";
import { ToolsRegistry } from "../tools/registry.ts";
import { Gate, MODE_AUTO_EDIT } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { Message, Provider, ToolRegistry, ApprovalGate } from "../session/types.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest, frameType, TURN_END } from "../protocol/frames.ts";
import { loadProjectInstructions } from "../session/project_instructions.ts";
import { loadWorkspaceSession, saveWorkspaceSession } from "../session/persistence.ts";
import { startupMemoryText } from "../terminal/memory_ui.ts";
import { TaskManager } from "../tasks/manager.ts";
import { wireForegroundRunner } from "../tools/run_foreground.ts";
import { TaskRunner } from "../tasks/types.ts";
import { RelayInputBridge } from "../terminal/relay_bridge.ts";
import { DaemonStore } from "./daemon_store.ts";
import { StorePair, GatePair, DaemonContext, runDaemonWebSocket } from "./daemon_ws.ts";
import { writeDaemonInfo } from "./lifecycle.ts";
import { VERSION } from "../version.ts";

const STDIN_FD: int = 0;
const TASK_POLL_MS: int = 200;

function envPort(name: string, fallback: int): int {
  let raw = process.env(name) ?? "";
  return Number.parseInt(raw, 10) ?? fallback;
}

function currentArgvForDaemon(): string[] {
  let result: string[] = [];
  let i = 0;
  while (i < argsCount()) {
    result.push(arg(i));
    i = i + 1;
  }
  return result;
}

const PORT: int = envPort("JOULE_DAEMON_PORT", 8199);

let workspaceRoot: string = process.cwd();
let daemonStore: DaemonStore = new DaemonStore();
let sessionSlot: Session[] = [];
let gateSlot: Gate[] = [];
let taskSlot: TaskManager[] = [];
let ctxSlot: DaemonContext[] = [];

function onApprovalRequest(callId: string, tool: string, summary: string, args: string): void {
  if (sessionSlot.length == 0) { return; }
  let s = sessionSlot[0];
  let frame: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: s.takeSeq(), type: APPROVAL_REQUEST, turnId: "", callId: callId, tool: tool, summary: summary, detail: args, args: args };
  s.emit(encodeApprovalRequest(frame));
}

function onApprovalPoll(): void {
  // No keyboard to read in a daemon; a client's approval.reply arrives as an
  // ordinary inbound frame on whatever connection thread delivers it, handled
  // by daemon_ws.ts's dispatchInboundFrame, not from this poll callback.
}

function runTaskPollLoop(): int {
  while (true) {
    if (taskSlot.length > 0 && sessionSlot.length > 0) {
      taskSlot[0].poll(sessionSlot[0]);
    }
    process.sleep(TASK_POLL_MS);
  }
  return 0;
}

export function runDaemon(argv: string[]): void {
  let cfg = loadConfig(argv);
  if (cfg.apiKey == "") {
    console.log("joule-daemon: no credentials configured, run `joule` once interactively first");
    process.exit(1);
    return;
  }

  let registry = new ToolsRegistry(workspaceRoot);
  let tools: ToolRegistry = { run: (t: string, a: string) => registry.dispatch(t, a) };

  let tracker = new TurnTracker();
  let watch = new CancelWatch();
  let live = new LiveProvider(cfg, allToolSchemas(), watch, STDIN_FD, tracker);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => live.ask(h, d) };

  let g = new Gate(MODE_AUTO_EDIT, 120000, workspaceRoot, onApprovalRequest, onApprovalPoll);
  gateSlot = [g];
  let approval: ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string) => g.check(callId, tool, summary, args) };

  let s = new Session(workspaceRoot, "agent", provider, tools, approval);
  s.injectSystemContext(loadProjectInstructions(workspaceRoot));
  s.injectSystemContext(startupMemoryText());
  let priorFile = loadWorkspaceSession(workspaceRoot);
  if (priorFile != null) { s.history = priorFile.history; }
  sessionSlot = [s];
  live.setSession(s);

  let tm = new TaskManager(workspaceRoot, cfg, () => g.mode);
  taskSlot = [tm];
  let taskRunner: TaskRunner = {
    startBackgroundRun: (command: string) => tm.startBackgroundRun(command),
    startSubagent: (task: string) => tm.startSubagent(task),
    taskStatus: (id: string) => tm.taskStatus(id),
  };
  registry.setTaskRunner(taskRunner);
  wireForegroundRunner(registry);

  s.subscribe((frameJson: string) => {
    daemonStore.record(frameJson);
    daemonStore.broadcast(frameJson);
    if (frameType(frameJson) == TURN_END) {
      saveWorkspaceSession(workspaceRoot, s.history);
    }
  });

  let hello: SessionHelloFrame = {
    v: PROTOCOL_VERSION, seq: s.takeSeq(), type: SESSION_HELLO,
    sessionId: "daemon-" + `${PORT}`, workspace: workspaceRoot, model: cfg.model,
    mode: s.mode, protocol: PROTOCOL_VERSION,
  };
  daemonStore.record(encodeSessionHello(hello));

  writeDaemonInfo(workspaceRoot, PORT);
  console.log("joule-daemon " + VERSION + ": workspace " + workspaceRoot + ", listening on 127.0.0.1:" + `${PORT}`);

  let bridge = new RelayInputBridge();
  let sp: StorePair = { store: daemonStore, session: s };
  let gp: GatePair = { gate: g, bridge: bridge };
  ctxSlot = [{ sp: sp, gp: gp }];
}

// The accept loop is its own top-level, near-empty function rather than the
// last statement of runDaemon() -- see docs/03-daemon-spike.md for why that
// mattered while chasing lumen#29 (it did not end up being the fix, but it
// is kept this way because it mirrors src/relay/relay.ts's own shape, where
// the equivalent blocking call is also the last statement of a function with
// almost nothing else live in it).
function startAccepting(): void {
  runDaemonWebSocket(PORT, ctxSlot[0]);
}

runDaemon(currentArgvForDaemon());
Worker.run(runTaskPollLoop);
startAccepting();
