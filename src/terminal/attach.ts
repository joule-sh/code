import { isatty, rawEnable, rawDisable, readKeyTimeout, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, HIDE_CURSOR, SHOW_CURSOR, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF, KEY_TIMEOUT, KEY_ARROW_UP, KEY_ARROW_DOWN } from "../vendor/tty/tty.ts";
import { PROTOCOL_VERSION, INPUT, CANCEL, APPROVAL_REPLY, SESSION_HELLO, APPROVAL_REQUEST, TURN_START, frameType, encodeInput, encodeCancel, encodeApprovalReply, decodeSessionHello, decodeApprovalRequest, decodeTurnStart } from "../protocol/frames.ts";
import { InputLine, InputHistory, PendingApproval, approvalOptionForChar, APPROVAL_OPTION_DENY, APPROVAL_OPTION_COUNT } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { TurnStatusTracker, appendFrame, drawScreen } from "./screen.ts";
import { ApprovalLog, repaintApprovalOptionsLocal, answerApprovalLocal, reportIfResolvedElsewhereLocal } from "./attach_approval.ts";
import { stylePrompt, styleBanner } from "./style.ts";
import { DaemonClient } from "../daemon/attach_client.ts";
import { readDaemonInfo, portFromWorkspace, daemonSpawnArgs, daemonLogPath } from "../daemon/lifecycle.ts";

const DEFAULT_MODE: string = "auto-edit";

const STDIN: int = 0;
const POLL_MS: int = 100;
const CONNECT_WAIT_TICKS: int = 20;
const SPAWN_WAIT_TICKS: int = 80;
const DEFAULT_PORT_BASE: int = 8300;
const DEFAULT_PORT_SPREAD: int = 400;

function tmpDir(): string {
  return process.env("TMPDIR") ?? "/tmp";
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

export function runAttach(argv: string[]): void {
  if (!isatty(STDIN)) {
    console.log("joule attach needs a real terminal");
    process.exit(1);
    return;
  }

  let workspaceRoot = process.cwd();
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

  let approvalLog = new ApprovalLog(DEFAULT_MODE);

  process.stdout().write(ENTER_ALT_SCREEN + HIDE_CURSOR + ENABLE_MOUSE_REPORTING);
  rawEnable(STDIN);

  sb.append(styleBanner("joule attach - connected to a daemon at " + workspaceRoot));
  sb.append("\n" + styleBanner("type a request, /help for commands, ctrl-d to detach"));
  drawScreen(sb, input, approvalLog.mode, rk);

  let currentTurnId = "";
  let running = true;
  while (running) {
    let k = readKeyTimeout(STDIN, POLL_MS);

    if (k.kind == KEY_TIMEOUT) {
      let frames = client.pollInbound();
      for (const f of frames) {
        let t = frameType(f);
        if (t == SESSION_HELLO) {
          let hello = decodeSessionHello(f);
          if (hello != null) { approvalLog.mode = hello.mode; }
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
        appendFrame(sb, rk, f);
      }
      let diags = client.drainDiagnostics();
      for (const d of diags) {
        appendFrame(sb, rk, d);
      }
      if (frames.length > 0 || diags.length > 0) {
        drawScreen(sb, input, approvalLog.mode, rk);
      }
      reportIfResolvedElsewhereLocal(approvalLog, sb, input, rk, pendingApproval);
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

    if (line.trim() == "/help") {
      sb.append("\ntype a request, /help, /exit; approvals, mode display and streaming work here, /model /mode /share /tasks /memory /login /update are not available in attach mode yet");
      drawScreen(sb, input, approvalLog.mode, rk);
      continue;
    }

    if (line.trim() == "/exit") { running = false; continue; }

    history.record(line);
    sb.append("\n" + stylePrompt("> ") + line);
    drawScreen(sb, input, approvalLog.mode, rk);
    client.publish(encodeInput({ v: PROTOCOL_VERSION, seq: 0, type: INPUT, text: line }));
  }

  client.detach();
  process.stdout().write(DISABLE_MOUSE_REPORTING + SHOW_CURSOR + EXIT_ALT_SCREEN);
  rawDisable(STDIN);
}

function sendApprovalDecision(client: DaemonClient, log: ApprovalLog, sb: Scrollback, input: InputLine, rk: TurnStatusTracker, pending: PendingApproval, index: int): void {
  let callId = pending.callId;
  let decision = answerApprovalLocal(log, sb, input, rk, pending, index);
  client.publish(encodeApprovalReply({ v: PROTOCOL_VERSION, seq: 0, type: APPROVAL_REPLY, callId: callId, decision: decision }));
}
