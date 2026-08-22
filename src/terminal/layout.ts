import { VIOLET, DIM, wrap } from "./style.ts";
import { isDefaultServer } from "../auth/server.ts";
import { VERSION } from "../version.ts";

const BOX_WIDTH: int = 54;
const CONTENT_WIDTH: int = BOX_WIDTH - 2;
const LABEL_WIDTH: int = 10;

function repeatChar(ch: string, n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    out = out + ch;
    i = i + 1;
  }
  return out;
}

function utf8ByteCount(first: int): int {
  if (first >= 240) { return 4; }
  if (first >= 224) { return 3; }
  if (first >= 192) { return 2; }
  return 1;
}

export function visualWidth(plain: string): int {
  let count = 0;
  let i = 0;
  while (i < plain.length) {
    i = i + utf8ByteCount(plain.charCodeAt(i));
    count = count + 1;
  }
  return count;
}

function truncateToWidth(text: string, width: int): string {
  if (width <= 0) { return ""; }
  let count = 0;
  let i = 0;
  while (i < text.length && count < width) {
    i = i + utf8ByteCount(text.charCodeAt(i));
    count = count + 1;
  }
  return text.slice(0, i);
}

function padTo(text: string, width: int): string {
  let vw = visualWidth(text);
  let t = text;
  if (vw > width) {
    if (width > 3) {
      t = truncateToWidth(text, width - 3) + "...";
    } else {
      t = truncateToWidth(text, width);
    }
  }
  let pad = width - visualWidth(t);
  if (pad < 0) { pad = 0; }
  return t + repeatChar(" ", pad);
}

function field(label: string, value: string): string {
  return " " + padTo(label, LABEL_WIDTH) + padTo(value, CONTENT_WIDTH - LABEL_WIDTH - 1);
}

export function borderLine(left: string, right: string, width: int): string {
  return left + repeatChar("─", width - 2) + right;
}

export function contentLine(text: string, width: int): string {
  return "│" + padTo(text, width - 2) + "│";
}

export function buildWelcomeBox(model: string, workspace: string, mode: string, server: string): string {
  let out = wrap(VIOLET, borderLine("┌", "┐", BOX_WIDTH));
  out = out + "\n" + wrap(VIOLET, contentLine(" joule " + VERSION, BOX_WIDTH));
  out = out + "\n" + wrap(VIOLET, contentLine("", BOX_WIDTH));
  out = out + "\n" + wrap(VIOLET, contentLine(field("model", model), BOX_WIDTH));
  out = out + "\n" + wrap(VIOLET, contentLine(field("workspace", workspace), BOX_WIDTH));
  out = out + "\n" + wrap(VIOLET, contentLine(field("mode", mode), BOX_WIDTH));
  if (server != "" && !isDefaultServer(server)) {
    out = out + "\n" + wrap(VIOLET, contentLine(field("server", server), BOX_WIDTH));
  }
  out = out + "\n" + wrap(VIOLET, contentLine("", BOX_WIDTH));
  out = out + "\n" + wrap(VIOLET, contentLine(" agentic coding, on your machine", BOX_WIDTH));
  out = out + "\n" + wrap(VIOLET, borderLine("└", "┘", BOX_WIDTH));
  return out;
}

export type StatusInfo = { mode: string, elapsedMs: i64, tokens: int, runningTasks: int, turnLive: bool };

export const NO_TURN: i64 = -1;

const SEPARATOR: string = " · ";
const HELP_HINT: string = "/help for commands";
const SCROLL_HINT: string = "PageUp/PageDown to scroll";

const PRIO_SCROLL_HINT: int = 0;
const PRIO_HELP_HINT: int = 1;
const PRIO_TOKENS: int = 2;
const PRIO_TASKS: int = 3;
const PRIO_ELAPSED: int = 4;
const PRIO_MODE: int = 5;

