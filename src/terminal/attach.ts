import { isatty, rawEnable, rawDisable, readKeyTimeout, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF, KEY_TIMEOUT, KEY_ARROW_UP, KEY_ARROW_DOWN } from "../vendor/tty/tty.ts";
import { PROTOCOL_VERSION, INPUT, CANCEL, APPROVAL_REPLY, SESSION_HELLO, APPROVAL_REQUEST, TURN_START, TURN_END, TEXT_DELTA, MODE_SET, MODE_CHANGED, MODEL_SET, MODEL_CHANGED, TASKS_REQUEST, DAEMON_STOP, DAEMON_STOPPING, SHARE_REQUEST, frameType, frameTurnId, encodeInput, encodeCancel, encodeApprovalReply, decodeSessionHello, decodeApprovalRequest, decodeTurnStart, decodeModeChanged, decodeModelChanged, decodeDaemonStopping, decodeTextDelta, encodeModeSet, encodeModelSet, encodeTasksRequest, encodeDaemonStop, encodeShareRequest } from "../protocol/frames.ts";
import { InputLine, InputHistory, PendingApproval, PendingUpdateOffer, PendingPlanDecision, PendingQuitDecision, PendingSessionPick, quitDecisionOptionForChar, QUIT_DECISION_KEEP, QUIT_DECISION_QUIT, QUIT_DECISION_STAY, approvalOptionForChar, APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { openQuitDecision, repaintQuitDecision, backgroundKeptNotes } from "./quit_decision.ts";
import { warmSessionNotes, sessionDisplayName, joulePlusSession, openSessionPick, repaintSessionPick, stayingNote, pickableSessions } from "./session_switch.ts";
import { renameTargetCheck, renameNotes } from "./session_rename.ts";
import { Scrollback } from "./scrollback.ts";
import { TurnStatusTracker, appendFrame, drawScreen } from "./screen.ts";
import { ApprovalLog, repaintApprovalOptionsLocal, answerApprovalLocal, reportIfResolvedElsewhereLocal, beginApprovalBlockLocal } from "./attach_approval.ts";
import { isTaskTurnId, appendTaggedFrame, TaggedTurns } from "./tasks_bridge.ts";
import { PlanOfferTracker, maybeOfferPlanDecision, tryHandlePlanDecisionArrow, tryHandlePlanDecisionEnter, tryHandlePlanDecisionChar } from "./attach_plan.ts";
import { isNavigationKey, handleNavigationKey } from "./attach_keys.ts";
import { TurnWatchdog } from "./attach_watchdog.ts";
import { MODE_SAFE_AUTO, MODE_PLAN } from "./attach_slots.ts";
import { stylePrompt, styleBanner } from "./style.ts";
import { buildWelcomeBox, terminalWidth } from "./layout.ts";
import { resolveResume, hasContinueFlag } from "./resume.ts";
import { describeSessionSuffix } from "../session/persistence.ts";
import { startUpdateNotifier, pollUpdateNotice } from "./update_notice.ts";
import { DaemonClient } from "../daemon/attach_client.ts";
import { AttachResult, ensureAttached, runAttachStop, hasStopFlag, sessionNameFlag, attachedMode, attachedModel, sawStopping, runningSessionsFor } from "../daemon/attach_lifecycle.ts";
import { DaemonAttempt, attached, declined, declineNotes } from "./daemon_attempt.ts";
import { LocalPrompts } from "./attach_echo.ts";
import { runSkillCommand, skillsStartupNote } from "./skills_ui.ts";
import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SESSION, CMD_RENAME, CMD_SHARE, CMD_LOGIN, CMD_LOGOUT, CMD_CAT, CMD_TASKS, CMD_MEMORY, CMD_SKILLS, CMD_MOUSE, CMD_COLOR, CMD_CLEAR, CMD_EXIT, CMD_NONE } from "./commands.ts";
import { applyConfiguredAccent, runColorCommand } from "./color_ui.ts";
import { catText } from "./cat.ts";
import { SignIn, beginSignIn, submitSignIn, cancelSignIn, logoutText } from "./login_ui.ts";
import { memoryCommandText } from "./memory_ui.ts";
import { loadConfig, loadServerOrigin } from "../providers/config.ts";
import { displayModel } from "../providers/platform.ts";
import { ServerOrigin } from "../auth/server.ts";
import { PendingUpdateInstall, tryHandleUpdateOfferArrow, tryHandleUpdateOfferEnter, tryHandleUpdateOfferChar } from "./update_offer.ts";
import { pollUpdateInstall } from "./update_install_poll.ts";
import { VERSION } from "../version.ts";
import { workspaceRoot as currentWorkspaceRoot } from "../vendor/platform/platform.ts";
import { enterScreen, leaveScreen, runMouseCommand } from "./mouse_reporting.ts";
import { applyMouseState } from "./mouse_select.ts";

