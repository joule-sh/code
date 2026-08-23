import { isatty, rawEnable, rawDisable, readKeyTimeout, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, HIDE_CURSOR, SHOW_CURSOR, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF, KEY_TIMEOUT, KEY_ARROW_UP, KEY_ARROW_DOWN } from "../vendor/tty/tty.ts";
import { PROTOCOL_VERSION, INPUT, CANCEL, APPROVAL_REPLY, SESSION_HELLO, APPROVAL_REQUEST, TURN_START, TURN_END, TEXT_DELTA, MODE_SET, MODE_CHANGED, MODEL_SET, MODEL_CHANGED, TASKS_REQUEST, DAEMON_STOP, DAEMON_STOPPING, SHARE_REQUEST, frameType, frameTurnId, encodeInput, encodeCancel, encodeApprovalReply, decodeSessionHello, decodeApprovalRequest, decodeTurnStart, decodeModeChanged, decodeModelChanged, decodeDaemonStopping, decodeTextDelta, encodeModeSet, encodeModelSet, encodeTasksRequest, encodeDaemonStop, encodeShareRequest } from "../protocol/frames.ts";
import { InputLine, InputHistory, PendingApproval, PendingUpdateOffer, PendingPlanDecision, approvalOptionForChar, APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { TurnStatusTracker, appendFrame, drawScreen } from "./screen.ts";
import { ApprovalLog, repaintApprovalOptionsLocal, answerApprovalLocal, reportIfResolvedElsewhereLocal } from "./attach_approval.ts";
import { isTaskTurnId, appendTaggedFrame, TaggedTurns } from "./tasks_bridge.ts";
import { PlanOfferTracker, maybeOfferPlanDecision, tryHandlePlanDecisionArrow, tryHandlePlanDecisionEnter, tryHandlePlanDecisionChar } from "./attach_plan.ts";
import { isNavigationKey, handleNavigationKey } from "./attach_keys.ts";
import { MODE_AUTO_EDIT, MODE_PLAN } from "./attach_slots.ts";
import { stylePrompt, styleBanner } from "./style.ts";
import { buildWelcomeBox } from "./layout.ts";
import { resolveResume, hasContinueFlag } from "./resume.ts";
import { startUpdateNotifier, pollUpdateNotice } from "./update_notice.ts";
import { DaemonClient } from "../daemon/attach_client.ts";
import { AttachResult, ensureAttached, runAttachStop, hasStopFlag } from "../daemon/attach_lifecycle.ts";
import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SHARE, CMD_LOGIN, CMD_LOGOUT, CMD_CAT, CMD_TASKS, CMD_MEMORY, CMD_UPDATE, CMD_CLEAR, CMD_EXIT, CMD_NONE } from "./commands.ts";
import { catText } from "./cat.ts";
import { SignIn, beginSignIn, submitSignIn, cancelSignIn, logoutText } from "./login_ui.ts";
import { memoryCommandText } from "./memory_ui.ts";
import { loadConfig, loadServerOrigin } from "../providers/config.ts";
import { ServerOrigin } from "../auth/server.ts";
import { PendingUpdateInstall, beginUpdateInstall, tryHandleUpdateOfferArrow, tryHandleUpdateOfferEnter, tryHandleUpdateOfferChar } from "./update_offer.ts";
import { pollUpdateInstall } from "./update_install_poll.ts";
import { VERSION } from "../version.ts";

const STDIN: int = 0;
const POLL_MS: int = 100;

export function runStop(argv: string[]): void {
  runAttachStop(process.cwd());
}

function attachHelpText(): string {
  return helpText()
    + "\n/stop-daemon    ask this workspace's daemon to stop (any attached client may; it takes effect once any in-flight turn finishes, see docs/03-daemon.md)";
}

export function runDaemonJoule(argv: string[]): bool {
  let workspaceRoot = process.cwd();
  if (!isatty(STDIN)) {
    console.log("joule needs a real terminal");
    process.exit(1);
    return true;
  }
  let cfg = loadConfig(argv);
  if (cfg.apiKey == "") { return false; }
  let serverBase = loadServerOrigin(argv);
  let wantsResume = hasContinueFlag(argv);
  let result = ensureAttached(workspaceRoot, wantsResume);
  if (!result.client.socketReady) {
    console.log("joule: could not reach or start a daemon for " + workspaceRoot + " - running in-process instead");
    return false;
  }
  runClientLoop(argv, workspaceRoot, cfg.model, serverBase, result, wantsResume, false);
  return true;
}

