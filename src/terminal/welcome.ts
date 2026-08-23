import { VIOLET, DIM, wrap } from "./style.ts";
import { visualWidth, padTo, fitText, fitPath, repeatChar } from "./text.ts";
import { repoSummary } from "./repo.ts";
import { promptRowCount } from "./prompt_rows.ts";
import { VERSION } from "../version.ts";
import { isDefaultServer } from "../auth/server.ts";
import { MODE_READ_ONLY, MODE_AUTO_EDIT, MODE_SAFE_AUTO, MODE_FULL_AUTO, MODE_PLAN } from "../approval/gate.ts";
import { cols, rows } from "../vendor/tty/tty.ts";

const STDIN: int = 0;
const DEFAULT_WIDTH: int = 80;
const DEFAULT_ROWS: int = 24;
const MIN_WIDTH: int = 24;
const STATUS_ROWS: int = 1;
const ARRIVAL_ROWS: int = 2;

const WORDMARK: string = "joule";
const SUGGESTION: string = "describe a change, or paste an error";
const SEPARATOR: string = " · ";

const LABEL_WIDTH: int = 9;
const RULE_WIDTH: int = 2;
const PREFIX_WIDTH: int = 13;
const MIN_VALUE_WIDTH: int = 8;

const INDENT: string = "  ";
const INDENT_WIDTH: int = 2;
const COLUMN_GAP: int = 2;
const TWO_COLUMN_MIN: int = 76;

const RULE_TOP: string = "┌";
const RULE_MID: string = "│";
const RULE_END: string = "└";

export type WelcomeFacts = { model: string, workspace: string, repo: string, mode: string, server: string };

export type Hint = { name: string, description: string };

type WelcomeRow = { label: string, value: string, note: string, dim: bool };

type HintCell = { styled: string, width: int };

export function hints(): Hint[] {
  let out: Hint[] = [
    { name: "/model", description: "switch the model" },
    { name: "/login", description: "sign in to joule.sh" },
    { name: "/mode", description: "what runs without asking" },
    { name: "/share", description: "watch from a browser" },
    { name: "/tasks", description: "background work" },
    { name: "/memory", description: "what joule remembers" },
  ];
  return out;
}

export function permissionText(mode: string): string {
  if (mode == MODE_READ_ONLY) { return "reads, never writes or runs"; }
  if (mode == MODE_AUTO_EDIT) { return "reads and edits, asks to run"; }
  if (mode == MODE_SAFE_AUTO) { return "commands run unattended"; }
  if (mode == MODE_FULL_AUTO) { return "everything runs unattended"; }
  if (mode == MODE_PLAN) { return "read-only, proposes then asks"; }
  return "";
}

function welcomeRow(label: string, value: string, note: string, dim: bool): WelcomeRow {
  let r: WelcomeRow = { label: label, value: value, note: note, dim: dim };
  return r;
}

function valueWidth(width: int): int {
  let avail = width - PREFIX_WIDTH;
  if (avail < MIN_VALUE_WIDTH) { return MIN_VALUE_WIDTH; }
  return avail;
}

function factRows(f: WelcomeFacts, width: int): WelcomeRow[] {
  let avail = valueWidth(width);
  let out: WelcomeRow[] = [];
  out.push(welcomeRow("workspace", fitPath(f.workspace, avail), "", false));
  if (f.repo != "") { out.push(welcomeRow("repo", fitText(f.repo, avail), "", false)); }
  out.push(welcomeRow("agent", fitText(f.model, avail), "", false));
  let note = permissionText(f.mode);
  if (note != "" && visualWidth(f.mode + SEPARATOR + note) <= avail) {
    out.push(welcomeRow("may run", f.mode, SEPARATOR + note, false));
  } else {
    out.push(welcomeRow("may run", fitText(f.mode, avail), "", false));
    if (note != "") { out.push(welcomeRow("", fitText(note, avail), "", true)); }
  }
  if (f.server != "" && !isDefaultServer(f.server)) {
    out.push(welcomeRow("server", fitText(f.server, avail), "", false));
  }
  return out;
}

function ruleFor(index: int, total: int): string {
  if (total <= 1) { return RULE_MID; }
  if (index == 0) { return RULE_TOP; }
  if (index == total - 1) { return RULE_END; }
  return RULE_MID;
}

function factBody(r: WelcomeRow): string {
  let line = wrap(DIM, padTo(r.label, LABEL_WIDTH) + repeatChar(" ", COLUMN_GAP));
  if (r.dim) {
    line = line + wrap(DIM, r.value);
  } else {
    line = line + r.value;
  }
  if (r.note != "") { line = line + wrap(DIM, r.note); }
  return line;
}

