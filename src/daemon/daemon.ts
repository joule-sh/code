import { loadConfig } from "../providers/config.ts";
import { allToolSchemas } from "../tools/schemas.ts";
import { ToolsRegistry } from "../tools/registry.ts";
import { Gate, MODE_AUTO_EDIT } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { Message, Provider, ToolRegistry, ApprovalGate } from "../session/types.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest, frameType, TURN_START, TURN_END, decodeTurnStart } from "../protocol/frames.ts";
import { loadProjectInstructions } from "../session/project_instructions.ts";
import { loadWorkspaceSession, saveWorkspaceSession } from "../session/persistence.ts";
import { startupMemoryText } from "../terminal/memory_ui.ts";
import { TaskManager } from "../tasks/manager.ts";
import { wireForegroundRunner } from "../tools/run_foreground.ts";
import { TaskRunner } from "../tasks/types.ts";
import { SessionWorker } from "./session_worker.ts";
import { RelayUplink } from "./relay_uplink.ts";
import { loadRelayConfig } from "../relay/client_logic.ts";
import { appendBroadcast } from "./broadcast.ts";
import { runDaemonWebSocket } from "./connection.ts";
import { inboxDir, daemonRuntimeDir } from "./paths.ts";
import { writeDaemonInfo, removeDaemonInfo } from "./lifecycle.ts";
import { VERSION } from "../version.ts";

const STDIN_FD: int = 0;
const APPROVAL_TIMEOUT_MS: int = 120000;

class SessionBox {
  items: Session[];
  constructor() {
    this.items = [];
  }
  set(session: Session): void {
    this.items = [session];
  }
}

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

export function runDaemon(argv: string[], workspaceRoot: string, port: int): void {
  let cfg = loadConfig(argv);
  if (cfg.apiKey == "") {
    console.log("joule-daemon: no credentials configured, run joule once interactively first");
    process.exit(1);
    return;
  }

  let runtimeDir = daemonRuntimeDir(workspaceRoot);
  fs.mkdirSync(runtimeDir, true);
  fs.mkdirSync(inboxDir(runtimeDir), true);

  let registry = new ToolsRegistry(workspaceRoot);
  let tools: ToolRegistry = { run: (t: string, a: string) => registry.dispatch(t, a) };

  let tracker = new TurnTracker();
  let watch = new CancelWatch();
  let live = new LiveProvider(cfg, allToolSchemas(), watch, STDIN_FD, tracker);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => live.ask(h, d) };

  let sessionBox = new SessionBox();

  let onApprovalRequest = (callId: string, tool: string, summary: string, args: string) => {
    if (sessionBox.items.length == 0) { return; }
    let s = sessionBox.items[0];
    let f: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: s.takeSeq(), type: APPROVAL_REQUEST, turnId: tracker.current, callId: callId, tool: tool, summary: summary, detail: args, args: args };
    s.emit(encodeApprovalRequest(f));
  };

  let gate = new Gate(MODE_AUTO_EDIT, APPROVAL_TIMEOUT_MS, workspaceRoot, onApprovalRequest, () => {});
  let approval: ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string) => gate.check(callId, tool, summary, args) };

  let session = new Session(workspaceRoot, "agent", provider, tools, approval);
  session.injectSystemContext(loadProjectInstructions(workspaceRoot));
  session.injectSystemContext(startupMemoryText());
  let resumeRequested = (process.env("JOULE_DAEMON_RESUME") ?? "") == "1";
  if (resumeRequested) {
    let prior = loadWorkspaceSession(workspaceRoot);
    if (prior != null) { session.history = prior.history; }
  }
  sessionBox.set(session);
  live.setSession(session);

  let tasks = new TaskManager(workspaceRoot, cfg, () => gate.mode);
  let taskRunner: TaskRunner = {
    startBackgroundRun: (command: string) => tasks.startBackgroundRun(command),
    startSubagent: (task: string) => tasks.startSubagent(task),
    taskStatus: (id: string) => tasks.taskStatus(id),
  };
  registry.setTaskRunner(taskRunner);
  wireForegroundRunner(registry);

  let worker = new SessionWorker(runtimeDir, session, gate, live, tasks);

  let relayCfg = loadRelayConfig();
  let uplink = new RelayUplink(relayCfg.host, relayCfg.httpPort, relayCfg.wsPort, relayCfg.webBaseUrl, relayCfg.tmpDir, runtimeDir);
  worker.setRelayUplink(uplink.asShareController());

  gate.setOnPoll(() => { worker.pollForApproval(); });

  session.subscribe((frameJson: string) => {
    appendBroadcast(runtimeDir, frameJson);
    if (frameType(frameJson) == TURN_START) {
      let f = decodeTurnStart(frameJson);
      if (f != null) { tracker.setCurrent(f.turnId); }
    }
    if (frameType(frameJson) == TURN_END) {
      saveWorkspaceSession(workspaceRoot, session.history);
    }
  });

  let hello: SessionHelloFrame = {
    v: PROTOCOL_VERSION, seq: session.takeSeq(), type: SESSION_HELLO,
    sessionId: "daemon-" + `${port}`, workspace: workspaceRoot, model: cfg.model,
    mode: gate.mode, protocol: PROTOCOL_VERSION,
  };
  appendBroadcast(runtimeDir, encodeSessionHello(hello));

  writeDaemonInfo(workspaceRoot, port);
  console.log("joule-daemon " + VERSION + ": workspace " + workspaceRoot + ", listening on 127.0.0.1:" + `${port}`);

  Worker.run(() => { runDaemonWebSocket(port, runtimeDir); return 0; });
  worker.loop();
  removeDaemonInfo(workspaceRoot);
  console.log("joule-daemon: stopped");
  process.exit(0);
}

export function runDaemonMain(): void {
  let argv = currentArgvForDaemon();
  let workspaceRoot = process.cwd();
  let port = envPort("JOULE_DAEMON_PORT", 8199);
  runDaemon(argv, workspaceRoot, port);
}
