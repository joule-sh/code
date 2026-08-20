import { isatty, rawEnable, rawDisable, readKey, readByteTimeout, cols, rows, cursorTo, CLEAR_LINE, ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, HIDE_CURSOR, SHOW_CURSOR, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF } from "../vendor/tty/tty.ts";
import { loadConfig } from "../providers/config.ts";
import { allToolSchemas } from "../tools/schemas.ts";
import { ToolsRegistry } from "../tools/registry.ts";
import { Gate, MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_FULL_AUTO, REPLY_ALLOW, REPLY_DENY, REPLY_ALWAYS } from "../approval/gate.ts";
import { Session } from "../session/session.ts";
import { Message, Provider, ToolRegistry, ApprovalGate } from "../session/types.ts";
import { CancelWatch, TurnTracker, LiveProvider } from "../providers/live.ts";
import { frameType, decodeTurnStart, TURN_START } from "../protocol/frames.ts";
import { renderFrame } from "./renderer.ts";
import { parseCommand, helpText, CMD_HELP, CMD_MODEL, CMD_MODE, CMD_SHARE, CMD_CLEAR, CMD_EXIT, CMD_UNKNOWN, CMD_NONE } from "./commands.ts";
import { Scrollback, InputLine, PendingApproval, clip } from "./input_state.ts";
import { styleFrame, stylePrompt, styleBanner } from "./style.ts";

const STDIN: int = 0;
const KEY_Y: int = 121;
const KEY_N: int = 110;
const KEY_A: int = 97;
const KEY_CTRL_C_BYTE: int = 3;

class GateBox {
  slot: Gate[];
  constructor() {
    this.slot = [];
  }
  set(g: Gate): void {
    this.slot = [g];
  }
}

function drawScreen(sb: Scrollback, input: InputLine): void {
  let c = cols(STDIN);
  let r = rows(STDIN);
  if (c <= 0) { c = 80; }
  if (r <= 1) { r = 24; }

  let visible = r - 1;
  let tail = sb.tail(visible);
  let blanks = visible - tail.length;
  if (blanks < 0) { blanks = 0; }

  let row = 1;
  while (row <= blanks) {
    console.log(cursorTo(row, 1) + CLEAR_LINE);
    row = row + 1;
  }
  let i = 0;
  while (i < tail.length) {
    console.log(cursorTo(row, 1) + CLEAR_LINE + clip(tail[i], c));
    row = row + 1;
    i = i + 1;
  }
  console.log(cursorTo(r, 1) + CLEAR_LINE + stylePrompt("> ") + input.buf);
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

  let tracker = new TurnTracker();
  let watch = new CancelWatch();
  let live = new LiveProvider(cfg, allToolSchemas(), watch, STDIN, tracker);
  let provider: Provider = { ask: (h: Message[], d: (text: string) => void) => live.ask(h, d) };

  let pendingApproval = new PendingApproval();
  let gateBox = new GateBox();

  let onApprovalRequest = (callId: string, tool: string, summary: string) => {
    pendingApproval.set(callId);
    sb.append("\n  ? " + summary + " (y/n/a)");
    drawScreen(sb, input);
  };

  let onApprovalPoll = () => {
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
  let approval: ApprovalGate = { check: (callId: string, tool: string, summary: string) => gate.check(callId, tool, summary) };

  let session = new Session(workspaceRoot, "agent", provider, tools, approval);
  live.setSession(session);

  session.subscribe((frameJson: string) => {
    if (frameType(frameJson) == TURN_START) {
      let f = decodeTurnStart(frameJson);
      if (f != null) {
        tracker.setCurrent(f.turnId);
      }
    }
    sb.append(styleFrame(frameType(frameJson), renderFrame(frameJson)));
    drawScreen(sb, input);
  });

  console.log(ENTER_ALT_SCREEN);
  console.log(HIDE_CURSOR);
  rawEnable(STDIN);

  sb.append(styleBanner("joule - type a request, /help for commands, ctrl-d to quit"));
  drawScreen(sb, input);

  let running = true;
  while (running) {
    let k = readKey(STDIN);

    if (k.kind == KEY_CTRL_D || k.kind == KEY_EOF) {
      running = false;
      continue;
    }

    if (k.kind == KEY_CTRL_C) {
      if (input.buf != "") {
        input.clear();
        drawScreen(sb, input);
      } else {
        running = false;
      }
      continue;
    }

    if (k.kind == KEY_BACKSPACE) {
      input.backspace();
      drawScreen(sb, input);
      continue;
    }

    if (k.kind == KEY_CHAR) {
      input.push(k.char);
      drawScreen(sb, input);
      continue;
    }

    if (k.kind != KEY_ENTER) {
      continue;
    }

    let line = input.takeAndClear();
    drawScreen(sb, input);

    if (line.trim() == "") {
      continue;
    }

    let cmd = parseCommand(line);

    if (cmd.kind == CMD_NONE) {
      sb.append("\n" + stylePrompt("> ") + line);
      drawScreen(sb, input);
      session.submit(line);
      drawScreen(sb, input);
      continue;
    }

    if (cmd.kind == CMD_HELP) {
      sb.append("\n" + helpText());
      drawScreen(sb, input);
      continue;
    }

    if (cmd.kind == CMD_MODEL) {
      if (cmd.arg == "") {
        sb.append("\nmodel: " + live.cfg.model);
      } else {
        live.cfg = { baseUrl: live.cfg.baseUrl, model: cmd.arg, apiKey: live.cfg.apiKey };
        sb.append("\nmodel set to " + cmd.arg);
      }
      drawScreen(sb, input);
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
      drawScreen(sb, input);
      continue;
    }

    if (cmd.kind == CMD_SHARE) {
      sb.append("\npairing is not available yet - the relay ships in a later ticket");
      drawScreen(sb, input);
      continue;
    }

    if (cmd.kind == CMD_CLEAR) {
      sb.clear();
      drawScreen(sb, input);
      continue;
    }

    if (cmd.kind == CMD_EXIT) {
      running = false;
      continue;
    }

    sb.append("\nunknown command: /" + cmd.arg);
    drawScreen(sb, input);
  }

  console.log(SHOW_CURSOR);
  console.log(EXIT_ALT_SCREEN);
  rawDisable(STDIN);
}
