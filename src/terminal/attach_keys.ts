import { Key, KEY_ARROW_UP, KEY_ARROW_DOWN, KEY_TAB, KEY_ARROW_RIGHT, KEY_BACKTAB, KEY_CTRL_O } from "../vendor/tty/tty.ts";
import { InputLine, InputHistory } from "./input_state.ts";
import { Scrollback } from "./scrollback.ts";
import { screenRows, nextMode } from "./attach_slots.ts";
import { isPointerKey, handlePointerKey } from "./mouse_select.ts";

export function isNavigationKey(kind: string): bool {
  if (kind == KEY_TAB || kind == KEY_ARROW_RIGHT || kind == KEY_ARROW_UP || kind == KEY_ARROW_DOWN) { return true; }
  if (kind == KEY_BACKTAB || kind == KEY_CTRL_O) { return true; }
  if (isPointerKey(kind)) { return true; }
  return false;
}

export function handleNavigationKey(k: Key, input: InputLine, history: InputHistory, sb: Scrollback, mode: string, setMode: (m: string) => void): bool {
  let kind = k.kind;
  if (kind == KEY_TAB || kind == KEY_ARROW_RIGHT) {
    return input.acceptCompletion();
  }
  if (kind == KEY_ARROW_UP) {
    if (input.completion.isOpen() && !history.navigating) {
      input.completion.move(-1);
      return true;
    }
    input.setBuf(history.back(input.buf));
    return true;
  }
  if (kind == KEY_ARROW_DOWN) {
    if (input.completion.isOpen() && !history.navigating) {
      input.completion.move(1);
      return true;
    }
    input.setBuf(history.forward());
    return true;
  }
  if (kind == KEY_BACKTAB) {
    setMode(nextMode(mode));
    return true;
  }
  if (kind == KEY_CTRL_O) {
    return sb.toggleLastGroup();
  }
  if (isPointerKey(kind)) {
    return handlePointerKey(k, sb, input, screenRows());
  }
  return false;
}
