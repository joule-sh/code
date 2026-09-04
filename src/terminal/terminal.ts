import { isatty, rawEnable, rawDisable, readKey, readKeyTimeout, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_CTRL_O, KEY_EOF, KEY_TIMEOUT, KEY_ARROW_UP, KEY_ARROW_DOWN, KEY_ARROW_RIGHT, KEY_TAB, KEY_BACKTAB } from "../vendor/tty/tty.ts";
import { rememberSecret } from "../tools/dispatch.ts";
import { liveApiKey } from "../providers/openai.ts";
import { loadConfig, loadServerOrigin } from "../providers/config.ts";
import { loadCredential } from "../auth/credentials.ts";
import { sessionNameFlag, runningSessionsFor } from "../daemon/attach_lifecycle.ts";
import { displayModel, qualifiedModel, wireModel } from "../providers/platform.ts";
import { runOnboarding } from "./onboarding.ts";
import { allToolSchemas } from "../tools/schemas.ts";
import { ToolsRegistry } from "../tools/registry.ts";
import { Gate, MODE_SAFE_AUTO, MODE_PLAN } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { Message, Provider, ToolRegistry, ApprovalGate } from "../session/types.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { PROTOCOL_VERSION, frameType, frameTurnId, decodeTurnStart, TURN_START, TURN_END, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest } from "../protocol/frames.ts";
import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SESSION, CMD_RENAME, CMD_SHARE, CMD_LOGIN, CMD_LOGOUT, CMD_CAT, CMD_TASKS, CMD_MEMORY, CMD_SKILLS, CMD_MOUSE, CMD_COLOR, CMD_CLEAR, CMD_EXIT, CMD_UNKNOWN, CMD_NONE } from "./commands.ts";
import { applyConfiguredAccent, runColorCommand } from "./color_ui.ts";
import { catText } from "./cat.ts";
import { SignIn, beginSignIn, submitSignIn, cancelSignIn, logoutText } from "./login_ui.ts";
import { memoryCommandText, startupMemoryText } from "./memory_ui.ts";
import { ensureScratchDir, scratchContextNote } from "../session/scratch.ts";
import { loadWorkspaceInstructions } from "../session/project_instructions.ts";
import { startupSkillsText, skillsStartupNote, runSkillCommand } from "./skills_ui.ts";
import { workspaceRoot as currentWorkspaceRoot } from "../vendor/platform/platform.ts";
import { InputLine, InputHistory, PendingApproval, PendingUpdateOffer, PendingPlanDecision, PendingModelPick, PendingQuitDecision, PendingSessionPick, quitDecisionOptionForChar, QUIT_DECISION_KEEP, QUIT_DECISION_QUIT, QUIT_DECISION_STAY, approvalOptionForChar, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { fetchModelIds, buildModelEntries, openModelPick, tryHandleModelPickArrow, tryHandleModelPickEnter, tryHandleModelPickChar } from "./model_picker.ts";
import { openQuitDecision, repaintQuitDecision, detachToBackground } from "./quit_decision.ts";
import { openSessionPick, repaintSessionPick, tryHandleSessionPickArrow, tryHandleSessionPickChar, currentSessionLine, stayingNote, switchSessionNotes, pickableSessions } from "./session_switch.ts";
import { renameTargetCheck, renameNotes } from "./session_rename.ts";
import { modeFlagResult, promptFlag } from "./startup_flags.ts";
import { ApprovalDeps, emitApprovalRequest, pollApprovalKeys } from "./terminal_approval.ts";
import { LocalCommandDeps, runLocalCommand } from "./terminal_commands.ts";
import { Scrollback } from "./scrollback.ts";
import { repaintApprovalOptions, answerApproval, denyPendingApproval, reportIfResolvedElsewhere } from "./approval_ui.ts";
import { noteApprovalBlock } from "./approval_settled.ts";
import { emitApprovalSettled } from "../approval/settled_frame.ts";
import { stylePrompt, styleBanner } from "./style.ts";
import { buildWelcomeBox, terminalWidth } from "./layout.ts";
import { RelayClient } from "../relay/client.ts";
import { configureRelayFromDisk } from "../relay/setup.ts";
import { RelayInputBridge } from "./relay_bridge.ts";
import { TurnStatusTracker, appendFrame, drawScreen, runRelayTick } from "./screen.ts";
import { TaskManager } from "../tasks/manager.ts";
import { wireForegroundRunner } from "../tools/run_foreground.ts";
import { TaskRunner, ApprovalResponder } from "../tasks/types.ts";
import { isTaskTurnId, appendTaggedFrame, TaggedTurns, tryHandleAgentApprovalChar, tryHandleAgentApprovalArrow, tryHandleAgentApprovalEnter, cancelCommandArg } from "./tasks_bridge.ts";
import { resolveResume, persistTurnEnd } from "./resume.ts";
import { shareHello, announceMode, announceModel } from "./announce.ts";
import { GateBox, RelayBox, TasksBox, screenRows, hasFlag, isValidMode, nextMode } from "./slots.ts";
import { startUpdateNotifier, pollUpdateNotice } from "./update_notice.ts";
import { PendingUpdateInstall, tryHandleUpdateOfferArrow, tryHandleUpdateOfferEnter, tryHandleUpdateOfferChar } from "./update_offer.ts";
import { enterPlanMode, offerPlanDecision, tryHandlePlanDecisionArrow, tryHandlePlanDecisionEnter, tryHandlePlanDecisionChar } from "./plan_mode.ts";
import { pollUpdateInstall } from "./update_install_poll.ts";
import { VERSION } from "../version.ts";
import { enterScreen, leaveScreen, runMouseCommand } from "./mouse_reporting.ts";
import { isPointerKey, handlePointerKey, applyMouseState } from "./mouse_select.ts";

const STDIN: int = 0;
const RELAY_POLL_MS: int = 100;

export function runTerminal(argv: string[], startupNotes: string[]): void {
  if (!isatty(STDIN)) {
    console.log("joule needs a real terminal");
    process.exit(1);
    return;
  }

  applyConfiguredAccent();
  let cfg = loadConfig(argv);
  // The redactor is told the key this session actually resolved, so a key
  // that came from config.json or a key file - neither of which puts it in
  // the environment - is scrubbed from tool output like an env-borne one.
  rememberSecret(liveApiKey(cfg.apiKey));
  if (cfg.apiKey == "") {
    let onboarded = runOnboarding();
    cfg = { baseUrl: onboarded.baseUrl, model: onboarded.model, apiKey: onboarded.apiKey };
  }
  let server = loadServerOrigin(argv);
  let credential = loadCredential(server.base);
  let workspaceRoot = currentWorkspaceRoot();
  let sessionName = sessionNameFlag(argv);
  let resume = resolveResume(argv, workspaceRoot, sessionName);
  let updateNotifier = startUpdateNotifier(); let updateOffer = new PendingUpdateOffer(); let updateInstall = new PendingUpdateInstall();

  let platformScopes = "";
  let registry = new ToolsRegistry(workspaceRoot);
  if (credential.secret != "") {
    registry.setPlatformAccess(server.base, credential);
    platformScopes = credential.scopes;
  }
  let tools: ToolRegistry = { run: (t: string, a: string) => registry.dispatch(t, a) };

  let sb = new Scrollback();
  sb.setWidth(terminalWidth());
  let input = new InputLine();
  let history = new InputHistory();
  let rk = new TurnStatusTracker();
  let tagged = new TaggedTurns();

  let tracker = new TurnTracker();
  let watch = new CancelWatch();
  let live = new LiveProvider(cfg, allToolSchemas(platformScopes), watch, STDIN, tracker);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => live.ask(h, d) };

  let pendingApproval = new PendingApproval();
  let signin = new SignIn();
  let planDecision = new PendingPlanDecision();
  let modelPick = new PendingModelPick();
  let quitDecision = new PendingQuitDecision();
  let sessionPick = new PendingSessionPick();
  let gateBox = new GateBox();
  let relayBox = new RelayBox();
  let tasksBox = new TasksBox();

  let approvalDeps = new ApprovalDeps(sb, input, rk, pendingApproval, live, tracker, gateBox, relayBox, tasksBox);
  let onApprovalRequest = (callId: string, tool: string, summary: string, args: string) => {
    emitApprovalRequest(approvalDeps, callId, tool, summary, args);
  };
  let onApprovalPoll = () => {
    pollApprovalKeys(approvalDeps);
  };

  let gate = new Gate(MODE_SAFE_AUTO, 120000, workspaceRoot, onApprovalRequest, onApprovalPoll);
  let modeChoice = modeFlagResult(argv);
  if (modeChoice.error != "") {
    console.log(modeChoice.error);
    process.exit(1);
    return;
  }
  if (modeChoice.mode != "") { gate.mode = modeChoice.mode; }
  gate.setOnAutoAllowed((callId: string, tool: string, summary: string, args: string) => emitApprovalSettled(live.sessionSlot, tracker.current, callId, summary, args));
  gateBox.set(gate);
  let approval: ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string) => gate.check(callId, tool, summary, args) };

  let session = new Session(workspaceRoot, "agent", provider, tools, approval);
  session.injectSystemContext(loadWorkspaceInstructions(workspaceRoot));
  session.injectSystemContext(startupSkillsText(workspaceRoot));
  session.injectSystemContext(startupMemoryText());
  let scratchRel = ensureScratchDir(workspaceRoot, sessionName);
  session.injectSystemContext(scratchContextNote(scratchRel));
  if (resume.history != null) { session.history = resume.history; }
  live.setSession(session);

  let tasks = new TaskManager(workspaceRoot, cfg, () => gate.mode, scratchRel);
  tasksBox.set(tasks);
  let taskRunner: TaskRunner = {
    startBackgroundRun: (command: string) => tasks.startBackgroundRun(command),
    startSubagent: (task: string, steps: int, report: string) => tasks.startSubagent(task, steps, report),
    startPipeline: (args: string) => tasks.runPipeline(args, session),
    taskStatus: (id: string) => tasks.taskStatus(id),
  };
  registry.setTaskRunner(taskRunner);
  wireForegroundRunner(registry);
  rk.bind(tracker, () => tasks.runningTaskCount());
  let approvalResponder: ApprovalResponder = {
    hasPendingApproval: () => tasks.hasPendingApproval(),
    answerActiveApproval: (d: string) => tasks.answerActiveApproval(d),
    activeApprovalTool: () => tasks.activeApprovalTool(),
    activeApprovalSelected: () => tasks.activeApprovalSelected(),
    activeApprovalHasOptionRows: () => tasks.activeApprovalHasOptionRows(),
    activeApprovalOptionRows: () => tasks.activeApprovalOptionRows(),
    moveActiveApprovalSelection: (delta: int, count: int) => tasks.moveActiveApprovalSelection(delta, count),
  };

  let relay = new RelayClient("", "", 0, "", "");
  let bridge = new RelayInputBridge();
  relayBox.set(relay, session, bridge);

  let attachToRelay = () => {
    if (relay.isAttached()) {
      sb.append("\nalready attached to the relay");
      drawScreen(sb, input, gate.mode, rk);
      return;
    }
    configureRelayFromDisk(relay, argv);
    let result = relay.connect(workspaceRoot, displayModel(live.cfg));
    if (!result.ok) {
      sb.append("\n" + result.error);
      drawScreen(sb, input, gate.mode, rk);
      return;
    }
    relay.publish(shareHello(session, relay.sessionId, workspaceRoot, sessionName, displayModel(live.cfg), gate.mode));
    sb.append("\nattached - code " + result.code + " - " + result.url);
    drawScreen(sb, input, gate.mode, rk);
  };

  session.subscribe((frameJson: string) => {
    relay.publish(frameJson);
    if (frameType(frameJson) == TURN_START) {
      let f = decodeTurnStart(frameJson);
      if (f != null) {
        tracker.setCurrent(f.turnId);
        if (f.prompt != "" && !isTaskTurnId(f.turnId)) { sb.append("\n" + stylePrompt("> ") + f.prompt); }
      }
    }
    if (isTaskTurnId(frameTurnId(frameJson))) {
      appendTaggedFrame(sb, tagged, frameJson);
      if (frameType(frameJson) == APPROVAL_REQUEST) {
        tasks.setLatestApprovalOptionRows(sb.lineCount() - APPROVAL_OPTION_COUNT);
      }
    } else {
      appendFrame(sb, rk, frameJson);
    }
    if (frameType(frameJson) == TURN_END) { persistTurnEnd(workspaceRoot, sessionName, session.history); offerPlanDecision(planDecision, gate, session, sb, frameJson); }
    drawScreen(sb, input, gate.mode, rk);
    runRelayTick(relay, session, gate, bridge, sb, input, rk);
  });

  let mouse = enterScreen();
  applyMouseState(sb, mouse.on);
  rawEnable(STDIN);

  let planDecisionOpen = (prev: string) => {
    enterPlanMode(planDecision, session, prev);
  };
  let cmdDeps = new LocalCommandDeps(sb, input, rk, gate, session, live, bridge, tasks, mouse, signin, modelPick, sessionPick, server, workspaceRoot, sessionName);

  sb.append(buildWelcomeBox(displayModel(cfg), workspaceRoot, gate.mode, server.base));
  sb.append("\n\n" + styleBanner("joule - type a request, /help for commands, ctrl-d to quit") + skillsStartupNote(workspaceRoot));
  for (const n of startupNotes) { sb.append("\n" + styleBanner(n)); }
  if (resume.note != "") { sb.append(resume.note); }
  drawScreen(sb, input, gate.mode, rk);

  if (hasFlag(argv, "--share")) {
    attachToRelay();
  }

  let initialPrompt = promptFlag(argv);
  if (initialPrompt != "") {
    history.record(initialPrompt);
    bridge.runNow(session, initialPrompt);
    drawScreen(sb, input, gate.mode, rk);
  }

  let running = true;
  let detachRequested = false;
  let switchTarget = "";
  let renameTarget = "";
  while (running) {
    let k = readKeyTimeout(STDIN, RELAY_POLL_MS);

    if (k.kind == KEY_TIMEOUT) {
      runRelayTick(relay, session, gate, bridge, sb, input, rk);
      tasks.poll(session);
      pollUpdateNotice(updateNotifier, updateOffer, sb, input, gate.mode, rk);
      pollUpdateInstall(updateInstall, sessionName, sb, input, gate.mode, rk);
      continue;
    }

    // While the Ctrl-C prompt is open it owns the keyboard: arrows move the
    // choice, a number or its initial picks one, and a second Ctrl-C/Ctrl-D is
    // a fast "quit". Anything else is swallowed so it cannot leak to the input.
    if (quitDecision.isPending()) {
      if (k.kind == KEY_ARROW_UP) { if (quitDecision.moveSelection(-1)) { repaintQuitDecision(sb, quitDecision); drawScreen(sb, input, gate.mode, rk); } continue; }
      if (k.kind == KEY_ARROW_DOWN) { if (quitDecision.moveSelection(1)) { repaintQuitDecision(sb, quitDecision); drawScreen(sb, input, gate.mode, rk); } continue; }
      let choice = -1;
      if (k.kind == KEY_ENTER) { choice = quitDecision.selected; }
      else if (k.kind == KEY_CHAR) { choice = quitDecisionOptionForChar(k.char); }
      else if (k.kind == KEY_CTRL_C || k.kind == KEY_CTRL_D || k.kind == KEY_EOF) { choice = QUIT_DECISION_QUIT; }
      if (choice < 0) { continue; }
      quitDecision.close();
      if (choice == QUIT_DECISION_STAY) { sb.append("\n" + styleBanner("staying in this session")); drawScreen(sb, input, gate.mode, rk); continue; }
      detachRequested = (choice == QUIT_DECISION_KEEP);
      running = false;
      continue;
    }

    if (k.kind == KEY_CTRL_D || k.kind == KEY_EOF) {
      running = false;
      continue;
    }

    if (k.kind == KEY_CTRL_C) {
      if (signin.isActive()) { cancelSignIn(sb, input, signin); drawScreen(sb, input, gate.mode, rk); }
      else if (input.buf != "") {
        input.clear();
        drawScreen(sb, input, gate.mode, rk);
      } else {
        openQuitDecision(quitDecision, sb);
        drawScreen(sb, input, gate.mode, rk);
      }
      continue;
    }

    if (k.kind == KEY_BACKSPACE) {
      input.backspace();
      history.cancelNavigation();
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (k.kind == KEY_CHAR) {
      if (input.capturing()) { input.push(k.char); drawScreen(sb, input, gate.mode, rk); continue; }
      if (tryHandleAgentApprovalChar(approvalResponder, input.buf == "", k.char)) {
        drawScreen(sb, input, gate.mode, rk);
        continue;
      }
      if (tryHandleUpdateOfferChar(updateOffer, updateInstall, VERSION, sb, input.buf == "", k.char)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (tryHandlePlanDecisionChar(planDecision, gate, session, bridge, sb, input.buf == "", k.char)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (tryHandleModelPickChar(modelPick, input.buf == "")) { continue; }
      if (tryHandleSessionPickChar(sessionPick, input.buf == "")) { continue; }
      input.push(k.char);
      history.cancelNavigation();
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (k.kind == KEY_BACKTAB) {
      gate.mode = nextMode(gate.mode);
      announceMode(session, gate.mode);
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (k.kind == KEY_TAB || k.kind == KEY_ARROW_RIGHT) {
      if (input.acceptCompletion()) {
        drawScreen(sb, input, gate.mode, rk);
      }
      continue;
    }

    if (k.kind == KEY_ARROW_UP) {
      if (tryHandleAgentApprovalArrow(approvalResponder, sb, input.buf == "", -1)) {
        drawScreen(sb, input, gate.mode, rk);
        continue;
      }
      if (tryHandleUpdateOfferArrow(updateOffer, sb, input.buf == "", -1)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (tryHandlePlanDecisionArrow(planDecision, sb, input.buf == "", -1)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (tryHandleModelPickArrow(modelPick, sb, input.buf == "", -1)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (tryHandleSessionPickArrow(sessionPick, sb, input.buf == "", -1, sessionName)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (input.completion.isOpen() && !history.navigating) {
        input.completion.move(-1);
        drawScreen(sb, input, gate.mode, rk);
        continue;
      }
      input.setBuf(history.back(input.buf));
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (k.kind == KEY_ARROW_DOWN) {
      if (tryHandleAgentApprovalArrow(approvalResponder, sb, input.buf == "", 1)) {
        drawScreen(sb, input, gate.mode, rk);
        continue;
      }
      if (tryHandleUpdateOfferArrow(updateOffer, sb, input.buf == "", 1)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (tryHandlePlanDecisionArrow(planDecision, sb, input.buf == "", 1)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (tryHandleModelPickArrow(modelPick, sb, input.buf == "", 1)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (tryHandleSessionPickArrow(sessionPick, sb, input.buf == "", 1, sessionName)) { drawScreen(sb, input, gate.mode, rk); continue; }
      if (input.completion.isOpen() && !history.navigating) {
        input.completion.move(1);
        drawScreen(sb, input, gate.mode, rk);
        continue;
      }
      input.setBuf(history.forward());
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (k.kind == KEY_CTRL_O) {
      if (sb.toggleLastGroup()) {
        drawScreen(sb, input, gate.mode, rk);
      }
      continue;
    }

    if (isPointerKey(k.kind)) { handlePointerKey(k, sb, input, screenRows()); drawScreen(sb, input, gate.mode, rk); continue; }

    if (k.kind != KEY_ENTER) {
      continue;
    }

    if (signin.isActive() && input.buf.trim() == "") { continue; }
    if (tryHandleAgentApprovalEnter(approvalResponder, sb, input.buf == "")) {
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (tryHandleUpdateOfferEnter(updateOffer, updateInstall, VERSION, sb, input.buf == "")) { drawScreen(sb, input, gate.mode, rk); continue; }
    if (tryHandlePlanDecisionEnter(planDecision, gate, session, bridge, sb, input.buf == "")) { drawScreen(sb, input, gate.mode, rk); continue; }
    if (tryHandleModelPickEnter(modelPick, live, session, sb, input.buf == "")) { drawScreen(sb, input, gate.mode, rk); continue; }
    if (sessionPick.isPending() && input.buf == "") {
      let chosen = sessionPick.selectedEntry();
      sessionPick.close();
      if (chosen == sessionName) {
        sb.append(stayingNote(sessionName));
      } else {
        switchTarget = chosen;
        running = false;
      }
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    let line = input.takeAndClear();
    drawScreen(sb, input, gate.mode, rk);

    if (line.trim() == "") {
      continue;
    }

    if (signin.isActive()) { submitSignIn(sb, input, signin, line); drawScreen(sb, input, gate.mode, rk); continue; }

    let cmd = parseCommand(line);

    if (cmd.kind == CMD_NONE) {
      history.record(line);
      bridge.runNow(session, line);
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    sb.append("\n" + stylePrompt("> ") + line);

    let outcome = runLocalCommand(cmdDeps, cmd, planDecisionOpen, attachToRelay);
    if (outcome.switchTarget != "") { switchTarget = outcome.switchTarget; }
    if (outcome.renameTarget != "") { renameTarget = outcome.renameTarget; }
    if (outcome.leave) { running = false; }
  }

  relay.detach();

  leaveScreen(mouse);
  rawDisable(STDIN);

  if (detachRequested) {
    for (const line of detachToBackground(workspaceRoot, sessionName, session.history)) {
      console.log(line);
    }
  }
  if (switchTarget != "") {
    for (const line of switchSessionNotes(workspaceRoot, sessionName, switchTarget, session.history)) {
      console.log(line);
    }
  }
  if (renameTarget != "") {
    for (const line of renameNotes(workspaceRoot, sessionName, renameTarget, session.history)) {
      console.log(line);
    }
  }
}
