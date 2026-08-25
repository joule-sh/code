import { decodeSgrMouse, digitsToInt, paramAt, MOUSE_NONE, MOUSE_PRESS, MOUSE_DRAG, MOUSE_RELEASE, MOUSE_WHEEL_UP, MOUSE_WHEEL_DOWN } from "./mouse_events.ts";

test("digitsToInt reads a run of digits and rejects anything else", () => {
  expect(digitsToInt("0") == 0);
  expect(digitsToInt("1006") == 1006);
  expect(digitsToInt("") == -1);
  expect(digitsToInt("1a") == -1);
  expect(digitsToInt("-3") == -1);
});

test("paramAt picks the semicolon-separated field, or -1 past the end", () => {
  expect(paramAt("0;12;7", 0) == 0);
  expect(paramAt("0;12;7", 1) == 12);
  expect(paramAt("0;12;7", 2) == 7);
  expect(paramAt("0;12;7", 3) == -1);
});

test("a left button press decodes to a press carrying its row and column", () => {
  let ev = decodeSgrMouse("0;12;7", true);
  expect(ev.kind == MOUSE_PRESS);
  expect(ev.col == 12);
  expect(ev.row == 7);
});

test("the same button with the motion bit set decodes to a drag", () => {
  let ev = decodeSgrMouse("32;12;9", true);
  expect(ev.kind == MOUSE_DRAG);
  expect(ev.col == 12);
  expect(ev.row == 9);
});

test("the lowercase terminator makes the same button a release", () => {
  let ev = decodeSgrMouse("0;12;9", false);
  expect(ev.kind == MOUSE_RELEASE);
  expect(ev.row == 9);
});

test("a release reported while the pointer is moving is still a release", () => {
  expect(decodeSgrMouse("32;4;4", false).kind == MOUSE_RELEASE);
});

test("wheel buttons stay wheel events rather than becoming presses", () => {
  expect(decodeSgrMouse("64;1;1", true).kind == MOUSE_WHEEL_UP);
  expect(decodeSgrMouse("65;1;1", true).kind == MOUSE_WHEEL_DOWN);
});

test("a wheel-coded release is not a scroll and not a selection event", () => {
  expect(decodeSgrMouse("64;1;1", false).kind == MOUSE_NONE);
});

test("modifier bits on a left press do not stop it being a press", () => {
  expect(decodeSgrMouse("4;3;3", true).kind == MOUSE_PRESS);
  expect(decodeSgrMouse("16;3;3", true).kind == MOUSE_PRESS);
  expect(decodeSgrMouse("36;3;3", true).kind == MOUSE_DRAG);
});

test("the middle and right buttons are ignored, so they never start a selection", () => {
  expect(decodeSgrMouse("1;3;3", true).kind == MOUSE_NONE);
  expect(decodeSgrMouse("2;3;3", true).kind == MOUSE_NONE);
});

test("motion with no button held is ignored", () => {
  expect(decodeSgrMouse("35;3;3", true).kind == MOUSE_NONE);
});

test("a malformed or truncated parameter list decodes to nothing", () => {
  expect(decodeSgrMouse("", true).kind == MOUSE_NONE);
  expect(decodeSgrMouse("0", true).kind == MOUSE_NONE);
  expect(decodeSgrMouse("0;5", true).kind == MOUSE_NONE);
  expect(decodeSgrMouse("0;0;0", true).kind == MOUSE_NONE);
  expect(decodeSgrMouse("x;1;1", true).kind == MOUSE_NONE);
});