export function runAttach(argv: string[]): void {
  let workspaceRoot = process.cwd();

  if (hasStopFlag(argv)) {
    runAttachStop(workspaceRoot);
    return;
  }

  if (!isatty(STDIN)) {
    console.log("joule attach needs a real terminal");
    process.exit(1);
    return;
  }

  let cfg = loadConfig(argv);
  let serverBase = loadServerOrigin(argv);
  let wantsResume = hasContinueFlag(argv);
  let result = ensureAttached(workspaceRoot, wantsResume);
  if (!result.client.socketReady) {
    console.log("joule attach: could not reach a daemon for " + workspaceRoot);
    process.exit(1);
    return;
  }
  runClientLoop(argv, workspaceRoot, cfg.model, serverBase, result, wantsResume, true);
}

function resumeNoteFor(argv: string[], workspaceRoot: string, result: AttachResult, wantsResume: bool): string {
  if (result.spawned) {
    return resolveResume(argv, workspaceRoot).note;
  }
  if (wantsResume && result.pending.length > 0) {
    return "\n" + styleBanner("--- resumed previous session ---");
  }
  if (wantsResume) {
    return "\n" + styleBanner("already attached to a running session for this workspace - --continue only applies when starting a new daemon");
  }
  return "";
}

class ClientState {
  model: string;
  turnId: string;
  stopReason: string;

  constructor(model: string) {
    this.model = model;
    this.turnId = "";
    this.stopReason = "";
  }
}