const STDIN: int = 0;
const POLL_MS: int = 100;

// How long "quit and end the session" waits for the daemon to acknowledge the
// stop before giving up on hearing it. `joule --stop` waits five seconds, but
// that is a command whose whole job is stopping; here someone is walking away
// from a terminal, so a short wait that still catches the common idle case
// beats holding the screen. An unacknowledged stop still reached the daemon -
// the note says so, and points at `joule --stop`.
const QUIT_STOP_ACK_TICKS: int = 20;

// "Quit and end the session" has to actually reach the daemon: publish the
// stop, then hold the socket open long enough for the DAEMON_STOPPING that
// answers it, the same handshake `joule --stop` does.
function stopDaemonAndWait(client: DaemonClient): bool {
  client.publish(encodeDaemonStop({ v: PROTOCOL_VERSION, seq: 0, type: DAEMON_STOP }));
  let acked = false;
  let i = 0;
  while (i < QUIT_STOP_ACK_TICKS && !acked) {
    acked = sawStopping(client.pollInbound());
    if (!acked) { process.sleep(POLL_MS); }
    i = i + 1;
  }
  return acked;
}

export function runStop(argv: string[]): void {
  runAttachStop(currentWorkspaceRoot(), sessionNameFlag(argv));
}

function attachHelpText(): string {
  return helpText()
    + "\n/stop-daemon    ask this workspace's daemon to stop (any attached client may; it takes effect once any in-flight turn finishes, see docs/03-daemon.md)";
}

export function runDaemonJoule(argv: string[]): DaemonAttempt {
  let workspaceRoot = currentWorkspaceRoot();
  if (!isatty(STDIN)) {
    console.log("joule needs a real terminal");
    process.exit(1);
    return declined([]);
  }
  let cfg = loadConfig(argv);
  if (cfg.apiKey == "") { return declined([]); }
  let serverBase = loadServerOrigin(argv);
  let sessionName = sessionNameFlag(argv);
  let wantsResume = hasContinueFlag(argv);
  let result = ensureAttached(workspaceRoot, sessionName, wantsResume);
  if (!result.client.socketReady) {
    return declined(declineNotes(result.notes, workspaceRoot));
  }
  runClientLoop(argv, workspaceRoot, sessionName, displayModel(cfg), serverBase, result, wantsResume, false);
  return attached();
}

