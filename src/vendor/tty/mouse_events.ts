export const MOUSE_NONE: string = "none";
export const MOUSE_PRESS: string = "press";
export const MOUSE_DRAG: string = "drag";
export const MOUSE_RELEASE: string = "release";
export const MOUSE_WHEEL_UP: string = "wheel_up";
export const MOUSE_WHEEL_DOWN: string = "wheel_down";

export type MouseEvent = { kind: string, row: int, col: int };

const BUTTON_MASK: int = 3;
const MOTION_BIT: int = 32;
const WHEEL_BIT: int = 64;
const BUTTON_LEFT: int = 0;

function none(): MouseEvent {
  return { kind: MOUSE_NONE, row: 0, col: 0 };
}

export function digitsToInt(text: string): int {
  let out = 0;
  let i = 0;
  let sawDigit = false;
  while (i < text.length) {
    let c = text.charCodeAt(i);
    if (c < 48 || c > 57) { return -1; }
    sawDigit = true;
    out = out * 10 + (c - 48);
    i = i + 1;
  }
  if (!sawDigit) { return -1; }
  return out;
}

export function paramAt(params: string, index: int): int {
  let parts = params.split(";");
  if (index >= parts.length) { return -1; }
  return digitsToInt(parts[index]);
}

export function decodeSgrMouse(params: string, isPress: bool): MouseEvent {
  let button = paramAt(params, 0);
  let col = paramAt(params, 1);
  let row = paramAt(params, 2);
  if (button < 0 || col < 1 || row < 1) { return none(); }

  if ((button & WHEEL_BIT) != 0) {
    if (!isPress) { return none(); }
    if ((button & BUTTON_MASK) == 0) { return { kind: MOUSE_WHEEL_UP, row: row, col: col }; }
    if ((button & BUTTON_MASK) == 1) { return { kind: MOUSE_WHEEL_DOWN, row: row, col: col }; }
    return none();
  }

  if ((button & BUTTON_MASK) != BUTTON_LEFT) { return none(); }

  if (!isPress) { return { kind: MOUSE_RELEASE, row: row, col: col }; }
  if ((button & MOTION_BIT) != 0) { return { kind: MOUSE_DRAG, row: row, col: col }; }
  return { kind: MOUSE_PRESS, row: row, col: col };
}
