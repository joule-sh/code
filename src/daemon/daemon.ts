import { loadConfig, loadServerOrigin } from "../providers/config.ts";
import { rememberSecret } from "../tools/dispatch.ts";
import { liveApiKey } from "../providers/openai.ts";
import { loadCredential } from "../auth/credentials.ts";
import { displayModel } from "../providers/platform.ts";
import { allToolSchemas } from "../tools/schemas.ts";
import { ToolsRegistry } from "../tools/registry.ts";
import { Gate } from "../approval/gate.ts";
import { emitApprovalSettled } from "../approval/settled_frame.ts";
import { Session } from "../session/session.ts";
import { Message, Provider, ToolRegistry, ApprovalGate } from "../session/types.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest, frameType, TURN_START, TURN_END, decodeTurnStart } from "../protocol/frames.ts";
import { loadWorkspaceInstructions } from "../session/project_instructions.ts";
import { startupSkillsText } from "../terminal/skills_ui.ts";
import { loadWorkspaceSession, saveWorkspaceSession, describeSessionSuffix } from "../session/persistence.ts";
import { ensureScratchDir, scratchContextNote } from "../session/scratch.ts";
import { startupMemoryText } from "../terminal/memory_ui.ts";
import { TaskManager } from "../tasks/manager.ts";
import { wireForegroundRunner } from "../tools/run_foreground.ts";
import { TaskRunner } from "../tasks/types.ts";
import { SessionWorker } from "./session_worker.ts";
import { RelayUplink } from "./relay_uplink.ts";
import { appendBroadcast, startBroadcastLog } from "./broadcast.ts";
import { logDaemon, describeFrame } from "./daemon_log.ts";
import { runDaemonWebSocket } from "./connection.ts";
import { sweepInbox } from "./inbox.ts";
import { inboxDir } from "./paths.ts";
import { daemonStartup, runtimeDirChoice, RUNTIME_DIR_ENV } from "./startup.ts";
import { writeDaemonInfo, removeDaemonInfo } from "./lifecycle.ts";
import { VERSION } from "../version.ts";
import { envOr, workspaceRoot as currentWorkspaceRoot } from "../vendor/platform/platform.ts";

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
  let raw = envOr(name, "");
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

// The runtime directory the daemon was told to use, or the derived one, made
// on disk. An operator-supplied path is the one that can fail here - a
// directory under something read-only, or one whose parent does not exist -
// and it fails before the broadcast log is touched, so the message names the
// directory rather than leaving startBroadcastLog to report that it could not
// clear a file in a directory that was never there.
function makeRuntimeDir(runtimeDir: string): string {
  try {
    fs.mkdirSync(runtimeDir, true);
    fs.mkdirSync(inboxDir(runtimeDir), true);
  } catch {
    return "could not create the runtime directory " + runtimeDir;
  }
  if (!fs.existsSync(inboxDir(runtimeDir))) {
    return "could not create the runtime directory " + runtimeDir;
  }
  return "";
}