export function runAttach(argv: string[]): void {
  let workspaceRoot = currentWorkspaceRoot();
  let sessionName = sessionNameFlag(argv);

  if (hasStopFlag(argv)) {
    runAttachStop(workspaceRoot, sessionName);
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
  let result = ensureAttached(workspaceRoot, sessionName, wantsResume);
  if (!result.client.socketReady) {
    for (const n of result.notes) { console.log(n); }
    console.log("joule attach: could not reach a daemon for " + workspaceRoot + describeSessionSuffix(sessionName));
    process.exit(1);
    return;
  }
  runClientLoop(argv, workspaceRoot, sessionName, displayModel(cfg), serverBase, result, wantsResume, true);
}

function resumeNoteFor(argv: string[], workspaceRoot: string, sessionName: string, result: AttachResult, wantsResume: bool): string {
  if (result.spawned) {
    return resolveResume(argv, workspaceRoot, sessionName).note;
  }
  if (wantsResume && result.pending.length > 0) {
    return "\n" + styleBanner("--- resumed previous session ---");
  }
  if (wantsResume) {
    return "\n" + styleBanner("already attached to a running session for this workspace" + describeSessionSuffix(sessionName) + " - --continue only applies when starting a new daemon");
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

function runClientLoop(argv: string[], workspaceRoot: string, sessionName: string, initialModel: string, serverBase: ServerOrigin, result: AttachResult, wantsResume: bool, announceDaemon: bool): void {
  applyConfiguredAccent();
  let client = result.client;
  let sb = new Scrollback();
  sb.setWidth(terminalWidth());
  let input = new InputLine();
  let history = new InputHistory();
  let rk = new TurnStatusTracker();
  let pendingApproval = new PendingApproval();
  let signin = new SignIn();
  let updateOffer = new PendingUpdateOffer();
  let updateInstall = new PendingUpdateInstall();
  let planPending = new PendingPlanDecision();
  let quitDecision = new PendingQuitDecision();
  let sessionPick = new PendingSessionPick();
  let planTracker = new PlanOfferTracker();
  let tagged = new TaggedTurns();
  let notifier = startUpdateNotifier();

  let approvalLog = new ApprovalLog(attachedMode(result.pending, MODE_SAFE_AUTO));
  let state = new ClientState(attachedModel(result.pending, initialModel));
  let watchdog = new TurnWatchdog(result.port);
  let echoes = new LocalPrompts();

  let setMode = (m: string) => {
    client.publish(encodeModeSet({ v: PROTOCOL_VERSION, seq: 0, type: MODE_SET, mode: m }));
  };
  let sendInput = (t: string) => {
    client.publish(encodeInput({ v: PROTOCOL_VERSION, seq: 0, type: INPUT, text: t }));
    echoes.note(t);
    watchdog.noteRequestSent(Date.now());
  };

  let processFrames = (frames: string[], isReplay: bool): bool => {
    let daemonStopped = false;
    for (const f of frames) {
      if (!isReplay) { watchdog.noteDaemonAnswered(); }
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
          if (!tagged1 && start.prompt != "" && !echoes.claim(start.prompt)) {
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
          beginApprovalBlockLocal(sb, pendingApproval, req.callId, req.tool, req.summary, req.detail);
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

  let mouse = enterScreen();
  applyMouseState(sb, mouse.on);
  rawEnable(STDIN);

  sb.append(buildWelcomeBox(state.model, workspaceRoot, approvalLog.mode, serverBase.base) + skillsStartupNote(workspaceRoot));
  if (announceDaemon) {
    sb.append("\n" + styleBanner("joule attach - connected to a daemon at " + workspaceRoot));
    sb.append("\n" + styleBanner("type a request, /help for commands, ctrl-d to detach"));
  } else {
    sb.append("\n\n" + styleBanner("joule - type a request, /help for commands, ctrl-d to quit"));
  }
  for (const n of result.notes) { sb.append("\n" + styleBanner(n)); }
  let resumeNote = resumeNoteFor(argv, workspaceRoot, sessionName, result, wantsResume);
  if (resumeNote != "") { sb.append(resumeNote); }
  drawScreen(sb, input, approvalLog.mode, rk);

  for (const a of argv) {
    if (a == "--share") { client.publish(encodeShareRequest({ v: PROTOCOL_VERSION, seq: 0, type: SHARE_REQUEST })); }
  }

  let running = true;
  let keepInBackground = false;
  let stopRequested = false;
  let switchTarget = "";
  let renameTarget = "";
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
      let unanswered = watchdog.takeOverdueNotice(Date.now());
      if (unanswered != "") {
        appendFrame(sb, rk, unanswered);
        drawScreen(sb, input, approvalLog.mode, rk);
      }
      pollUpdateNotice(notifier, updateOffer, sb, input, approvalLog.mode, rk);
      pollUpdateInstall(updateInstall, sessionName, sb, input, approvalLog.mode, rk);
      reportIfResolvedElsewhereLocal(approvalLog, sb, input, rk, pendingApproval);
      if (daemonStopped) {
        client.detach();
        running = false;
      }
      continue;
    }

    // While the Ctrl-C prompt is open it owns the keyboard: arrows move the
    // choice, a number or its initial picks one, and a second Ctrl-C/Ctrl-D is
    // a fast "quit". Anything else is swallowed so it cannot leak to the input.
    if (quitDecision.isPending()) {
      if (k.kind == KEY_ARROW_UP) { if (quitDecision.moveSelection(-1)) { repaintQuitDecision(sb, quitDecision); drawScreen(sb, input, approvalLog.mode, rk); } continue; }
      if (k.kind == KEY_ARROW_DOWN) { if (quitDecision.moveSelection(1)) { repaintQuitDecision(sb, quitDecision); drawScreen(sb, input, approvalLog.mode, rk); } continue; }
      let choice = -1;
      if (k.kind == KEY_ENTER) { choice = quitDecision.selected; }
      else if (k.kind == KEY_CHAR) { choice = quitDecisionOptionForChar(k.char); }
      else if (k.kind == KEY_CTRL_C || k.kind == KEY_CTRL_D || k.kind == KEY_EOF) { choice = QUIT_DECISION_QUIT; }
      if (choice < 0) { continue; }
      quitDecision.close();
      if (choice == QUIT_DECISION_STAY) {
        sb.append("\n" + styleBanner("staying in this session"));
        drawScreen(sb, input, approvalLog.mode, rk);
        continue;
      }
      keepInBackground = (choice == QUIT_DECISION_KEEP);
      stopRequested = (choice == QUIT_DECISION_QUIT);
      running = false;
      continue;
    }

    // The /session picker owns the keyboard the same way: arrows move the
    // choice, enter picks it - the current session's own row means stay -
    // and anything else is swallowed rather than leaking into the input.
    if (sessionPick.isPending()) {
      if (k.kind == KEY_ARROW_UP) { if (sessionPick.moveSelection(-1)) { repaintSessionPick(sb, sessionPick, sessionName); drawScreen(sb, input, approvalLog.mode, rk); } continue; }
      if (k.kind == KEY_ARROW_DOWN) { if (sessionPick.moveSelection(1)) { repaintSessionPick(sb, sessionPick, sessionName); drawScreen(sb, input, approvalLog.mode, rk); } continue; }
      if (k.kind != KEY_ENTER) { continue; }
      let picked = sessionPick.selectedEntry();
      sessionPick.close();
      if (picked == sessionName) {
        sb.append(stayingNote(sessionName));
      } else {
        switchTarget = picked;
        running = false;
      }
      drawScreen(sb, input, approvalLog.mode, rk);
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
        // The session lives in the daemon, not here, so leaving is a real
        // choice: walk away and it keeps running, or say so and it stops.
        openQuitDecision(quitDecision, sb);
        drawScreen(sb, input, approvalLog.mode, rk);
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
      if (handleNavigationKey(k, input, history, sb, approvalLog.mode, setMode)) {
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
      sb.append("\n" + stylePrompt("> ") + line);
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

    sb.append("\n" + stylePrompt("> ") + line);

    if (cmd.kind == CMD_HELP) { sb.append("\n" + attachHelpText()); drawScreen(sb, input, approvalLog.mode, rk); continue; }
    if (cmd.kind == CMD_SKILLS) { let skillInput = runSkillCommand(workspaceRoot, cmd.arg, sb); drawScreen(sb, input, approvalLog.mode, rk); if (skillInput != "") { sendInput(skillInput); } continue; }

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

    if (cmd.kind == CMD_SESSION) {
      if (cmd.arg == "") {
        let names = pickableSessions(workspaceRoot, sessionName);
        if (names.length <= 1) {
          sb.append("\nsession: " + sessionDisplayName(sessionName));
        } else {
          openSessionPick(sessionPick, sb, names, sessionName);
        }
      } else if (cmd.arg == sessionName) {
        sb.append("\nalready in the " + sessionDisplayName(sessionName) + " session");
      } else {
        switchTarget = cmd.arg;
        running = false;
        continue;
      }
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_RENAME) {
      let check = renameTargetCheck(workspaceRoot, cmd.arg, sessionName, runningSessionsFor(workspaceRoot));
      if (!check.ok) {
        sb.append(check.error);
        drawScreen(sb, input, approvalLog.mode, rk);
      } else {
        renameTarget = cmd.arg.trim();
        running = false;
      }
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

    if (cmd.kind == CMD_MEMORY) { sb.append(memoryCommandText(cmd.arg)); drawScreen(sb, input, approvalLog.mode, rk); continue; }

    if (cmd.kind == CMD_MOUSE) { sb.append(runMouseCommand(mouse, cmd.arg)); applyMouseState(sb, mouse.on); drawScreen(sb, input, approvalLog.mode, rk); continue; }

    if (cmd.kind == CMD_COLOR) { sb.append(runColorCommand(cmd.arg)); drawScreen(sb, input, approvalLog.mode, rk); continue; }

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

  let stopAcked = false;
  if (stopRequested) { stopAcked = stopDaemonAndWait(client); }
  client.detach();
  leaveScreen(mouse);
  rawDisable(STDIN);

  if (keepInBackground) {
    for (const n of backgroundKeptNotes(result.port, sessionName)) { console.log(n); }
  }
  if (switchTarget != "") {
    for (const n of warmSessionNotes(workspaceRoot, switchTarget)) { console.log(n); }
    console.log("joule: this session" + describeSessionSuffix(sessionName) + " keeps running - " + joulePlusSession("joule", sessionName) + " returns to it.");
  }
  if (renameTarget != "") {
    for (const n of renameNotes(workspaceRoot, sessionName, renameTarget, null)) { console.log(n); }
  }
  if (stopRequested) {
    if (stopAcked) {
      console.log("joule: the background session has stopped.");
    } else {
      console.log("joule: asked the background session to stop - it may be finishing an in-flight turn; check with joule --stop if it lingers.");
    }
  }
  if (state.stopReason != "") {
    console.log("joule: the daemon stopped (" + state.stopReason + ")");
  }
}

function sendApprovalDecision(client: DaemonClient, log: ApprovalLog, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval, index: int): void {
  let callId = pending.callId;
  let decision = answerApprovalLocal(log, sb, input, rk, pending, index);
  client.publish(encodeApprovalReply({ v: PROTOCOL_VERSION, seq: 0, type: APPROVAL_REPLY, callId: callId, decision: decision }));
}
