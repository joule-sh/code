import { isatty, rawEnable, rawDisable, readKeyTimeout, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF, KEY_TIMEOUT, KEY_ARROW_UP, KEY_ARROW_DOWN } from "../vendor/tty/tty.ts";
import { PROTOCOL_VERSION, INPUT, CANCEL, APPROVAL_REPLY, SESSION_HELLO, APPROVAL_REQUEST, TURN_START, TURN_END, TEXT_DELTA, MODE_SET, MODE_CHANGED, MODEL_SET, MODEL_CHANGED, TASKS_REQUEST, DAEMON_STOP, DAEMON_STOPPING, SHARE_REQUEST, frameType, frameTurnId, encodeInput, encodeCancel, encodeApprovalReply, decodeSessionHello, decodeApprovalRequest, decodeTurnStart, decodeModeChanged, decodeModelChanged, decodeDaemonStopping, decodeTextDelta, encodeModeSet, encodeModelSet, encodeTasksRequest, encodeDaemonStop, encodeShareRequest } from "../protocol/frames.ts";
import { InputLine, InputHistory, PendingApproval, PendingUpdateOffer, PendingPlanDecision, PendingQuitDecision, PendingSessionPick, quitDecisionOptionForChar, QUIT_DECISION_KEEP, QUIT_DECISION_QUIT, QUIT_DECISION_STAY, approvalOptionForChar, APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { AttachedSession, switchSession } from "./attached_session.ts";
import { Drafts } from "./drafts.ts";
import { CommandDeps, runAttachCommand, attachHelpText } from "./attach_commands.ts";
import { FrameDeps, processAttachFrames } from "./attach_frames.ts";
import { openQuitDecision, repaintQuitDecision, backgroundKeptNotes } from "./quit_decision.ts";
import { openSessionPick, repaintSessionPick, stayingNote } from "./session_switch.ts";
import { renameTargetCheck, renameNotes } from "./session_rename.ts";
import { modeFlagResult, promptFlag } from "./startup_flags.ts";
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

const QUIT_STOP_ACK_TICKS: int = 20;

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

function runClientLoop(argv: string[], workspaceRoot: string, sessionName: string, initialModel: string, serverBase: ServerOrigin, result: AttachResult, wantsResume: bool, announceDaemon: bool): void {
  applyConfiguredAccent();
  let modeChoice = modeFlagResult(argv);
  if (modeChoice.error != "") {
    console.log(modeChoice.error);
    process.exit(1);
    return;
  }
  let sess = new AttachedSession(sessionName, result, MODE_SAFE_AUTO, initialModel);
  let drafts = new Drafts();
  let sb = new Scrollback();
  sb.setWidth(terminalWidth());
  let input = new InputLine();
  let history = new InputHistory();
  let signin = new SignIn();
  let updateOffer = new PendingUpdateOffer();
  let updateInstall = new PendingUpdateInstall();
  let quitDecision = new PendingQuitDecision();
  let sessionPick = new PendingSessionPick();
  let notifier = startUpdateNotifier();

  let setMode = (m: string) => {
    sess.client.publish(encodeModeSet({ v: PROTOCOL_VERSION, seq: 0, type: MODE_SET, mode: m }));
  };
  let sendInput = (t: string) => {
    sess.client.publish(encodeInput({ v: PROTOCOL_VERSION, seq: 0, type: INPUT, text: t }));
    sess.echoes.note(t);
    sess.watchdog.noteRequestSent(Date.now());
    drafts.clear(sess.name);
  };

  let frameDeps = new FrameDeps(sb, input, sess);
  let processFrames = (frames: string[], isReplay: bool): bool => {
    return processAttachFrames(frameDeps, frames, isReplay);
  };

  let applySwitch = (target: string) => {
    let moved = switchSession(sess, workspaceRoot, target, drafts, input);
    if (!moved.ok) {
      for (const n of moved.notes) { sb.append("\n" + styleBanner(n)); }
      drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      return;
    }
    sb.clear();
    for (const n of moved.notes) { sb.append("\n" + styleBanner(n)); }
    sb.append("\n" + styleBanner("now in the " + sess.displayName() + " session"));
    processAttachFrames(frameDeps, moved.replay, true);
    drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
  };

  let mouse = enterScreen();
  applyMouseState(sb, mouse.on);
  rawEnable(STDIN);

  let cmdDeps = new CommandDeps(sb, input, sess, drafts, mouse, signin, sessionPick, serverBase, workspaceRoot);

  sb.append(buildWelcomeBox(sess.state.model, workspaceRoot, sess.approvalLog.mode, serverBase.base) + skillsStartupNote(workspaceRoot));
  if (announceDaemon) {
    sb.append("\n" + styleBanner("joule attach - connected to a daemon at " + workspaceRoot));
    sb.append("\n" + styleBanner("type a request, /help for commands, ctrl-d to detach"));
  } else {
    sb.append("\n\n" + styleBanner("joule - type a request, /help for commands, ctrl-d to quit"));
  }
  for (const n of result.notes) { sb.append("\n" + styleBanner(n)); }
  let resumeNote = resumeNoteFor(argv, workspaceRoot, sessionName, result, wantsResume);
  if (resumeNote != "") { sb.append(resumeNote); }
  drawScreen(sb, input, sess.approvalLog.mode, sess.rk);

  for (const a of argv) {
    if (a == "--share") { sess.client.publish(encodeShareRequest({ v: PROTOCOL_VERSION, seq: 0, type: SHARE_REQUEST })); }
  }

  if (modeChoice.mode != "") { setMode(modeChoice.mode); }
  let initialPrompt = promptFlag(argv);
  if (initialPrompt != "") {
    sb.append("\n" + stylePrompt("> ") + initialPrompt);
    drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
    sendInput(initialPrompt);
  }

  let running = true;
  let keepInBackground = false;
  let stopRequested = false;
  let renameTarget = "";
  if (result.pending.length > 0) {
    let stoppedAlready = processFrames(result.pending, true);
    drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
    if (stoppedAlready) { sess.client.detach(); running = false; }
  }

  while (running) {
    let k = readKeyTimeout(STDIN, POLL_MS);

    if (k.kind == KEY_TIMEOUT) {
      let frames = sess.client.pollInbound();
      let daemonStopped = processFrames(frames, false);
      let diags = sess.client.drainDiagnostics();
      for (const d of diags) {
        appendFrame(sb, sess.rk, d);
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      }
      let unanswered = sess.watchdog.takeOverdueNotice(Date.now());
      if (unanswered != "") {
        appendFrame(sb, sess.rk, unanswered);
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      }
      pollUpdateNotice(notifier, updateOffer, sb, input, sess.approvalLog.mode, sess.rk);
      pollUpdateInstall(updateInstall, sess.name, sb, input, sess.approvalLog.mode, sess.rk);
      reportIfResolvedElsewhereLocal(sess.approvalLog, sb, input, sess.rk, sess.pendingApproval);
      if (daemonStopped) {
        sess.client.detach();
        running = false;
      }
      continue;
    }

    if (quitDecision.isPending()) {
      if (k.kind == KEY_ARROW_UP) { if (quitDecision.moveSelection(-1)) { repaintQuitDecision(sb, quitDecision); drawScreen(sb, input, sess.approvalLog.mode, sess.rk); } continue; }
      if (k.kind == KEY_ARROW_DOWN) { if (quitDecision.moveSelection(1)) { repaintQuitDecision(sb, quitDecision); drawScreen(sb, input, sess.approvalLog.mode, sess.rk); } continue; }
      let choice = -1;
      if (k.kind == KEY_ENTER) { choice = quitDecision.selected; }
      else if (k.kind == KEY_CHAR) { choice = quitDecisionOptionForChar(k.char); }
      else if (k.kind == KEY_CTRL_C || k.kind == KEY_CTRL_D || k.kind == KEY_EOF) { choice = QUIT_DECISION_QUIT; }
      if (choice < 0) { continue; }
      quitDecision.close();
      if (choice == QUIT_DECISION_STAY) {
        sb.append("\n" + styleBanner("staying in this session"));
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
        continue;
      }
      keepInBackground = (choice == QUIT_DECISION_KEEP);
      stopRequested = (choice == QUIT_DECISION_QUIT);
      running = false;
      continue;
    }

    if (sessionPick.isPending()) {
      if (k.kind == KEY_ARROW_UP) { if (sessionPick.moveSelection(-1)) { repaintSessionPick(sb, sessionPick, sess.name); drawScreen(sb, input, sess.approvalLog.mode, sess.rk); } continue; }
      if (k.kind == KEY_ARROW_DOWN) { if (sessionPick.moveSelection(1)) { repaintSessionPick(sb, sessionPick, sess.name); drawScreen(sb, input, sess.approvalLog.mode, sess.rk); } continue; }
      if (k.kind != KEY_ENTER) { continue; }
      let picked = sessionPick.selectedEntry();
      sessionPick.close();
      if (picked == sess.name) {
        sb.append(stayingNote(sess.name));
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      } else {
        applySwitch(picked);
      }
      continue;
    }

    if (k.kind == KEY_CTRL_D || k.kind == KEY_EOF) { running = false; continue; }

    if (k.kind == KEY_CTRL_C) {
      if (signin.isActive()) {
        cancelSignIn(sb, input, signin);
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      } else if (sess.pendingApproval.callId != "") {
        sendApprovalDecision(sess.client, sess.approvalLog, sb, input, sess.rk, sess.pendingApproval, APPROVAL_OPTION_DENY);
        sess.client.publish(encodeCancel({ v: PROTOCOL_VERSION, seq: 0, type: CANCEL, turnId: sess.state.turnId }));
      } else if (input.buf != "") {
        input.clear();
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      } else {
        openQuitDecision(quitDecision, sb);
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      }
      continue;
    }

    if (k.kind == KEY_BACKSPACE) {
      input.backspace();
      history.cancelNavigation();
      drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      continue;
    }

    if (k.kind == KEY_CHAR) {
      if (input.capturing()) { input.push(k.char); drawScreen(sb, input, sess.approvalLog.mode, sess.rk); continue; }
      let optionIndex = approvalOptionForChar(k.char);
      if (optionIndex >= 0 && sess.pendingApproval.callId != "") {
        sendApprovalDecision(sess.client, sess.approvalLog, sb, input, sess.rk, sess.pendingApproval, optionIndex);
        continue;
      }
      if (tryHandleUpdateOfferChar(updateOffer, updateInstall, VERSION, sb, input.buf == "", k.char)) { drawScreen(sb, input, sess.approvalLog.mode, sess.rk); continue; }
      if (tryHandlePlanDecisionChar(sess.planPending, sb, input.buf == "", k.char, setMode, sendInput)) { drawScreen(sb, input, sess.approvalLog.mode, sess.rk); continue; }
      input.push(k.char);
      history.cancelNavigation();
      drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      continue;
    }

    if (k.kind == KEY_ARROW_UP && sess.pendingApproval.callId != "") {
      if (sess.pendingApproval.moveSelection(-1, APPROVAL_OPTION_COUNT)) {
        repaintApprovalOptionsLocal(sb, sess.pendingApproval);
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      }
      continue;
    }

    if (k.kind == KEY_ARROW_DOWN && sess.pendingApproval.callId != "") {
      if (sess.pendingApproval.moveSelection(1, APPROVAL_OPTION_COUNT)) {
        repaintApprovalOptionsLocal(sb, sess.pendingApproval);
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      }
      continue;
    }

    if (k.kind == KEY_ARROW_UP || k.kind == KEY_ARROW_DOWN) {
      let delta = -1;
      if (k.kind == KEY_ARROW_DOWN) { delta = 1; }
      if (tryHandleUpdateOfferArrow(updateOffer, sb, input.buf == "", delta)) { drawScreen(sb, input, sess.approvalLog.mode, sess.rk); continue; }
      if (tryHandlePlanDecisionArrow(sess.planPending, sb, input.buf == "", delta)) { drawScreen(sb, input, sess.approvalLog.mode, sess.rk); continue; }
    }

    if (isNavigationKey(k.kind)) {
      if (handleNavigationKey(k, input, history, sb, sess.approvalLog.mode, setMode)) {
        drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      }
      continue;
    }

    if (k.kind != KEY_ENTER) { continue; }

    if (signin.isActive() && input.buf.trim() == "") { continue; }

    if (sess.pendingApproval.callId != "") {
      sendApprovalDecision(sess.client, sess.approvalLog, sb, input, sess.rk, sess.pendingApproval, sess.pendingApproval.selected);
      continue;
    }

    if (tryHandleUpdateOfferEnter(updateOffer, updateInstall, VERSION, sb, input.buf == "")) { drawScreen(sb, input, sess.approvalLog.mode, sess.rk); continue; }
    if (tryHandlePlanDecisionEnter(sess.planPending, sb, input.buf == "", setMode, sendInput)) { drawScreen(sb, input, sess.approvalLog.mode, sess.rk); continue; }

    let line = input.takeAndClear();
    drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
    if (line.trim() == "") { continue; }

    if (signin.isActive()) {
      submitSignIn(sb, input, signin, line);
      drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      continue;
    }

    if (line.trim() == "/stop-daemon") {
      sb.append("\n" + stylePrompt("> ") + line);
      sess.client.publish(encodeDaemonStop({ v: PROTOCOL_VERSION, seq: 0, type: DAEMON_STOP }));
      sb.append("\nasked the daemon to stop");
      drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      continue;
    }

    let cmd = parseCommand(line);

    if (cmd.kind == CMD_NONE) {
      history.record(line);
      sb.append("\n" + stylePrompt("> ") + line);
      drawScreen(sb, input, sess.approvalLog.mode, sess.rk);
      sendInput(line);
      continue;
    }

    sb.append("\n" + stylePrompt("> ") + line);

    let outcome = runAttachCommand(cmdDeps, cmd, setMode, sendInput);
    if (outcome.switchTarget != "") { applySwitch(outcome.switchTarget); }
    if (outcome.renameTarget != "") { renameTarget = outcome.renameTarget; }
    if (outcome.leave) { running = false; }
  }

  let stopAcked = false;
  if (stopRequested) { stopAcked = stopDaemonAndWait(sess.client); }
  sess.client.detach();
  leaveScreen(mouse);
  rawDisable(STDIN);

  if (keepInBackground) {
    for (const n of backgroundKeptNotes(sess.port, sess.name)) { console.log(n); }
  }
  if (renameTarget != "") {
    for (const n of renameNotes(workspaceRoot, sess.name, renameTarget, null)) { console.log(n); }
  }
  if (stopRequested) {
    if (stopAcked) {
      console.log("joule: the background session has stopped.");
    } else {
      console.log("joule: asked the background session to stop - it may be finishing an in-flight turn; check with joule --stop if it lingers.");
    }
  }
  if (sess.state.stopReason != "") {
    console.log("joule: the daemon stopped (" + sess.state.stopReason + ")");
  }
}

function sendApprovalDecision(client: DaemonClient, log: ApprovalLog, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval, index: int): void {
  let callId = pending.callId;
  let decision = answerApprovalLocal(log, sb, input, rk, pending, index);
  client.publish(encodeApprovalReply({ v: PROTOCOL_VERSION, seq: 0, type: APPROVAL_REPLY, callId: callId, decision: decision }));
}
