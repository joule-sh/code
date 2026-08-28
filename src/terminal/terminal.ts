import { isatty, rawEnable, rawDisable, readKey, readKeyTimeout, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_CTRL_O, KEY_EOF, KEY_TIMEOUT, KEY_ARROW_UP, KEY_ARROW_DOWN, KEY_ARROW_RIGHT, KEY_TAB, KEY_BACKTAB } from "../vendor/tty/tty.ts";
import { loadConfig, loadServerOrigin } from "../providers/config.ts";
import { displayModel, qualifiedModel, wireModel } from "../providers/platform.ts";
import { runOnboarding } from "./onboarding.ts";
import { allToolSchemas } from "../tools/schemas.ts";
import { ToolsRegistry } from "../tools/registry.ts";
import { Gate, MODE_SAFE_AUTO, MODE_PLAN } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { Message, Provider, ToolRegistry, ApprovalGate } from "../session/types.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { PROTOCOL_VERSION, frameType, frameTurnId, decodeTurnStart, TURN_START, TURN_END, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest } from "../protocol/frames.ts";
import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SHARE, CMD_LOGIN, CMD_LOGOUT, CMD_CAT, CMD_TASKS, CMD_MEMORY, CMD_SKILLS, CMD_MOUSE, CMD_CLEAR, CMD_EXIT, CMD_UNKNOWN, CMD_NONE } from "./commands.ts";
import { catText } from "./cat.ts";
import { SignIn, beginSignIn, submitSignIn, cancelSignIn, logoutText } from "./login_ui.ts";
import { memoryCommandText, startupMemoryText } from "./memory_ui.ts";
import { loadWorkspaceInstructions } from "../session/project_instructions.ts";
import { startupSkillsText, skillsStartupNote, runSkillCommand } from "./skills_ui.ts";
import { workspaceRoot as currentWorkspaceRoot } from "../vendor/platform/platform.ts";
import { InputLine, InputHistory, PendingApproval, PendingUpdateOffer, PendingPlanDecision, PendingModelPick, approvalOptionForChar, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { fetchModelIds, buildModelEntries, openModelPick, tryHandleModelPickArrow, tryHandleModelPickEnter, tryHandleModelPickChar } from "./model_picker.ts";
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

  let cfg = loadConfig(argv);
  if (cfg.apiKey == "") {
    let onboarded = runOnboarding();
    cfg = { baseUrl: onboarded.baseUrl, model: onboarded.model, apiKey: onboarded.apiKey };
  }
  let server = loadServerOrigin(argv);
  let workspaceRoot = currentWorkspaceRoot();
  let resume = resolveResume(argv, workspaceRoot);
  let updateNotifier = startUpdateNotifier(); let updateOffer = new PendingUpdateOffer(); let updateInstall = new PendingUpdateInstall();

  let registry = new ToolsRegistry(workspaceRoot);
  let tools: ToolRegistry = { run: (t: string, a: string) => registry.dispatch(t, a) };

  let sb = new Scrollback();
  sb.setWidth(terminalWidth());
  let input = new InputLine();
  let history = new InputHistory();
  let rk = new TurnStatusTracker();
  let tagged = new TaggedTurns();

  let tracker = new TurnTracker();
  let watch = new CancelWatch();
  let live = new LiveProvider(cfg, allToolSchemas(), watch, STDIN, tracker);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => live.ask(h, d) };

  let pendingApproval = new PendingApproval();
  let signin = new SignIn();
  let planDecision = new PendingPlanDecision();
  let modelPick = new PendingModelPick();
  let gateBox = new GateBox();
  let relayBox = new RelayBox();
  let tasksBox = new TasksBox();

  let onApprovalRequest = (callId: string, tool: string, summary: string, args: string) => {
    pendingApproval.begin(callId, tool);
    if (live.sessionSlot.length > 0) {
      let s = live.sessionSlot[0];
      let frame: ApprovalRequestFrame = {
        v: PROTOCOL_VERSION, seq: s.takeSeq(), type: APPROVAL_REQUEST,
        turnId: tracker.current, callId: callId, tool: tool, summary: summary, detail: args, args: args,
      };
      s.emit(encodeApprovalRequest(frame));
      noteApprovalBlock(sb, pendingApproval, summary, args);
    }
  };

  let onApprovalPoll = () => {
    if (relayBox.relaySlot.length > 0 && gateBox.slot.length > 0) {
      runRelayTick(relayBox.relaySlot[0], relayBox.sessionSlot[0], gateBox.slot[0], relayBox.bridgeSlot[0], sb, input, rk);
      reportIfResolvedElsewhere(gateBox.slot[0], sb, input, rk, pendingApproval);
    }
    if (tasksBox.slot.length > 0 && relayBox.sessionSlot.length > 0) {
      tasksBox.slot[0].poll(relayBox.sessionSlot[0]);
    }
    let k = readKeyTimeout(STDIN, 0);
    if (isPointerKey(k.kind)) {
      if (handlePointerKey(k, sb, input, screenRows()) && gateBox.slot.length > 0) {
        drawScreen(sb, input, gateBox.slot[0].mode, rk);
      }
    } else if ((k.kind == KEY_ARROW_UP || k.kind == KEY_ARROW_DOWN) && gateBox.slot.length > 0) {
      let delta = 1;
      if (k.kind == KEY_ARROW_UP) { delta = -1; }
      if (pendingApproval.moveSelection(delta, APPROVAL_OPTION_COUNT)) {
        repaintApprovalOptions(sb, pendingApproval);
        drawScreen(sb, input, gateBox.slot[0].mode, rk);
      }
    } else if (k.kind == KEY_ENTER && gateBox.slot.length > 0 && pendingApproval.callId != "") {
      answerApproval(gateBox.slot[0], sb, input, rk, pendingApproval, pendingApproval.selected);
    } else if (k.kind == KEY_CHAR && approvalOptionForChar(k.char) >= 0 && gateBox.slot.length > 0 && pendingApproval.callId != "") {
      answerApproval(gateBox.slot[0], sb, input, rk, pendingApproval, approvalOptionForChar(k.char));
    } else if (k.kind == KEY_CTRL_O && gateBox.slot.length > 0) {
      if (sb.toggleLastGroup()) {
        drawScreen(sb, input, gateBox.slot[0].mode, rk);
      }
    } else if (k.kind == KEY_CTRL_C) {
      if (gateBox.slot.length > 0) {
        denyPendingApproval(gateBox.slot[0], sb, input, rk, pendingApproval);
      }
      if (live.sessionSlot.length > 0) {
        live.sessionSlot[0].cancel(tracker.current);
      }
    }
  };

  let gate = new Gate(MODE_SAFE_AUTO, 120000, workspaceRoot, onApprovalRequest, onApprovalPoll);
  gate.setOnAutoAllowed((callId: string, tool: string, summary: string, args: string) => emitApprovalSettled(live.sessionSlot, tracker.current, callId, summary, args));
  gateBox.set(gate);
  let approval: ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string) => gate.check(callId, tool, summary, args) };

  let session = new Session(workspaceRoot, "agent", provider, tools, approval);
  session.injectSystemContext(loadWorkspaceInstructions(workspaceRoot));
  session.injectSystemContext(startupSkillsText(workspaceRoot));
  session.injectSystemContext(startupMemoryText());
  if (resume.history != null) { session.history = resume.history; }
  live.setSession(session);

  let tasks = new TaskManager(workspaceRoot, cfg, () => gate.mode);
  tasksBox.set(tasks);
  let taskRunner: TaskRunner = {
    startBackgroundRun: (command: string) => tasks.startBackgroundRun(command),
    startSubagent: (task: string) => tasks.startSubagent(task),
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
    relay.publish(shareHello(session, relay.sessionId, workspaceRoot, displayModel(live.cfg), gate.mode));
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
    if (frameType(frameJson) == TURN_END) { persistTurnEnd(workspaceRoot, session.history); offerPlanDecision(planDecision, gate, session, sb, frameJson); }
    drawScreen(sb, input, gate.mode, rk);
    runRelayTick(relay, session, gate, bridge, sb, input, rk);
  });

  let mouse = enterScreen();
  applyMouseState(sb, mouse.on);
  rawEnable(STDIN);

  sb.append(buildWelcomeBox(displayModel(cfg), workspaceRoot, gate.mode, server.base));
  sb.append("\n\n" + styleBanner("joule - type a request, /help for commands, ctrl-d to quit") + skillsStartupNote(workspaceRoot));
  for (const n of startupNotes) { sb.append("\n" + styleBanner(n)); }
  if (resume.note != "") { sb.append(resume.note); }
  drawScreen(sb, input, gate.mode, rk);

  if (hasFlag(argv, "--share")) {
    attachToRelay();
  }

  let running = true;
  while (running) {
    let k = readKeyTimeout(STDIN, RELAY_POLL_MS);

    if (k.kind == KEY_TIMEOUT) {
      runRelayTick(relay, session, gate, bridge, sb, input, rk);
      tasks.poll(session);
      pollUpdateNotice(updateNotifier, updateOffer, sb, input, gate.mode, rk);
      pollUpdateInstall(updateInstall, sb, input, gate.mode, rk);
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
        running = false;
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

    if (cmd.kind == CMD_HELP) { sb.append("\n" + helpText()); drawScreen(sb, input, gate.mode, rk); continue; }
    if (cmd.kind == CMD_SKILLS) { let skillInput = runSkillCommand(workspaceRoot, cmd.arg, sb); drawScreen(sb, input, gate.mode, rk); if (skillInput != "") { bridge.runNow(session, skillInput); drawScreen(sb, input, gate.mode, rk); } continue; }

    if (cmd.kind == CMD_MODEL) {
      if (cmd.arg == "") {
        sb.append("\n" + styleBanner("listing models from " + live.cfg.baseUrl + " ..."));
        drawScreen(sb, input, gate.mode, rk);
        let ids = fetchModelIds(live.cfg);
        openModelPick(modelPick, sb, buildModelEntries(live.cfg, ids));
      } else {
        live.cfg = { baseUrl: live.cfg.baseUrl, model: wireModel(live.cfg.baseUrl, cmd.arg), apiKey: live.cfg.apiKey };
        announceModel(session, displayModel(live.cfg));
      }
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_MODE) {
      if (cmd.arg == "") {
        sb.append("\nmode: " + gate.mode);
      } else if (isValidMode(cmd.arg)) {
        if (cmd.arg == MODE_PLAN && gate.mode != MODE_PLAN) { enterPlanMode(planDecision, session, gate.mode); }
        gate.mode = cmd.arg;
        announceMode(session, gate.mode);
      } else {
        sb.append("\nunknown mode: " + cmd.arg + " (expected read-only, auto-edit, safe-auto, full-auto, or plan)");
      }
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_SHARE) {
      attachToRelay();
      continue;
    }

    if (cmd.kind == CMD_LOGIN) {
      beginSignIn(sb, input, signin, server, cmd.arg);
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_LOGOUT) { sb.append(logoutText(server.base, cmd.arg)); drawScreen(sb, input, gate.mode, rk); continue; }

    if (cmd.kind == CMD_CAT) {
      sb.append(catText(workspaceRoot, cmd.arg));
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_MEMORY) { sb.append(memoryCommandText(cmd.arg)); drawScreen(sb, input, gate.mode, rk); continue; }

    if (cmd.kind == CMD_MOUSE) { sb.append(runMouseCommand(mouse, cmd.arg)); applyMouseState(sb, mouse.on); drawScreen(sb, input, gate.mode, rk); continue; }

    if (cmd.kind == CMD_TASKS) {
      if (cmd.arg == "") {
        sb.append("\n" + tasks.listText());
      } else {
        let cancelId = cancelCommandArg(cmd.arg);
        if (cancelId != "") {
          sb.append("\n" + tasks.cancel(cancelId));
        } else {
          sb.append("\nusage: /tasks or /tasks cancel <id>");
        }
      }
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_CLEAR) { sb.clear(); drawScreen(sb, input, gate.mode, rk); continue; }

    if (cmd.kind == CMD_EXIT) { running = false; continue; }

    sb.append("\nunknown command: /" + cmd.arg);
    drawScreen(sb, input, gate.mode, rk);
  }

  relay.detach();

  leaveScreen(mouse);
  rawDisable(STDIN);
}