function hintCell(h: Hint, cellWidth: int): HintCell {
  let descWidth = cellWidth - LABEL_WIDTH - COLUMN_GAP;
  if (descWidth < 0) { descWidth = 0; }
  let desc = fitText(h.description, descWidth);
  let styled = wrap(VIOLET, padTo(h.name, LABEL_WIDTH)) + repeatChar(" ", COLUMN_GAP) + wrap(DIM, desc);
  let c: HintCell = { styled: styled, width: LABEL_WIDTH + COLUMN_GAP + visualWidth(desc) };
  return c;
}

export function hintLines(width: int): string[] {
  let all = hints();
  let avail = width - RULE_WIDTH;
  let out: string[] = [];
  if (width >= TWO_COLUMN_MIN) {
    let cellWidth = (avail - COLUMN_GAP) / 2;
    let i = 0;
    while (i < all.length) {
      let left = hintCell(all[i], cellWidth);
      let line = left.styled;
      if (i + 1 < all.length) {
        let gap = cellWidth - left.width + COLUMN_GAP;
        if (gap < 1) { gap = 1; }
        line = line + repeatChar(" ", gap) + hintCell(all[i + 1], cellWidth).styled;
      }
      out.push(line);
      i = i + 2;
    }
    return out;
  }
  let j = 0;
  while (j < all.length) {
    out.push(hintCell(all[j], avail).styled);
    j = j + 1;
  }
  return out;
}

function joinLines(lines: string[]): string {
  let out = "";
  let i = 0;
  while (i < lines.length) {
    if (i > 0) { out = out + "\n"; }
    out = out + lines[i];
    i = i + 1;
  }
  return out;
}

function droppableIndex(list: WelcomeRow[]): int {
  let i = list.length - 1;
  while (i >= 0) {
    if (list[i].dim) { return i; }
    i = i - 1;
  }
  let j = 0;
  while (j < list.length) {
    if (list[j].label == "repo") { return j; }
    j = j + 1;
  }
  return -1;
}

function removeAt(list: WelcomeRow[], at: int): WelcomeRow[] {
  let out: WelcomeRow[] = [];
  let i = 0;
  while (i < list.length) {
    if (i != at) { out.push(list[i]); }
    i = i + 1;
  }
  return out;
}

export function welcomeRows(termRows: int): int {
  let visible = termRows - STATUS_ROWS - promptRowCount(termRows);
  let budget = visible - ARRIVAL_ROWS;
  if (budget < 1) { return 1; }
  return budget;
}

export function welcomeBlock(f: WelcomeFacts, width: int, budget: int): string {
  let w = width;
  if (w < MIN_WIDTH) { w = MIN_WIDTH; }
  let facts = factRows(f, w);
  let header = 2;
  while (facts.length > 1 && facts.length + header > budget) {
    let at = droppableIndex(facts);
    if (at < 0) {
      if (header > 1) {
        header = 1;
        continue;
      }
      at = facts.length - 1;
    }
    facts = removeAt(facts, at);
  }
  if (header > 1 && facts.length + header > budget) { header = 1; }

  let bodies: string[] = [];
  let i = 0;
  while (i < facts.length) {
    bodies.push(factBody(facts[i]));
    i = i + 1;
  }
  let hl = hintLines(w);
  if (header + facts.length + hl.length + 3 <= budget) {
    bodies.push("");
    let h = 0;
    while (h < hl.length) {
      bodies.push(hl[h]);
      h = h + 1;
    }
  }

  let lines: string[] = [];
  lines.push(wrap(VIOLET, WORDMARK) + " " + wrap(DIM, VERSION));
  if (header > 1) { lines.push(""); }
  let j = 0;
  while (j < bodies.length) {
    lines.push(wrap(DIM, ruleFor(j, bodies.length) + " ") + bodies[j]);
    j = j + 1;
  }
  if (lines.length + 2 <= budget) {
    lines.push("");
    lines.push(INDENT + wrap(DIM, fitText(SUGGESTION, w - INDENT_WIDTH)));
  }
  return joinLines(lines);
}

export function terminalWidth(): int {
  let c = cols(STDIN);
  if (c <= 0) { return DEFAULT_WIDTH; }
  return c;
}

export function terminalRows(): int {
  let r = rows(STDIN);
  if (r <= 1) { return DEFAULT_ROWS; }
  return r;
}

export function buildWelcomeBox(model: string, workspace: string, mode: string, server: string): string {
  let f: WelcomeFacts = { model: model, workspace: workspace, repo: repoSummary(workspace), mode: mode, server: server };
  return welcomeBlock(f, terminalWidth(), welcomeRows(terminalRows()));
}
