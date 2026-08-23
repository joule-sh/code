import { isatty, rawEnable, rawDisable, readKeyTimeout, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, HIDE_CURSOR, SHOW_CURSOR, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF, KEY_TIMEOUT, KEY_ARROW_UP, KEY_ARROW_DOWN } from "../vendor/tty/tty.ts";
import { PROTOCOL_VERSION, INPUT, CANCEL, APPROVAL_REPLY, SESSION_HELLO, APPROVAL_REQUEST, TURN_START, MODE_SET, MODE_CHANGED, MODEL_SET, MODEL_CHANGED, TASKS_REQUEST, DAEMON_STOP, DAEMON_STOPPING, frameType, encodeInput, encodeCancel, encodeApprovalReply, decodeSessionHello, decodeApprovalRequest, decodeTurnStart, decodeModeChanged, decodeModelChanged, decodeDaemonStopping, encodeModeSet, encodeModelSet, encodeTasksRequest, encodeDaemonStop } from "../protocol/frames.ts";
import { InputLine, InputHistory, PendingApproval, approvalOptionForChar, APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { TurnStatusTracker, appendFrame, drawScreen } from "./screen.ts";
import { ApprovalLog, repaintApprovalOptionsLocal, answerApprovalLocal, reportIfResolvedElsewhereLocal } from "./attach_approval.ts";
import { stylePrompt, styleBanner } from "./style.ts";
import { DaemonClient } from "../daemon/attach_client.ts";
import { readDaemonInfo, portFromWorkspace, daemonSpawnArgs, daemonLogPath } from "../daemon/lifecycle.ts";
import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SHARE, CMD_LOGIN, CMD_LOGOUT, CMD_CAT, CMD_TASKS, CMD_MEMORY, CMD_UPDATE, CMD_CLEAR, CMD_EXIT, CMD_NONE } from "./commands.ts";
import { catText } from "./cat.ts";
import { runLogin, logoutText } from "./login_ui.ts";
import { memoryCommandText } from "./memory_ui.ts";
import { loadConfig, loadServerBase } from "../providers/config.ts";
import { PendingUpdateInstall, beginUpdateInstall } from "./update_offer.ts";
import { pollUpdateInstall } from "./update_install_poll.ts";
import { VERSION } from "../version.ts";

const DEFAULT_MODE: string = "auto-edit";

const STDIN: int = 0;
const POLL_MS: int = 100;
const CONNECT_WAIT_TICKS: int = 20;
const SPAWN_WAIT_TICKS: int = 80;
const DEFAULT_PORT_BASE: int = 8300;
const DEFAULT_PORT_SPREAD: int = 400;
const STOP_ACK_TICKS: int = 50;
const STOP_FLAG: string = "--stop";

function tmpDir(): string {
  return process.env("TMPDIR") ?? "/tmp";
}

function hasStopFlag(argv: string[]): bool {
  for (const a of argv) {
    if (a == STOP_FLAG) { return true; }
  }
  return false;
}

function waitForReady(client: DaemonClient, ticks: int): bool {
  let i = 0;
  while (i < ticks) {
    client.pollInbound();
    if (client.socketReady) { return true; }
    process.sleep(POLL_MS);
    i = i + 1;
  }
  return client.socketReady;
}

function ensureAttached(workspaceRoot: string): DaemonClient {
  let info = readDaemonInfo(workspaceRoot);
  let port = DEFAULT_PORT_BASE;
  if (info != null) {
    port = info.port;
  } else {
    port = portFromWorkspace(workspaceRoot, DEFAULT_PORT_BASE, DEFAULT_PORT_SPREAD);
  }

  let client = new DaemonClient("127.0.0.1", port, tmpDir());
  client.connect();
  if (waitForReady(client, CONNECT_WAIT_TICKS)) { return client; }

  console.log("joule attach: no daemon answering on 127.0.0.1:" + `${port}` + ", starting one");
  let args = daemonSpawnArgs(workspaceRoot, port, daemonLogPath(workspaceRoot));
  child_process.spawnSync("/bin/sh", args);
  waitForReady(client, SPAWN_WAIT_TICKS);
  return client;
}

function runAttachStop(workspaceRoot: string): void {
  let info = readDaemonInfo(workspaceRoot);
  if (info == null) {
    console.log("joule attach --stop: no daemon is running for " + workspaceRoot);
    return;
  }

  let client = new DaemonClient("127.0.0.1", info.port, tmpDir());
  client.connect();
  if (!waitForReady(client, CONNECT_WAIT_TICKS)) {
    console.log("joule attach --stop: could not reach the daemon at 127.0.0.1:" + `${info.port}` + " for " + workspaceRoot + " - it may have already crashed or stopped");
    return;
  }

  client.publish(encodeDaemonStop({ v: PROTOCOL_VERSION, seq: 0, type: DAEMON_STOP }));

  let acked = false;
  let i = 0;
  while (i < STOP_ACK_TICKS && !acked) {
    let frames = client.pollInbound();
    for (const f of frames) {
      if (frameType(f) == DAEMON_STOPPING) { acked = true; }
    }
    if (!acked) { process.sleep(POLL_MS); }
    i = i + 1;
  }
  client.detach();

  if (acked) {
    console.log("joule attach --stop: the daemon for " + workspaceRoot + " acknowledged the request and is shutting down");
    console.log("joule attach --stop: note - any already-running background task or subagent it started keeps running as its own detached process; stopping the daemon does not stop those (see docs/03-daemon.md)");
  } else {
    console.log("joule attach --stop: sent the stop request but saw no acknowledgement within " + `${STOP_ACK_TICKS * POLL_MS}` + "ms - it may still be finishing an in-flight turn before it stops");
  }
}

