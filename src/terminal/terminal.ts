import { isatty, rawEnable, rawDisable, readKey, readKeyTimeout, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_CTRL_O, KEY_EOF, KEY_TIMEOUT, KEY_ARROW_UP, KEY_ARROW_DOWN, KEY_ARROW_RIGHT, KEY_TAB, KEY_BACKTAB, KEY_SCROLL_UP, KEY_SCROLL_DOWN } from "../vendor/tty/tty.ts";
import { loadConfig, loadServerOrigin } from "../providers/config.ts";
import { runOnboarding } from "./onboarding.ts";
import { allToolSchemas } from "../tools/schemas.ts";
import { ToolsRegistry } from "../tools/registry.ts";
import { Gate, MODE_AUTO_EDIT, MODE_PLAN } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { Message, Provider, ToolRegistry, ApprovalGate } from "../session/types.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello, frameType, frameTurnId, decodeTurnStart, TURN_START, TURN_END, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest } from "../protocol/frames.ts";
import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SHARE, CMD_LOGIN, CMD_LOGOUT, CMD_CAT, CMD_TASKS, CMD_MEMORY, CMD_UPDATE, CMD_MOUSE, CMD_CLEAR, CMD_EXIT, CMD_UNKNOWN, CMD_NONE } from "./commands.ts";
import { catText } from "./cat.ts";
import { SignIn, beginSignIn, submitSignIn, cancelSignIn, logoutText } from "./login_ui.ts";
import { memoryCommandText, startupMemoryText } from "./memory_ui.ts";
import { loadProjectInstructions } from "../session/project_instructions.ts";
import { workspaceRoot as currentWorkspaceRoot } from "../vendor/platform/platform.ts";
import { InputLine, InputHistory, PendingApproval, PendingUpdateOffer, PendingPlanDecision, approvalOptionForChar, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { repaintApprovalOptions, answerApproval, denyPendingApproval, reportIfResolvedElsewhere } from "./approval_ui.ts";
import { stylePrompt, styleBanner } from "./style.ts";
import { buildWelcomeBox } from "./layout.ts";
import { RelayClient } from "../relay/client.ts";
import { loadRelayConfig } from "../relay/client_logic.ts";
import { RelayInputBridge } from "./relay_bridge.ts";
import { TurnStatusTracker, appendFrame, drawScreen, runRelayTick } from "./screen.ts";
import { TaskManager } from "../tasks/manager.ts";
import { wireForegroundRunner } from "../tools/run_foreground.ts";
import { TaskRunner, ApprovalResponder } from "../tasks/types.ts";
import { isTaskTurnId, appendTaggedFrame, TaggedTurns, tryHandleAgentApprovalChar, tryHandleAgentApprovalArrow, tryHandleAgentApprovalEnter, cancelCommandArg } from "./tasks_bridge.ts";
import { resolveResume, persistTurnEnd } from "./resume.ts";
import { GateBox, RelayBox, TasksBox, screenRows, hasFlag, isValidMode, nextMode } from "./slots.ts";
import { startUpdateNotifier, pollUpdateNotice } from "./update_notice.ts";
import { PendingUpdateInstall, beginUpdateInstall, tryHandleUpdateOfferArrow, tryHandleUpdateOfferEnter, tryHandleUpdateOfferChar } from "./update_offer.ts";
import { enterPlanMode, offerPlanDecision, tryHandlePlanDecisionArrow, tryHandlePlanDecisionEnter, tryHandlePlanDecisionChar } from "./plan_mode.ts";
import { pollUpdateInstall } from "./update_install_poll.ts";
import { VERSION } from "../version.ts";
import { enterScreen, leaveScreen, runMouseCommand } from "./mouse_reporting.ts";
import { isScrollKey, applyScrollKey, WHEEL_SCROLL_LINES } from "./scroll_keys.ts";

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
  let gateBox = new GateBox();
  let relayBox = new RelayBox();
  let tasksBox = new TasksBox();

  let onApprovalRequest = (callId: string, tool: string, summary: string, args: string) => {
    pendingApproval.set(callId);
    pendingApproval.setTool(tool);
    if (live.sessionSlot.length > 0) {
      let s = live.sessionSlot[0];
      let frame: ApprovalRequestFrame = {
        v: PROTOCOL_VERSION, seq: s.takeSeq(), type: APPROVAL_REQUEST,
        turnId: tracker.current, callId: callId, tool: tool, summary: summary, detail: args, args: args,
      };
      s.emit(encodeApprovalRequest(frame));
      pendingApproval.setOptionRows(sb.lineCount() - APPROVAL_OPTION_COUNT);
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
    if (k.kind == KEY_SCROLL_UP || k.kind == KEY_SCROLL_DOWN) {
      let r = screenRows();
      if (k.kind == KEY_SCROLL_UP) {
        sb.scrollUp(r - 1, WHEEL_SCROLL_LINES);
      } else {
        sb.scrollDown(r - 1, WHEEL_SCROLL_LINES);
      }
      if (gateBox.slot.length > 0) {
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

  let gate = new Gate(MODE_AUTO_EDIT, 120000, workspaceRoot, onApprovalRequest, onApprovalPoll);
  gateBox.set(gate);
  let approval: ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string) => gate.check(callId, tool, summary, args) };

  let session = new Session(workspaceRoot, "agent", provider, tools, approval);
  session.injectSystemContext(loadProjectInstructions(workspaceRoot));
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

  let relayCfg = loadRelayConfig();
  let relay = new RelayClient(relayCfg.host, relayCfg.httpPort, relayCfg.wsPort, relayCfg.webBaseUrl, relayCfg.tmpDir);
  let bridge = new RelayInputBridge();
  relayBox.set(relay, session, bridge);

  let attachToRelay = () => {
    if (relay.isAttached()) {
      sb.append("\nalready attached to the relay");
      drawScreen(sb, input, gate.mode, rk);
      return;
    }
    let result = relay.connect(workspaceRoot, live.cfg.model);
    if (!result.ok) {
      sb.append("\ncould not attach to the relay: " + result.error);
      drawScreen(sb, input, gate.mode, rk);
      return;
    }
    let hello: SessionHelloFrame = {
      v: PROTOCOL_VERSION, seq: session.takeSeq(), type: SESSION_HELLO,
      sessionId: relay.sessionId, workspace: workspaceRoot, model: live.cfg.model,
      mode: session.mode, protocol: PROTOCOL_VERSION,
    };
    relay.publish(encodeSessionHello(hello));
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
  rawEnable(STDIN);

  sb.append(buildWelcomeBox(cfg.model, workspaceRoot, gate.mode, server.base));
  sb.append("\n\n" + styleBanner("joule - type a request, /help for commands, ctrl-d to quit"));
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
      input.push(k.char);
      history.cancelNavigation();
      drawScreen(sb, input, gate.mode, rk);
      continue;
    }

    if (k.kind == KEY_BACKTAB) {
      gate.mode = nextMode(gate.mode);
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

    if (isScrollKey(k.kind)) { applyScrollKey(k.kind, sb, screenRows()); drawScreen(sb, input, gate.mode, rk); continue; }

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

    if (cmd.kind == CMD_HELP) { sb.append("\n" + helpText()); drawScreen(sb, input, gate.mode, rk); continue; }

    if (cmd.kind == CMD_MODEL) {
      if (cmd.arg == "") {
        sb.append("\nmodel: " + live.cfg.model);
      } else {
        live.cfg = { baseUrl: live.cfg.baseUrl, model: cmd.arg, apiKey: live.cfg.apiKey };
        sb.append("\nmodel set to " + cmd.arg);
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
        sb.append("\nmode set to " + cmd.arg);
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

    if (cmd.kind == CMD_UPDATE) { beginUpdateInstall(updateInstall, VERSION, sb); drawScreen(sb, input, gate.mode, rk); continue; }

    if (cmd.kind == CMD_MEMORY) { sb.append(memoryCommandText(cmd.arg)); drawScreen(sb, input, gate.mode, rk); continue; }

    if (cmd.kind == CMD_MOUSE) { sb.append(runMouseCommand(mouse, cmd.arg)); drawScreen(sb, input, gate.mode, rk); continue; }

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
