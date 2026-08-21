import { isatty, rawEnable, rawDisable, readKey, readKeyTimeout, readByteTimeout, rows, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, HIDE_CURSOR, SHOW_CURSOR, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF, KEY_TIMEOUT, KEY_PAGE_UP, KEY_PAGE_DOWN, KEY_ARROW_UP, KEY_ARROW_DOWN } from "../vendor/tty/tty.ts";
import { loadConfig } from "../providers/config.ts";
import { allToolSchemas } from "../tools/schemas.ts";
import { ToolsRegistry } from "../tools/registry.ts";
import { readFile } from "../tools/files.ts";
import { Gate, MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_FULL_AUTO, REPLY_ALLOW, REPLY_DENY, REPLY_ALWAYS } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { Message, Provider, ToolRegistry, ApprovalGate } from "../session/types.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { PROTOCOL_VERSION, SESSION_HELLO, SessionHelloFrame, encodeSessionHello, frameType, decodeTurnStart, TURN_START, APPROVAL_REQUEST, ApprovalRequestFrame, encodeApprovalRequest } from "../protocol/frames.ts";
import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SHARE, CMD_CAT, CMD_CLEAR, CMD_EXIT, CMD_UNKNOWN, CMD_NONE } from "./commands.ts";
import { Scrollback, InputLine, InputHistory, PendingApproval } from "./input_state.ts";
import { stylePrompt, styleBanner } from "./style.ts";
import { buildWelcomeBox } from "./layout.ts";
import { RelayClient } from "../relay/client.ts";
import { loadRelayConfig } from "../relay/client_logic.ts";
import { RelayInputBridge } from "./relay_bridge.ts";
import { TurnStatusTracker, appendFrame, drawScreen, runRelayTick } from "./screen.ts";

const STDIN: int = 0;
const KEY_Y: int = 121;
const KEY_N: int = 110;
const KEY_A: int = 97;
const KEY_CTRL_C_BYTE: int = 3;
const RELAY_POLL_MS: int = 100;

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
  let workspaceRoot = process.cwd();

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

  let onApprovalRequest = (callId: string, tool: string, summary: string, args: string) => {
    pendingApproval.set(callId);
    if (live.sessionSlot.length > 0) {
      let s = live.sessionSlot[0];
      let frame: ApprovalRequestFrame = {
        v: PROTOCOL_VERSION, seq: s.takeSeq(), type: APPROVAL_REQUEST,
        turnId: tracker.current, callId: callId, tool: tool, summary: summary, detail: summary, args: args,
      };
      s.emit(encodeApprovalRequest(frame));
    }
  };

  let onApprovalPoll = () => {
    if (relayBox.relaySlot.length > 0 && gateBox.slot.length > 0) {
      runRelayTick(relayBox.relaySlot[0], relayBox.sessionSlot[0], gateBox.slot[0], relayBox.bridgeSlot[0], sb, input, rk);
    }
    let b = readByteTimeout(STDIN, 0);
    if (b == KEY_Y && gateBox.slot.length > 0) {
      gateBox.slot[0].reply(pendingApproval.callId, REPLY_ALLOW);
      pendingApproval.clearIfMatches(pendingApproval.callId);
    } else if (b == KEY_N && gateBox.slot.length > 0) {
      gateBox.slot[0].reply(pendingApproval.callId, REPLY_DENY);
      pendingApproval.clearIfMatches(pendingApproval.callId);
    } else if (b == KEY_A && gateBox.slot.length > 0) {
      gateBox.slot[0].reply(pendingApproval.callId, REPLY_ALWAYS);
      pendingApproval.clearIfMatches(pendingApproval.callId);
    } else if (b == KEY_CTRL_C_BYTE) {
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
  live.setSession(session);

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
    appendFrame(sb, rk, frameJson);
    drawScreen(sb, input, gate.mode, rk.quantaText());
    runRelayTick(relay, session, gate, bridge, sb, input, rk);
  });

  process.stdout().write(ENTER_ALT_SCREEN + HIDE_CURSOR);
  rawEnable(STDIN);

  sb.append(buildWelcomeBox(cfg.model, workspaceRoot, gate.mode));
  sb.append("\n\n" + styleBanner("joule - type a request, /help for commands, ctrl-d to quit"));
  drawScreen(sb, input, gate.mode, rk.quantaText());

  if (hasFlag(argv, "--share")) {
    attachToRelay();
  }

  let running = true;
  while (running) {
    let k = readKeyTimeout(STDIN, RELAY_POLL_MS);

    if (k.kind == KEY_TIMEOUT) {
      runRelayTick(relay, session, gate, bridge, sb, input, rk);
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
      input.push(k.char);
      history.cancelNavigation();
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_ARROW_UP) {
      input.setBuf(history.back(input.buf));
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_ARROW_DOWN) {
      input.setBuf(history.forward());
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_PAGE_UP) {
      let r = rows(STDIN);
      if (r <= 1) { r = 24; }
      sb.scrollUp(r - 1, r - 1);
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind == KEY_PAGE_DOWN) {
      let r = rows(STDIN);
      if (r <= 1) { r = 24; }
      sb.scrollDown(r - 1, r - 1);
      drawScreen(sb, input, gate.mode, rk.quantaText());
      continue;
    }

    if (k.kind != KEY_ENTER) {
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

  process.stdout().write(SHOW_CURSOR + EXIT_ALT_SCREEN);
  rawDisable(STDIN);
}
