import { Key, KEY_MOUSE_PRESS, KEY_MOUSE_DRAG, KEY_MOUSE_RELEASE, KEY_ESCAPE } from "../vendor/tty/tty.ts";
import { Scrollback } from "./scrollback.ts";
import { InputLine } from "./input_state.ts";
import { isScrollKey, applyScrollKey } from "./scroll_keys.ts";
import { Selection, selectedText, countLines } from "./selection.ts";
import { writeClipboard } from "./osc52.ts";

export function isMouseSelectKey(kind: string): bool {
  return kind == KEY_MOUSE_PRESS || kind == KEY_MOUSE_DRAG || kind == KEY_MOUSE_RELEASE;
}

export function isPointerKey(kind: string): bool {
  return isScrollKey(kind) || isMouseSelectKey(kind) || kind == KEY_ESCAPE;
}

export function copyOnRelease(sb: Scrollback): string {
  let sel = sb.selection;
  sel.dragging = false;
  if (!sel.hasRange()) {
    sel.clear();
    return "";
  }
  let text = selectedText(sel, sb.lines, (i: int) => sb.isHidden(i));
  if (text.trim() == "") {
    sel.clear();
    return "";
  }
  sel.copied = true;
  sel.copiedLines = countLines(text);
  return text;
}

export function finishSelection(sb: Scrollback): bool {
  writeClipboard(copyOnRelease(sb));
  return true;
}

function clearIfLive(sel: Selection): bool {
  if (sel.isLive()) {
    sel.clear();
    return true;
  }
  return false;
}

export function applyMouseState(sb: Scrollback, on: bool): void {
  sb.selection.enabled = on;
  if (!on) { sb.selection.clear(); }
}

export function handlePointerKey(k: Key, sb: Scrollback, input: InputLine, rows: int): bool {
  if (isScrollKey(k.kind)) { return applyScrollKey(k.kind, sb, rows); }

  let sel = sb.selection;
  if (k.kind == KEY_ESCAPE) { return clearIfLive(sel); }
  if (!sel.enabled) { return false; }
  if (input.capturing()) { return clearIfLive(sel); }

  if (k.kind == KEY_MOUSE_PRESS) {
    let line = sel.lineAtRow(k.row);
    if (line < 0) { return clearIfLive(sel); }
    sel.begin(line, k.col);
    return true;
  }

  if (!sel.dragging) { return false; }

  let onLine = sel.lineAtRow(k.row);
  if (onLine >= 0) { sel.extend(onLine, k.col); }
  if (k.kind == KEY_MOUSE_DRAG) { return true; }
  return finishSelection(sb);
}
