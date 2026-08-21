import { cols, rows, cursorTo, CLEAR_LINE } from "../vendor/tty/tty.ts";
import { RelayClient } from "../relay/client.ts";
import { Session } from "../session/session.ts";
import { Gate } from "../approval/gate.ts";
import { TurnTracker } from "../providers/live.ts";
import { RelayInputBridge, pollRelay } from "./relay_bridge.ts";
import { frameType, decodeToolCall, TOOL_CALL, TOOL_RESULT, TEXT_DELTA, TURN_START, TURN_END } from "../protocol/frames.ts";
import { renderFrame } from "./renderer.ts";
import { styleFrame, stylePrompt, styleScrollIndicator } from "./style.ts";
import { StatusInfo, NO_TURN, buildStatusLine } from "./layout.ts";
import { buildQuantaIndicator } from "./quanta.ts";
import { InputLine, clip } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { planToolOutputCollapse } from "./collapse.ts";
import { completionRows, panelBudget } from "./completion.ts";
import { MarkdownState, appendMarkdownDelta, flushMarkdown } from "./markdown.ts";

const STDIN: int = 0;

export class TurnStatusTracker {
  prevKind: string;
  lastTool: string;
  md: MarkdownState;
  startedAt: i64;
  inTurn: bool;
  trackerSlot: TurnTracker[];
  runningTasksSlot: (() => int)[];

  constructor() {
    this.prevKind = "";
    this.lastTool = "";
    this.md = new MarkdownState();
    this.startedAt = 0;
    this.inTurn = false;
    this.trackerSlot = [];
    this.runningTasksSlot = [];
  }

  bind(tracker: TurnTracker, countRunning: () => int): void {
    this.trackerSlot = [tracker];
    this.runningTasksSlot = [countRunning];
  }

  recordFrame(frameJson: string): void {
    let kind = frameType(frameJson);
    if (kind == TURN_START) {
      this.startedAt = time.monotonic();
      this.inTurn = true;
    }
    if (kind == TURN_END) {
      this.inTurn = false;
    }
    if (kind == TOOL_CALL) {
      let f = decodeToolCall(frameJson);
      if (f != null) {
        this.lastTool = f.tool;
      }
    }
    this.prevKind = kind;
  }

  quantaText(): string {
    return buildQuantaIndicator(this.prevKind, this.lastTool);
  }

  elapsedMs(): i64 {
    if (!this.inTurn) { return NO_TURN; }
    return time.monotonic() - this.startedAt;
  }

  turnTokens(): int {
    if (!this.inTurn || this.trackerSlot.length == 0) { return 0; }
    return this.trackerSlot[0].tokens;
  }

  runningTasks(): int {
    if (this.runningTasksSlot.length == 0) { return 0; }
    return this.runningTasksSlot[0]();
  }

  statusInfo(mode: string): StatusInfo {
    return { mode: mode, elapsedMs: this.elapsedMs(), tokens: this.turnTokens(), runningTasks: this.runningTasks() };
  }
}

function appendStyled(sb: Scrollback, kind: string, styled: string): void {
  if (kind != TOOL_RESULT) {
    sb.append(styled);
    return;
  }
  let plan = planToolOutputCollapse(styled);
  if (plan.hidden <= 0) {
    sb.append(styled);
    return;
  }
  sb.appendCollapsible(plan.head, plan.body, plan.hidden);
}

export function appendFrame(sb: Scrollback, rk: TurnStatusTracker, frameJson: string): void {
  let kind = frameType(frameJson);
  let rendered = renderFrame(frameJson, rk.prevKind);
  if (kind == TEXT_DELTA) {
    sb.appendBlock(appendMarkdownDelta(rk.md, rendered));
  } else {
    let flushed = flushMarkdown(rk.md);
    if (flushed != "") {
      sb.appendBlock(flushed);
    }
    appendStyled(sb, kind, styleFrame(kind, rendered));
  }
  rk.recordFrame(frameJson);
}

export function drawScreen(sb: Scrollback, input: InputLine, mode: string, rk: TurnStatusTracker): void {
  let c = cols(STDIN);
  let r = rows(STDIN);
  if (c <= 0) { c = 80; }
  if (r <= 1) { r = 24; }

  let quantaText = rk.quantaText();
  let atBottom = sb.isAtBottom();
  let indicatorRows = 0;
  if (!atBottom) { indicatorRows = indicatorRows + 1; }
  if (quantaText != "") { indicatorRows = indicatorRows + 1; }

  let panel = completionRows(input.completion, c, panelBudget(r, indicatorRows));

  let visible = r - 2 - indicatorRows - panel.length;
  if (visible < 0) { visible = 0; }
  let tail = sb.tailFrom(visible, sb.offset);
  let blanks = visible - tail.length;
  if (blanks < 0) { blanks = 0; }

  let out = "";
  let row = 1;
  while (row <= blanks) {
    out = out + cursorTo(row, 1) + CLEAR_LINE;
    row = row + 1;
  }
  let i = 0;
  while (i < tail.length) {
    out = out + cursorTo(row, 1) + CLEAR_LINE + clip(tail[i], c);
    row = row + 1;
    i = i + 1;
  }
  if (!atBottom) {
    out = out + cursorTo(row, 1) + CLEAR_LINE + styleScrollIndicator(clip("-- scrolled up, PageDown to return to the live view --", c));
    row = row + 1;
  }
  if (quantaText != "") {
    out = out + cursorTo(row, 1) + CLEAR_LINE + clip(quantaText, c);
    row = row + 1;
  }
  let pr = 0;
  while (pr < panel.length) {
    out = out + cursorTo(row, 1) + CLEAR_LINE + clip(panel[pr], c);
    row = row + 1;
    pr = pr + 1;
  }
  out = out + cursorTo(r - 1, 1) + CLEAR_LINE + clip(buildStatusLine(rk.statusInfo(mode), c), c);
  out = out + cursorTo(r, 1) + CLEAR_LINE + stylePrompt("> ") + input.buf;
  process.stdout().write(out);
}

export function runRelayTick(relay: RelayClient, session: Session, gate: Gate, bridge: RelayInputBridge, sb: Scrollback, input: InputLine, rk: TurnStatusTracker): void {
  let diags = pollRelay(relay, session, gate, bridge);
  let i = 0;
  while (i < diags.length) {
    appendFrame(sb, rk, diags[i]);
    i = i + 1;
  }
  if (diags.length > 0) {
    drawScreen(sb, input, gate.mode, rk);
  }
}
