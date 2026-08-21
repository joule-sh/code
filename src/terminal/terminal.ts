import { isatty, rawEnable, rawDisable, readKey, readKeyTimeout, rows, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, HIDE_CURSOR, SHOW_CURSOR, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF, KEY_TIMEOUT, KEY_PAGE_UP, KEY_PAGE_DOWN, KEY_ARROW_UP, KEY_ARROW_DOWN, KEY_SCROLL_UP, KEY_SCROLL_DOWN } from "../vendor/tty/tty.ts";
import { loadConfig } from "../providers/config.ts";
import { runOnboarding } from "./onboarding.ts";
import { allToolSchemas } from "../tools/schemas.ts";
import { ToolsRegistry } from "../tools/registry.ts";
import { readFile } from "../tools/files.ts";
import { Gate, MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_FULL_AUTO, REPLY_DENY } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { Message, Provider, ToolRegistry, ApprovalGate } from "../session/types.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello, frameType, frameTurnId, decodeTurnStart, TURN_START, TURN_END, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest } from "../protocol/frames.ts";
import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SHARE, CMD_CAT, CMD_TASKS, CMD_CLEAR, CMD_EXIT, CMD_UNKNOWN, CMD_NONE } from "./commands.ts";
import { Scrollback, InputLine, InputHistory, PendingApproval, approvalOptionForChar, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { repaintApprovalOptions, answerApproval } from "./approval_ui.ts";
import { stylePrompt, styleBanner } from "./style.ts";
import { buildWelcomeBox } from "./layout.ts";
import { RelayClient } from "../relay/client.ts";
import { loadRelayConfig } from "../relay/client_logic.ts";
import { RelayInputBridge } from "./relay_bridge.ts";
import { TurnStatusTracker, appendFrame, drawScreen, runRelayTick } from "./screen.ts";
import { TaskManager } from "../tasks/manager.ts";
import { TaskRunner, ApprovalResponder } from "../tasks/types.ts";
import { isTaskTurnId, appendTaggedFrame, tryHandleAgentApprovalChar, tryHandleAgentApprovalArrow, tryHandleAgentApprovalEnter, cancelCommandArg } from "./tasks_bridge.ts";
import { resolveResume, persistTurnEnd } from "./resume.ts";

const STDIN: int = 0;
const RELAY_POLL_MS: int = 100;
const WHEEL_SCROLL_LINES: int = 3;

function screenRows(): int {
  let r = rows(STDIN);
  if (r <= 1) { r = 24; }
  return r;
}

function hasFlag(argv: string[], name: string): bool {
  for (const a of argv) {
    if (a == name) {
      return true;
    }
  }
  return false;
}

class GateBox {
  slot: Gate[];
  constructor() {
    this.slot = [];
  }
  set(g: Gate): void {
    this.slot = [g];
  }
}

class RelayBox {
  relaySlot: RelayClient[];
  sessionSlot: Session[];
  bridgeSlot: RelayInputBridge[];
  constructor() {
    this.relaySlot = [];
    this.sessionSlot = [];
    this.bridgeSlot = [];
  }
  set(r: RelayClient, s: Session, b: RelayInputBridge): void {
    this.relaySlot = [r];
    this.sessionSlot = [s];
    this.bridgeSlot = [b];
  }
}

class TasksBox {
  slot: TaskManager[];
  constructor() {
    this.slot = [];
  }
  set(t: TaskManager): void {
    this.slot = [t];
  }
}

function isValidMode(mode: string): bool {
  return mode == MODE_READ_ONLY || mode == MODE_AUTO_EDIT || mode == MODE_FULL_AUTO;
}

export function runTerminal(argv: string[]): void {
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
  let workspaceRoot = process.cwd();
  let resume = resolveResume(argv, workspaceRoot);

  let registry = new ToolsRegistry(workspaceRoot);
  let tools: ToolRegistry = { run: (t: string, a: string) => registry.dispatch(t, a) };

  let sb = new Scrollback();
  let input = new InputLine();
  let history = new InputHistory();
  let rk = new TurnStatusTracker();

  let tracker = new TurnTracker();
  let watch = new CancelWatch();
  let live = new LiveProvider(cfg, allToolSchemas(), watch, STDIN, tracker);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => live.ask(h, d) };

  let pendingApproval = new PendingApproval();
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
        drawScreen(sb, input, gateBox.slot[0].mode, rk.quantaText());
      }
    } else if ((k.kind == KEY_ARROW_UP || k.kind == KEY_ARROW_DOWN) && gateBox.slot.length > 0) {
      let delta = 1;
      if (k.kind == KEY_ARROW_UP) { delta = -1; }
      if (pendingApproval.moveSelection(delta, APPROVAL_OPTION_COUNT)) {
        repaintApprovalOptions(sb, pendingApproval);
        drawScreen(sb, input, gateBox.slot[0].mode, rk.quantaText());
      }
    } else if (k.kind == KEY_ENTER && gateBox.slot.length > 0) {
      answerApproval(gateBox.slot[0], sb, input, rk, pendingApproval, pendingApproval.selected);
    } else if (k.kind == KEY_CHAR && approvalOptionForChar(k.char) >= 0 && gateBox.slot.length > 0) {
      answerApproval(gateBox.slot[0], sb, input, rk, pendingApproval, approvalOptionForChar(k.char));
    } else if (k.kind == KEY_CTRL_C) {
      if (gateBox.slot.length > 0) {
        gateBox.slot[0].reply(pendingApproval.callId, REPLY_DENY);
      }
      pendingApproval.clearIfMatches(pendingApproval.callId);
      if (live.sessionSlot.length > 0) {
        live.sessionSlot[0].cancel(tracker.current);
      }
    }
  };

  let gate = new Gate(MODE_AUTO_EDIT, 120000, onApprovalRequest, onApprovalPoll);
  gateBox.set(gate);
  let approval: ApprovalGate = { check: (callId: string, tool: string, summary: string, args: string) => gate.check(callId, tool, summary, args) };

  let session = new Session(workspaceRoot, "agent", provider, tools, approval);
  if (resume.history != null) { session.history = resume.history; }
  live.setSession(session);

  let tasks = new TaskManager(workspaceRoot, cfg, () => gate.mode);
  tasksBox.set(tasks);
  let taskRunner: TaskRunner = {
    startBackgroundRun: (command: string) => tasks.startBackgroundRun(command),
    startSubagent: (task: string) => tasks.startSubagent(task),
  };
  registry.setTaskRunner(taskRunner);
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
      drawScreen(sb, input, gate.mode, rk.quantaText());
      return;
    }
    let result = relay.connect(workspaceRoot, live.cfg.model);
    if (!result.ok) {
      sb.append("\ncould not attach to the relay: " + result.error);
      drawScreen(sb, input, gate.mode, rk.quantaText());
      return;
    }
    let hello: SessionHelloFrame = {
      v: PROTOCOL_VERSION, seq: session.takeSeq(), type: SESSION_HELLO,
      sessionId: relay.sessionId, workspace: workspaceRoot, model: live.cfg.model,
      mode: session.mode, protocol: PROTOCOL_VERSION,
    };
    relay.publish(encodeSessionHello(hello));
    sb.append("\nattached - code " + result.code + " - " + result.url);
    drawScreen(sb, input, gate.mode, rk.quantaText());
  };

  session.subscribe((frameJson: string) => {
    relay.publish(frameJson);
    if (frameType(frameJson) == TURN_START) {
      let f = decodeTurnStart(frameJson);
      if (f != null) {
        tracker.setCurrent(f.turnId);
      }
    }
    if (isTaskTurnId(frameTurnId(frameJson))) {
      appendTaggedFrame(sb, frameJson);
      if (frameType(frameJson) == APPROVAL_REQUEST) {
        tasks.setLatestApprovalOptionRows(sb.lineCount() - APPROVAL_OPTION_COUNT);
      }
    } else {
      appendFrame(sb, rk, frameJson);
    }
    if (frameType(frameJson) == TURN_END) { persistTurnEnd(workspaceRoot, session.history); }
    drawScreen(sb, input, gate.mode, rk.quantaText());
    runRelayTick(relay, session, gate, bridge, sb, input, rk);
  });

  process.stdout().write(ENTER_ALT_SCREEN + HIDE_CURSOR + ENABLE_MOUSE_REPORTING);
  rawEnable(STDIN);

  sb.append(buildWelcomeBox(cfg.model, workspaceRoot, gate.mode));
  sb.append("\n\n" + styleBanner("joule - type a request, /help for commands, ctrl-d to quit"));
  if (resume.note != "") { sb.append(resume.note); }
  drawScreen(sb, input, gate.mode, rk.quantaText());

  if (hasFlag(argv, "--share")) {
    attachToRelay();
  }

  let running = true;
  while (running) {
    let k = readKeyTimeout(STDIN, RELAY_POLL_MS);

    if (k.kind == KEY_TIMEOUT) {
      runRelayTick(relay, session, gate, bridge, sb, input, rk);
      tasks.poll(session);
      continue;
    }

    if (k.kind == KEY_CTRL_D || k.kind == KEY_EOF) {
      running = false;
      continue;
    }

    if (k.kind == KEY_CTRL_C) {
      if (input.buf != "") {
        input.clear();
        drawScreen(sb, input, gate.mode, rk.quantaText());
      } else {
        running = false;
      }
      continue;
    }

    if (k.kind == KEY_BACKSPACE) {
      input.backspace();
      history.cancelNavigation();
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_CHAR) {
      if (tryHandleAgentApprovalChar(approvalResponder, input.buf == "", k.char)) {
        drawScreen(sb, input, gate.mode, rk.quantaText());
        continue;
      }
      input.push(k.char);
      history.cancelNavigation();
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_ARROW_UP) {
      if (tryHandleAgentApprovalArrow(approvalResponder, sb, input.buf == "", -1)) {
        drawScreen(sb, input, gate.mode, rk.quantaText());
        continue;
      }
      input.setBuf(history.back(input.buf));
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_ARROW_DOWN) {
      if (tryHandleAgentApprovalArrow(approvalResponder, sb, input.buf == "", 1)) {
        drawScreen(sb, input, gate.mode, rk.quantaText());
        continue;
      }
      input.setBuf(history.forward());
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_PAGE_UP) {
      let r = screenRows();
      sb.scrollUp(r - 1, r - 1);
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_PAGE_DOWN) {
      let r = screenRows();
      sb.scrollDown(r - 1, r - 1);
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_SCROLL_UP) {
      let r = screenRows();
      sb.scrollUp(r - 1, WHEEL_SCROLL_LINES);
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_SCROLL_DOWN) {
      let r = screenRows();
      sb.scrollDown(r - 1, WHEEL_SCROLL_LINES);
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind != KEY_ENTER) {
      continue;
    }

    if (tryHandleAgentApprovalEnter(approvalResponder, sb, input.buf == "")) {
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    let line = input.takeAndClear();
    drawScreen(sb, input, gate.mode, rk.quantaText());

    if (line.trim() == "") {
      continue;
    }

    let cmd = parseCommand(line);

    if (cmd.kind == CMD_NONE) {
      history.record(line);
      sb.append("\n" + stylePrompt("> ") + line);
      drawScreen(sb, input, gate.mode, rk.quantaText());
      bridge.runNow(session, line);
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (cmd.kind == CMD_HELP) {
      sb.append("\n" + helpText());
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (cmd.kind == CMD_MODEL) {
      if (cmd.arg == "") {
        sb.append("\nmodel: " + live.cfg.model);
      } else {
        live.cfg = { baseUrl: live.cfg.baseUrl, model: cmd.arg, apiKey: live.cfg.apiKey };
        sb.append("\nmodel set to " + cmd.arg);
      }
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (cmd.kind == CMD_MODE) {
      if (cmd.arg == "") {
        sb.append("\nmode: " + gate.mode);
      } else if (isValidMode(cmd.arg)) {
        gate.mode = cmd.arg;
        sb.append("\nmode set to " + cmd.arg);
      } else {
        sb.append("\nunknown mode: " + cmd.arg + " (expected read-only, auto-edit, or full-auto)");
      }
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (cmd.kind == CMD_SHARE) {
      attachToRelay();
      continue;
    }

    if (cmd.kind == CMD_CAT) {
      if (cmd.arg == "") {
        sb.append("\nusage: /cat <path>");
      } else {
        let r = readFile(workspaceRoot, cmd.arg, 0, 0);
        if (!r.ok) {
          sb.append("\ncat: " + cmd.arg + ": " + r.error);
        } else {
          sb.append("\n" + r.content);
          if (r.truncated) {
            sb.append("\n(truncated)");
          }
        }
      }
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

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
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (cmd.kind == CMD_CLEAR) {
      sb.clear();
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (cmd.kind == CMD_EXIT) {
      running = false;
      continue;
    }

    sb.append("\nunknown command: /" + cmd.arg);
    drawScreen(sb, input, gate.mode, rk.quantaText());
  }

  relay.detach();

  process.stdout().write(DISABLE_MOUSE_REPORTING + SHOW_CURSOR + EXIT_ALT_SCREEN);
  rawDisable(STDIN);
}