function runClientLoop(argv: string[], workspaceRoot: string, initialModel: string, serverBase: ServerOrigin, result: AttachResult, wantsResume: bool, announceDaemon: bool): void {
  let client = result.client;
  let sb = new Scrollback();
  let input = new InputLine();
  let history = new InputHistory();
  let rk = new TurnStatusTracker();
  let pendingApproval = new PendingApproval();
  let signin = new SignIn();
  let updateOffer = new PendingUpdateOffer();
  let updateInstall = new PendingUpdateInstall();
  let planPending = new PendingPlanDecision();
  let planTracker = new PlanOfferTracker();
  let tagged = new TaggedTurns();
  let notifier = startUpdateNotifier();

  let approvalLog = new ApprovalLog(MODE_AUTO_EDIT);
  let state = new ClientState(initialModel);

  let setMode = (m: string) => {
    client.publish(encodeModeSet({ v: PROTOCOL_VERSION, seq: 0, type: MODE_SET, mode: m }));
  };
  let sendInput = (t: string) => {
    client.publish(encodeInput({ v: PROTOCOL_VERSION, seq: 0, type: INPUT, text: t }));
  };

  let processFrames = (frames: string[], isReplay: bool): bool => {
    let daemonStopped = false;
    for (const f of frames) {
      let t = frameType(f);
      let tagged1 = isTaskTurnId(frameTurnId(f));
      if (tagged1) {
        appendTaggedFrame(sb, tagged, f);
      } else {
        appendFrame(sb, rk, f);
      }
      if (t == SESSION_HELLO) {
        let hello = decodeSessionHello(f);
        if (hello != null) { approvalLog.mode = hello.mode; state.model = hello.model; }
      }
      if (t == TURN_START) {
        let start = decodeTurnStart(f);
        if (start != null) {
          state.turnId = start.turnId;
          if (isReplay && !tagged1 && start.prompt != "") {
            sb.append("\n" + stylePrompt("> ") + start.prompt);
          }
        }
        if (!tagged1) { planTracker.noteTurnStart(); }
      }
      if (t == TEXT_DELTA && !tagged1) {
        let delta = decodeTextDelta(f);
        if (delta != null) { planTracker.noteAssistantText(delta.text); }
      }
      if (t == APPROVAL_REQUEST) {
        let req = decodeApprovalRequest(f);
        if (req != null) {
          pendingApproval.set(req.callId);
          pendingApproval.setTool(req.tool);
          pendingApproval.setOptionRows(sb.lineCount() - APPROVAL_OPTION_COUNT);
        }
      }
      if (t == MODE_CHANGED) {
        let modeChanged = decodeModeChanged(f);
        if (modeChanged != null) {
          if (modeChanged.mode == MODE_PLAN && approvalLog.mode != MODE_PLAN) { planPending.setPreviousMode(approvalLog.mode); }
          approvalLog.mode = modeChanged.mode;
        }
      }
      if (t == MODEL_CHANGED) {
        let modelChanged = decodeModelChanged(f);
        if (modelChanged != null) { state.model = modelChanged.model; }
      }
      if (t == DAEMON_STOPPING) {
        let stopping = decodeDaemonStopping(f);
        state.stopReason = "an attached client asked it to stop";
        if (stopping != null) { state.stopReason = stopping.reason; }
        daemonStopped = true;
      }
      if (t == TURN_END && !tagged1) { maybeOfferPlanDecision(planPending, planTracker, approvalLog.mode, sb, f); }
      drawScreen(sb, input, approvalLog.mode, rk);
    }
    return daemonStopped;
  };

  process.stdout().write(ENTER_ALT_SCREEN + HIDE_CURSOR + ENABLE_MOUSE_REPORTING);
  rawEnable(STDIN);

  sb.append(buildWelcomeBox(state.model, workspaceRoot, approvalLog.mode, serverBase.base));
  if (announceDaemon) {
    sb.append("\n" + styleBanner("joule attach - connected to a daemon at " + workspaceRoot));
    sb.append("\n" + styleBanner("type a request, /help for commands, ctrl-d to detach"));
  } else {
    sb.append("\n\n" + styleBanner("joule - type a request, /help for commands, ctrl-d to quit"));
  }
  let resumeNote = resumeNoteFor(argv, workspaceRoot, result, wantsResume);
  if (resumeNote != "") { sb.append(resumeNote); }
  drawScreen(sb, input, approvalLog.mode, rk);

  for (const a of argv) {
    if (a == "--share") { client.publish(encodeShareRequest({ v: PROTOCOL_VERSION, seq: 0, type: SHARE_REQUEST })); }
  }

  let running = true;
  if (result.pending.length > 0) {
    let stoppedAlready = processFrames(result.pending, true);
    drawScreen(sb, input, approvalLog.mode, rk);
    if (stoppedAlready) { client.detach(); running = false; }
  }

  while (running) {
    let k = readKeyTimeout(STDIN, POLL_MS);

    if (k.kind == KEY_TIMEOUT) {
      let frames = client.pollInbound();
      let daemonStopped = processFrames(frames, false);
      let diags = client.drainDiagnostics();
      for (const d of diags) {
        appendFrame(sb, rk, d);
        drawScreen(sb, input, approvalLog.mode, rk);
      }
      pollUpdateNotice(notifier, updateOffer, sb, input, approvalLog.mode, rk);
      pollUpdateInstall(updateInstall, sb, input, approvalLog.mode, rk);
      reportIfResolvedElsewhereLocal(approvalLog, sb, input, rk, pendingApproval);
      if (daemonStopped) {
        client.detach();
        running = false;
      }
      continue;
    }

    if (k.kind == KEY_CTRL_D || k.kind == KEY_EOF) { running = false; continue; }

    if (k.kind == KEY_CTRL_C) {
      if (signin.isActive()) {
        cancelSignIn(sb, input, signin);
        drawScreen(sb, input, approvalLog.mode, rk);
      } else if (pendingApproval.callId != "") {
        sendApprovalDecision(client, approvalLog, sb, input, rk, pendingApproval, APPROVAL_OPTION_DENY);
        client.publish(encodeCancel({ v: PROTOCOL_VERSION, seq: 0, type: CANCEL, turnId: state.turnId }));
      } else if (input.buf != "") {
        input.clear();
        drawScreen(sb, input, approvalLog.mode, rk);
      } else {
        running = false;
      }
      continue;
    }

    if (k.kind == KEY_BACKSPACE) {
      input.backspace();
      history.cancelNavigation();
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (k.kind == KEY_CHAR) {
      if (input.capturing()) { input.push(k.char); drawScreen(sb, input, approvalLog.mode, rk); continue; }
      let optionIndex = approvalOptionForChar(k.char);
      if (optionIndex >= 0 && pendingApproval.callId != "") {
        sendApprovalDecision(client, approvalLog, sb, input, rk, pendingApproval, optionIndex);
        continue;
      }
      if (tryHandleUpdateOfferChar(updateOffer, updateInstall, VERSION, sb, input.buf == "", k.char)) { drawScreen(sb, input, approvalLog.mode, rk); continue; }
      if (tryHandlePlanDecisionChar(planPending, sb, input.buf == "", k.char, setMode, sendInput)) { drawScreen(sb, input, approvalLog.mode, rk); continue; }
      input.push(k.char);
      history.cancelNavigation();
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (k.kind == KEY_ARROW_UP && pendingApproval.callId != "") {
      if (pendingApproval.moveSelection(-1, APPROVAL_OPTION_COUNT)) {
        repaintApprovalOptionsLocal(sb, pendingApproval);
        drawScreen(sb, input, approvalLog.mode, rk);
      }
      continue;
    }

    if (k.kind == KEY_ARROW_DOWN && pendingApproval.callId != "") {
      if (pendingApproval.moveSelection(1, APPROVAL_OPTION_COUNT)) {
        repaintApprovalOptionsLocal(sb, pendingApproval);
        drawScreen(sb, input, approvalLog.mode, rk);
      }
      continue;
    }

    if (k.kind == KEY_ARROW_UP || k.kind == KEY_ARROW_DOWN) {
      let delta = -1;
      if (k.kind == KEY_ARROW_DOWN) { delta = 1; }
      if (tryHandleUpdateOfferArrow(updateOffer, sb, input.buf == "", delta)) { drawScreen(sb, input, approvalLog.mode, rk); continue; }
      if (tryHandlePlanDecisionArrow(planPending, sb, input.buf == "", delta)) { drawScreen(sb, input, approvalLog.mode, rk); continue; }
    }

    if (isNavigationKey(k.kind)) {
      if (handleNavigationKey(k.kind, input, history, sb, approvalLog.mode, setMode)) {
        drawScreen(sb, input, approvalLog.mode, rk);
      }
      continue;
    }

    if (k.kind != KEY_ENTER) { continue; }

    if (signin.isActive() && input.buf.trim() == "") { continue; }

    if (pendingApproval.callId != "") {
      sendApprovalDecision(client, approvalLog, sb, input, rk, pendingApproval, pendingApproval.selected);
      continue;
    }

    if (tryHandleUpdateOfferEnter(updateOffer, updateInstall, VERSION, sb, input.buf == "")) { drawScreen(sb, input, approvalLog.mode, rk); continue; }
    if (tryHandlePlanDecisionEnter(planPending, sb, input.buf == "", setMode, sendInput)) { drawScreen(sb, input, approvalLog.mode, rk); continue; }

    let line = input.takeAndClear();
    drawScreen(sb, input, approvalLog.mode, rk);
    if (line.trim() == "") { continue; }

    if (signin.isActive()) {
      submitSignIn(sb, input, signin, line);
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (line.trim() == "/stop-daemon") {
      client.publish(encodeDaemonStop({ v: PROTOCOL_VERSION, seq: 0, type: DAEMON_STOP }));
      sb.append("\nasked the daemon to stop");
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    let cmd = parseCommand(line);

    if (cmd.kind == CMD_NONE) {
      history.record(line);
      sb.append("\n" + stylePrompt("> ") + line);
      drawScreen(sb, input, approvalLog.mode, rk);
      sendInput(line);
      continue;
    }

    if (cmd.kind == CMD_HELP) { sb.append("\n" + attachHelpText()); drawScreen(sb, input, approvalLog.mode, rk); continue; }

    if (cmd.kind == CMD_MODEL) {
      if (cmd.arg == "") {
        sb.append("\nmodel: " + state.model);
      } else {
        client.publish(encodeModelSet({ v: PROTOCOL_VERSION, seq: 0, type: MODEL_SET, model: cmd.arg }));
      }
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_MODE) {
      if (cmd.arg == "") {
        sb.append("\nmode: " + approvalLog.mode);
      } else {
        setMode(cmd.arg);
      }
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_SHARE) {
      client.publish(encodeShareRequest({ v: PROTOCOL_VERSION, seq: 0, type: SHARE_REQUEST }));
      sb.append("\nasking the daemon to share this session over the relay");
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_LOGIN) {
      beginSignIn(sb, input, signin, serverBase, cmd.arg);
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_LOGOUT) { sb.append(logoutText(serverBase.base, cmd.arg)); drawScreen(sb, input, approvalLog.mode, rk); continue; }

    if (cmd.kind == CMD_CAT) {
      sb.append(catText(workspaceRoot, cmd.arg));
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_UPDATE) { beginUpdateInstall(updateInstall, VERSION, sb); drawScreen(sb, input, approvalLog.mode, rk); continue; }

    if (cmd.kind == CMD_MEMORY) { sb.append(memoryCommandText(cmd.arg)); drawScreen(sb, input, approvalLog.mode, rk); continue; }

    if (cmd.kind == CMD_TASKS) {
      client.publish(encodeTasksRequest({ v: PROTOCOL_VERSION, seq: 0, type: TASKS_REQUEST, arg: cmd.arg }));
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_CLEAR) { sb.clear(); drawScreen(sb, input, approvalLog.mode, rk); continue; }

    if (cmd.kind == CMD_EXIT) { running = false; continue; }

    sb.append("\nunknown command: /" + cmd.arg);
    drawScreen(sb, input, approvalLog.mode, rk);
  }

  client.detach();
  process.stdout().write(DISABLE_MOUSE_REPORTING + SHOW_CURSOR + EXIT_ALT_SCREEN);
  rawDisable(STDIN);

  if (state.stopReason != "") {
    console.log("joule: the daemon stopped (" + state.stopReason + ")");
  }
}

function sendApprovalDecision(client: DaemonClient, log: ApprovalLog, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval, index: int): void {
  let callId = pending.callId;
  let decision = answerApprovalLocal(log, sb, input, rk, pending, index);
  client.publish(encodeApprovalReply({ v: PROTOCOL_VERSION, seq: 0, type: APPROVAL_REPLY, callId: callId, decision: decision }));
}