function attachHelpText(): string {
  return helpText()
    + "\n/stop-daemon    ask this workspace's daemon to stop (any attached client may; it takes effect once any in-flight turn finishes, see docs/03-daemon.md)"
    + "\nnote: /share is not available in attach mode yet - the relay does not support multiple daemon clients pairing through it in this pass";
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

  let serverBase = loadServerBase(argv);
  let client = ensureAttached(workspaceRoot);
  if (!client.socketReady) {
    console.log("joule attach: could not reach a daemon for " + workspaceRoot);
    process.exit(1);
    return;
  }

  let sb = new Scrollback();
  let input = new InputLine();
  let history = new InputHistory();
  let rk = new TurnStatusTracker();
  let pendingApproval = new PendingApproval();
  let updateInstall = new PendingUpdateInstall();

  let approvalLog = new ApprovalLog(DEFAULT_MODE);
  let currentModel = loadConfig(argv).model;

  process.stdout().write(ENTER_ALT_SCREEN + HIDE_CURSOR + ENABLE_MOUSE_REPORTING);
  rawEnable(STDIN);

  sb.append(styleBanner("joule attach - connected to a daemon at " + workspaceRoot));
  sb.append("\n" + styleBanner("type a request, /help for commands, ctrl-d to detach"));
  drawScreen(sb, input, approvalLog.mode, rk);

  let currentTurnId = "";
  let running = true;
  let stopReason = "";
  while (running) {
    let k = readKeyTimeout(STDIN, POLL_MS);

    if (k.kind == KEY_TIMEOUT) {
      let frames = client.pollInbound();
      let daemonStopped = false;
      for (const f of frames) {
        let t = frameType(f);
        if (t == SESSION_HELLO) {
          let hello = decodeSessionHello(f);
          if (hello != null) { approvalLog.mode = hello.mode; currentModel = hello.model; }
        }
        if (t == TURN_START) {
          let start = decodeTurnStart(f);
          if (start != null) { currentTurnId = start.turnId; }
        }
        if (t == APPROVAL_REQUEST) {
          let req = decodeApprovalRequest(f);
          if (req != null) {
            pendingApproval.set(req.callId);
            pendingApproval.setTool(req.tool);
            pendingApproval.setOptionRows(sb.lineCount());
          }
        }
        if (t == MODE_CHANGED) {
          let modeChanged = decodeModeChanged(f);
          if (modeChanged != null) { approvalLog.mode = modeChanged.mode; }
        }
        if (t == MODEL_CHANGED) {
          let modelChanged = decodeModelChanged(f);
          if (modelChanged != null) { currentModel = modelChanged.model; }
        }
        if (t == DAEMON_STOPPING) {
          let stopping = decodeDaemonStopping(f);
          stopReason = "an attached client asked it to stop";
          if (stopping != null) { stopReason = stopping.reason; }
          daemonStopped = true;
        }
        appendFrame(sb, rk, f);
      }
      let diags = client.drainDiagnostics();
      for (const d of diags) {
        appendFrame(sb, rk, d);
      }
      if (frames.length > 0 || diags.length > 0) {
        drawScreen(sb, input, approvalLog.mode, rk);
      }
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
      if (input.buf != "") {
        input.clear();
        drawScreen(sb, input, approvalLog.mode, rk);
      } else if (pendingApproval.callId != "") {
        sendApprovalDecision(client, approvalLog, sb, input, rk, pendingApproval, APPROVAL_OPTION_DENY);
      } else {
        client.publish(encodeCancel({ v: PROTOCOL_VERSION, seq: 0, type: CANCEL, turnId: currentTurnId }));
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
      let optionIndex = approvalOptionForChar(k.char);
      if (optionIndex >= 0 && pendingApproval.callId != "") {
        sendApprovalDecision(client, approvalLog, sb, input, rk, pendingApproval, optionIndex);
        continue;
      }
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

    if (k.kind != KEY_ENTER) { continue; }

    if (pendingApproval.callId != "") {
      sendApprovalDecision(client, approvalLog, sb, input, rk, pendingApproval, pendingApproval.selected);
      continue;
    }

    let line = input.takeAndClear();
    drawScreen(sb, input, approvalLog.mode, rk);
    if (line.trim() == "") { continue; }

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
      client.publish(encodeInput({ v: PROTOCOL_VERSION, seq: 0, type: INPUT, text: line }));
      continue;
    }

    if (cmd.kind == CMD_HELP) { sb.append("\n" + attachHelpText()); drawScreen(sb, input, approvalLog.mode, rk); continue; }

    if (cmd.kind == CMD_MODEL) {
      if (cmd.arg == "") {
        sb.append("\nmodel: " + currentModel);
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
        client.publish(encodeModeSet({ v: PROTOCOL_VERSION, seq: 0, type: MODE_SET, mode: cmd.arg }));
      }
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_SHARE) {
      sb.append("\n/share is not available in attach mode yet - run the default joule if you need to share this conversation over the relay (see docs/03-daemon.md)");
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_LOGIN) {
      runLogin(sb, input, approvalLog.mode, rk, serverBase);
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (cmd.kind == CMD_LOGOUT) { sb.append(logoutText(serverBase)); drawScreen(sb, input, approvalLog.mode, rk); continue; }

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

  if (stopReason != "") {
    console.log("joule attach: the daemon stopped (" + stopReason + ")");
  }
}

function sendApprovalDecision(client: DaemonClient, log: ApprovalLog, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval, index: int): void {
  let callId = pending.callId;
  let decision = answerApprovalLocal(log, sb, input, rk, pending, index);
  client.publish(encodeApprovalReply({ v: PROTOCOL_VERSION, seq: 0, type: APPROVAL_REPLY, callId: callId, decision: decision }));
}
