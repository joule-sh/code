import { DIM, wrap } from "./style.ts";
import { visualWidth, padTo, repeatChar } from "./text.ts";
import { buildWelcomeBox, terminalWidth } from "./welcome.ts";
import { MODE_SAFE_AUTO, MODE_PLAN } from "../approval/gate.ts";

export { visualWidth, buildWelcomeBox, terminalWidth };

function modeDisplay(mode: string): string {
  if (mode == MODE_SAFE_AUTO) { return mode + " (commands run unattended)"; }
  if (mode == MODE_PLAN) { return mode + " (read-only, propose then approve)"; }
  return mode;
}

export function borderLine(left: string, right: string, width: int): string {
  return left + repeatChar("─", width - 2) + right;
}

export function contentLine(text: string, width: int): string {
  return "│" + padTo(text, width - 2) + "│";
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
  texts.push("mode: " + modeDisplay(info.mode));
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
