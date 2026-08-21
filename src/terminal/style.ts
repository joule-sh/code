import { TOOL_CALL, TOOL_RESULT, APPROVAL_REQUEST, TURN_END, ERROR } from "../protocol/frames.ts";

const ESC: string = String.fromCharCode(27);

export const RESET: string = ESC + "[0m";
export const VIOLET: string = ESC + "[38;2;139;92;246m";
export const BOLD: string = ESC + "[1m";
export const UNDERLINE: string = ESC + "[4m";
export const DIM: string = ESC + "[38;2;120;120;125m";
export const RED: string = ESC + "[38;2;229;72;77m";
export const GREEN: string = ESC + "[38;2;110;190;115m";
export const YELLOW: string = ESC + "[38;2;214;168;73m";
export const REVERSE: string = ESC + "[7m";

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
    return wrap(VIOLET, text);
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
  if (kind == TURN_END) {
    return wrap(DIM, text);
  }
  return text;
}

export function stylePrompt(text: string): string {
  return wrap(VIOLET, text);
}

export function styleBanner(text: string): string {
  return wrap(DIM, text);
}

export function styleScrollIndicator(text: string): string {
  return wrap(BOLD + YELLOW, text);
}