export function idleStatus(mode: string): StatusInfo {
  return { mode: mode, elapsedMs: NO_TURN, tokens: 0, runningTasks: 0, turnLive: false };
}

function pad2(n: i64): string {
  if (n < 10) { return "0" + `${n}`; }
  return `${n}`;
}

export function formatElapsed(ms: i64): string {
  let total: i64 = ms / 1000;
  if (total < 0) { total = 0; }
  let seconds: i64 = total % 60;
  let minutes: i64 = (total / 60) % 60;
  let hours: i64 = total / 3600;
  if (hours > 0) { return `${hours}` + "h " + pad2(minutes) + "m"; }
  if (minutes > 0) { return `${minutes}` + "m " + pad2(seconds) + "s"; }
  return `${seconds}` + "s";
}

export function formatTokens(n: int): string {
  if (n == 1) { return "1 token"; }
  if (n < 1000) { return `${n}` + " tokens"; }
  let thousands = (n + 500) / 1000;
  return `${thousands}` + "k tokens";
}

export function formatRunningTasks(n: int): string {
  if (n == 1) { return "1 running task"; }
  return `${n}` + " running tasks";
}

function joinFields(parts: string[]): string {
  let out = "";
  let i = 0;
  while (i < parts.length) {
    if (i > 0) { out = out + SEPARATOR; }
    out = out + parts[i];
    i = i + 1;
  }
  return out;
}

type StatusFields = { texts: string[], priorities: int[] };

function collectFields(info: StatusInfo): StatusFields {
  let texts: string[] = [];
  let priorities: int[] = [];
  texts.push("mode: " + info.mode);
  priorities.push(PRIO_MODE);
  if (info.elapsedMs >= 0) {
    texts.push(formatElapsed(info.elapsedMs));
    priorities.push(PRIO_ELAPSED);
  }
  if (info.tokens > 0) {
    texts.push(formatTokens(info.tokens));
    priorities.push(PRIO_TOKENS);
  }
  if (info.runningTasks > 0) {
    texts.push(formatRunningTasks(info.runningTasks));
    priorities.push(PRIO_TASKS);
  }
  texts.push(HELP_HINT);
  priorities.push(PRIO_HELP_HINT);
  texts.push(SCROLL_HINT);
  priorities.push(PRIO_SCROLL_HINT);
  return { texts: texts, priorities: priorities };
}

function keepAbove(fields: StatusFields, floor: int): StatusFields {
  let texts: string[] = [];
  let priorities: int[] = [];
  let i = 0;
  while (i < fields.texts.length) {
    if (fields.priorities[i] >= floor) {
      texts.push(fields.texts[i]);
      priorities.push(fields.priorities[i]);
    }
    i = i + 1;
  }
  return { texts: texts, priorities: priorities };
}

function narrowToWidth(info: StatusInfo, width: int): StatusFields {
  let fields = collectFields(info);
  let floor = PRIO_SCROLL_HINT;
  let kept = keepAbove(fields, floor);
  while (width > 0 && floor < PRIO_MODE && visualWidth(joinFields(kept.texts)) > width) {
    floor = floor + 1;
    kept = keepAbove(fields, floor);
  }
  return kept;
}

export function statusText(info: StatusInfo, width: int): string {
  return joinFields(narrowToWidth(info, width).texts);
}

function styledField(text: string, priority: int, turnLive: bool): string {
  if ((priority == PRIO_ELAPSED || priority == PRIO_TOKENS) && turnLive) {
    return text;
  }
  return wrap(DIM, text);
}

export function buildStatusLine(info: StatusInfo, width: int): string {
  let kept = narrowToWidth(info, width);
  let out = "";
  let i = 0;
  while (i < kept.texts.length) {
    if (i > 0) { out = out + wrap(DIM, SEPARATOR); }
    out = out + styledField(kept.texts[i], kept.priorities[i], info.turnLive);
    i = i + 1;
  }
  return out;
}
