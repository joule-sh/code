import { TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR, NOTICE, MODE_CHANGED, MODEL_CHANGED, DAEMON_STOPPING } from "../protocol/frames.ts";

const ESC: string = String.fromCharCode(27);

export const RESET: string = ESC + "[0m";
export const BOLD: string = ESC + "[1m";
export const UNDERLINE: string = ESC + "[4m";
export const DIM: string = ESC + "[38;2;120;120;125m";
export const RED: string = ESC + "[38;2;229;72;77m";
export const GREEN: string = ESC + "[38;2;110;190;115m";
export const YELLOW: string = ESC + "[38;2;214;168;73m";
export const REVERSE: string = ESC + "[7m";

// The accent used for banners, prompts, and highlights across the terminal
// UI - everywhere else in this file and the ~15 modules that import it. A
// fixed small palette rather than free-form hex, so every option is picked
// for contrast against both a light and a dark terminal background and none
// of them can be confused with the semantic colours above (RED/GREEN/YELLOW
// mean failure/success/warning, never "the accent"). Kept as a plain
// exported `let` rather than a getter function: Lumen's module exports are
// live-bound across imports (confirmed empirically - a setter in this file
// is visible immediately to every other module's own `ACCENT` reference),
// so every existing `wrap(ACCENT, text)` call site keeps working unchanged
// once /color changes this value at startup.
export type AccentOption = { name: string, code: string };

export const ACCENT_PALETTE: AccentOption[] = [
  { name: "violet", code: ESC + "[38;2;139;92;246m" },
  { name: "blue", code: ESC + "[38;2;86;156;255m" },
  { name: "cyan", code: ESC + "[38;2;68;200;210m" },
  { name: "magenta", code: ESC + "[38;2;222;92;190m" },
  { name: "orange", code: ESC + "[38;2;230;146;60m" },
];

export const DEFAULT_ACCENT_NAME: string = "violet";

function paletteCodeFor(name: string): string {
  for (const opt of ACCENT_PALETTE) {
    if (opt.name == name) { return opt.code; }
  }
  return "";
}

export let ACCENT: string = paletteCodeFor(DEFAULT_ACCENT_NAME);

// "" for an unrecognised name, so a caller can tell a bad /color argument
// from a real change rather than silently falling back to violet.
export function setAccentByName(name: string): bool {
  let code = paletteCodeFor(name);
  if (code == "") { return false; }
  ACCENT = code;
  return true;
}

export function wrap(color: string, text: string): string {
  let start = 0;
  while (start < text.length && text.charAt(start) == "
") {
    start = start + 1;
  }
  let end = text.length;
  while (end > start && text.charAt(end - 1) == "
") {
    end = end - 1;
  }
  if (start >= end) {
    return text;
  }
  return text.slice(0, start) + color + text.slice(start, end) + RESET + text.slice(end, text.length);
}

export function styleFrame(kind: string, text: string): string {
  if (kind == TOOL_CALL) {
    return wrap(ACCENT, text);
  }
  if (kind == TOOL_RESULT) {
    if (text.indexOf("failed:") >= 0) {
      return wrap(RED, text);
    }
    return wrap(GREEN, text);
  }
  if (kind == APPROVAL_REQUEST) {
    return wrap(BOLD + YELLOW, text);
  }
  if (kind == ERROR) {
    return wrap(RED, text);
  }
  if (kind == NOTICE) {
    if (text.indexOf("! ") >= 0) {
      return wrap(BOLD + YELLOW, text);
    }
    return wrap(DIM, text);
  }
  if (kind == TURN_END) {
    return wrap(DIM, text);
  }
  if (kind == MODE_CHANGED || kind == MODEL_CHANGED) {
    return wrap(DIM, text);
  }
  if (kind == DAEMON_STOPPING) {
    return wrap(BOLD + YELLOW, text);
  }
  return text;
}

export function stylePrompt(text: string): string {
  return wrap(ACCENT, text);
}

export function styleBanner(text: string): string {
  return wrap(DIM, text);
}

export function styleScrollIndicator(text: string): string {
  return wrap(BOLD + YELLOW, text);
}
