import { readKey, readKeyTimeout, openTestPipe, writeByteToTestPipe, KEY_SCROLL_UP, KEY_SCROLL_DOWN, KEY_MOUSE_PRESS, KEY_MOUSE_DRAG, KEY_MOUSE_RELEASE, KEY_CHAR, KEY_UNKNOWN, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING } from "./tty.ts";

const ESC: string = String.fromCharCode(27);

function writeMouseSequence(button: string, terminator: int): void {
  writeByteToTestPipe(27);
  writeByteToTestPipe(91);
  writeByteToTestPipe(60);
  let i = 0;
  while (i < button.length) {
    writeByteToTestPipe(button.charCodeAt(i));
    i = i + 1;
  }
  writeByteToTestPipe(59);
  writeByteToTestPipe(49);
  writeByteToTestPipe(48);
  writeByteToTestPipe(59);
  writeByteToTestPipe(53);
  writeByteToTestPipe(terminator);
}

test("readKey decodes an SGR wheel-up event", () => {
  let fd = openTestPipe();
  writeMouseSequence("64", 77);
  expect(readKey(fd).kind == KEY_SCROLL_UP);
});

test("readKey decodes an SGR wheel-down event", () => {
  let fd = openTestPipe();
  writeMouseSequence("65", 77);
  expect(readKey(fd).kind == KEY_SCROLL_DOWN);
});

test("readKeyTimeout decodes a wheel event just like readKey", () => {
  let fd = openTestPipe();
  writeMouseSequence("64", 77);
  expect(readKeyTimeout(fd, 50).kind == KEY_SCROLL_UP);
});

test("a mouse click press decodes to a press at its row and column, every byte consumed", () => {
  let fd = openTestPipe();
  writeMouseSequence("0", 77);
  writeByteToTestPipe(97);
  let press = readKey(fd);
  expect(press.kind == KEY_MOUSE_PRESS);
  expect(press.row == 5);
  expect(press.col == 10);
  let k = readKey(fd);
  expect(k.kind == KEY_CHAR);
  expect(k.char == "a");
});

test("a mouse release decodes to a release at its row and column, every byte consumed", () => {
  let fd = openTestPipe();
  writeMouseSequence("0", 109);
  writeByteToTestPipe(98);
  let up = readKey(fd);
  expect(up.kind == KEY_MOUSE_RELEASE);
  expect(up.row == 5);
  expect(up.col == 10);
  let k = readKey(fd);
  expect(k.kind == KEY_CHAR);
  expect(k.char == "b");
});

test("a motion event with the left button held decodes to a drag", () => {
  let fd = openTestPipe();
  writeMouseSequence("32", 77);
  let k = readKey(fd);
  expect(k.kind == KEY_MOUSE_DRAG);
  expect(k.row == 5);
  expect(k.col == 10);
});

test("a wheel-coded release event is not a scroll", () => {
  let fd = openTestPipe();
  writeMouseSequence("64", 109);
  expect(readKey(fd).kind == KEY_UNKNOWN);
});

test("an unterminated mouse sequence gives up as unknown on timeout", () => {
  let fd = openTestPipe();
  writeByteToTestPipe(27);
  writeByteToTestPipe(91);
  writeByteToTestPipe(60);
  writeByteToTestPipe(54);
  expect(readKey(fd).kind == KEY_UNKNOWN);
});

test("mouse reporting constants pair 1000, 1002 and 1006 private modes", () => {
  expect(ENABLE_MOUSE_REPORTING == ESC + "[?1000h" + ESC + "[?1002h" + ESC + "[?1006h");
  expect(DISABLE_MOUSE_REPORTING == ESC + "[?1006l" + ESC + "[?1002l" + ESC + "[?1000l");
});