export function runDaemon(argv: string[], workspaceRoot: string, sessionName: string, port: int): void {
  let startup = daemonStartup(argv);
  if (startup.error != "") {
    console.log(startup.error);
    process.exit(1);
    return;
  }

  let cfg = loadConfig(argv);
  // The redactor is told the key this session actually resolved, so a key
  // that came from config.json or a key file - neither of which puts it in
  // the environment - is scrubbed from tool output like an env-borne one.
  rememberSecret(liveApiKey(cfg.apiKey));
  if (cfg.apiKey == "") {
    console.log("joule-daemon: no credentials configured, run joule once interactively first");
    process.exit(1);
    return;
  }

  let dirChoice = runtimeDirChoice(envOr(RUNTIME_DIR_ENV, ""), workspaceRoot, sessionName);
  if (dirChoice.error != "") {
    console.log(dirChoice.error);
    process.exit(1);
    return;
  }
  let runtimeDir = dirChoice.dir;
  let dirProblem = makeRuntimeDir(runtimeDir);
  if (dirProblem != "") {
    console.log("joule-daemon: " + dirProblem + " - nothing could reach this daemon's inbox or broadcast log, so it is not starting");
    process.exit(1);
    return;
  }
  sweepInbox(runtimeDir);
  let logCleared = startBroadcastLog(runtimeDir);
  if (logCleared != "") {
    console.log("joule-daemon: " + logCleared + " - a client joining would be replayed a previous session, so this daemon is not starting");
    process.exit(1);
    return;
  }

  let server = loadServerOrigin(argv);
  let credential = loadCredential(server.base);
  let platformScopes = "";
  let registry = new ToolsRegistry(workspaceRoot);
  if (credential.secret != "") {
    registry.setPlatformAccess(server.base, credential);
    platformScopes = credential.scopes;
  }
  let tools: ToolRegistry = { run: (t: string, a: string) => registry.dispatch(t, a) };

  let tracker = new TurnTracker();
  let watch = new CancelWatch();
  let live = new LiveProvider(cfg, allToolSchemas(platformScopes), watch, STDIN_FD, tracker);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => live.ask(h, d) };

  let sessionBox = new SessionBox();

  let onApprovalRequest = (callId: string, tool: string, summary: string, args: string) => {
    if (sessionBox.items.length == 0) { return; }
    let s = sessionBox.items[0];
    let f: ApprovalRequestFrame = { v: PROTOCOL_VERSION, seq: s.takeSeq(), type: APPROVAL_REQUEST, turnId: tracker.current, callId: callId, tool: tool, summary: summary, detail: args, args: args };
    s.emit(encodeApprovalRequest(f));
  };

  let gate = new Gate(startup.mode, APPROVAL_TIMEOUT_MS, workspaceRoot, onApprovalRequest, () => {});
  gate.setOnAutoAllowed((callId: string, tool: string, summary: string, args: string) => emitApprovalSettled(sessionBox.items, tracker.current, callId, summary, args));
  let approval: ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string) => gate.check(callId, tool, summary, args) };

  let session = new Session(workspaceRoot, "agent", provider, tools, approval);
  session.injectSystemContext(loadWorkspaceInstructions(workspaceRoot));
  session.injectSystemContext(startupSkillsText(workspaceRoot));
  session.injectSystemContext(startupMemoryText());
  let scratchRel = ensureScratchDir(workspaceRoot, sessionName);
  session.injectSystemContext(scratchContextNote(scratchRel));
  let resumeRequested = (envOr("JOULE_DAEMON_RESUME", "")) == "1";
  if (resumeRequested) {
    let prior = loadWorkspaceSession(workspaceRoot, sessionName);
    if (prior != null) { session.history = prior.history; }
  }
  sessionBox.set(session);
  live.setSession(session);

  let tasks = new TaskManager(workspaceRoot, cfg, () => gate.mode, scratchRel);
  let taskRunner: TaskRunner = {
    startBackgroundRun: (command: string) => tasks.startBackgroundRun(command),
    startSubagent: (task: string, steps: int, report: string) => tasks.startSubagent(task, steps, report),
    startPipeline: (args: string) => tasks.runPipeline(args, session),
    taskStatus: (id: string) => tasks.taskStatus(id),
  };
  registry.setTaskRunner(taskRunner);
  wireForegroundRunner(registry);

  let worker = new SessionWorker(runtimeDir, session, gate, live, tasks);

  let uplink = new RelayUplink(runtimeDir, argv);
  worker.setRelayUplink(uplink.asShareController());

  gate.setOnPoll(() => { worker.pollForApproval(); });

  session.subscribe((frameJson: string) => {
    let undelivered = appendBroadcast(runtimeDir, frameJson);
    if (undelivered != "") { logDaemon("no attached client will see " + describeFrame(frameJson) + ": " + undelivered); }
    worker.pumpRelayUplink();
    if (frameType(frameJson) == TURN_START) {
      let f = decodeTurnStart(frameJson);
      if (f != null) { tracker.setCurrent(f.turnId); }
    }
    if (frameType(frameJson) == TURN_END) {
      saveWorkspaceSession(workspaceRoot, sessionName, session.history);
    }
  });

  let hello: SessionHelloFrame = {
    v: PROTOCOL_VERSION, seq: session.takeSeq(), type: SESSION_HELLO,
    sessionId: "daemon-" + `${port}`, workspace: workspaceRoot, session: sessionName, model: displayModel(cfg),
    mode: gate.mode, protocol: PROTOCOL_VERSION, build: VERSION,
  };
  let helloUndelivered = appendBroadcast(runtimeDir, encodeSessionHello(hello));
  if (helloUndelivered != "") {
    console.log("joule-daemon: " + helloUndelivered + " - no attached client could ever be sent a frame, so this daemon is not starting");
    process.exit(1);
    return;
  }

  writeDaemonInfo(workspaceRoot, sessionName, port);
  console.log("joule-daemon " + VERSION + ": workspace " + workspaceRoot + describeSessionSuffix(sessionName) + ", listening on 127.0.0.1:" + `${port}` + ", mode " + gate.mode);

  Worker.run(() => { runDaemonWebSocket(port, runtimeDir); return 0; });
  // A task named on the command line runs as if it had arrived as an input
  // frame, before the loop starts draining the inbox - the same ordering
  // terminal.ts uses for --prompt, and the reason an unattended daemon needs
  // no client at all to do one piece of work.
  if (startup.prompt != "") { worker.runInitialPrompt(startup.prompt); }
  worker.loop();
  uplink.stop();
  removeDaemonInfo(workspaceRoot, sessionName);
  console.log("joule-daemon: stopped");
  process.exit(0);
}

export function runDaemonMain(): void {
  let argv = currentArgvForDaemon();
  let workspaceRoot = currentWorkspaceRoot();
  let sessionName = envOr("JOULE_SESSION_NAME", "");
  let port = envPort("JOULE_DAEMON_PORT", 8199);
  runDaemon(argv, workspaceRoot, sessionName, port);
}
