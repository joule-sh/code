// @link ./tty_shim.o
declare function tty_isatty(fd: int): int;
declare function tty_raw_enable(fd: int): int;
declare function tty_raw_disable(fd: int): int;
declare function tty_read_byte(fd: int): int;
declare function tty_read_byte_timeout(fd: int, timeoutMs: int): int;
declare function tty_cols(fd: int): int;
declare function tty_rows(fd: int): int;
declare function tty_open_devnull_for_test(): int;
declare function tty_open_test_pipe(): int;
declare function tty_write_byte_to_test_pipe(byte: int): int;

import { MouseEvent, decodeSgrMouse, MOUSE_PRESS, MOUSE_DRAG, MOUSE_RELEASE, MOUSE_WHEEL_UP, MOUSE_WHEEL_DOWN } from "./mouse_events.ts";

export function isatty(fd: int): bool {
  return tty_isatty(fd) == 1;
}

export function rawEnable(fd: int): bool {
  return tty_raw_enable(fd) == 0;
}

export function rawDisable(fd: int): bool {
  return tty_raw_disable(fd) == 0;
}

export function readByte(fd: int): int {
  return tty_read_byte(fd);
}

export function readByteTimeout(fd: int, timeoutMs: int): int {
  return tty_read_byte_timeout(fd, timeoutMs);
}

export function cols(fd: int): int {
  return tty_cols(fd);
}

export function rows(fd: int): int {
  return tty_rows(fd);
}

export const KEY_CHAR: string = "char";
export const KEY_ENTER: string = "enter";
export const KEY_BACKSPACE: string = "backspace";
export const KEY_TAB: string = "tab";
export const KEY_BACKTAB: string = "backtab";
export const KEY_ESCAPE: string = "escape";
export const KEY_CTRL_C: string = "ctrl_c";
export const KEY_CTRL_D: string = "ctrl_d";
export const KEY_CTRL_O: string = "ctrl_o";
export const KEY_ARROW_UP: string = "arrow_up";
export const KEY_ARROW_DOWN: string = "arrow_down";
export const KEY_ARROW_LEFT: string = "arrow_left";
export const KEY_ARROW_RIGHT: string = "arrow_right";
export const KEY_PAGE_UP: string = "page_up";
export const KEY_PAGE_DOWN: string = "page_down";
export const KEY_SCROLL_UP: string = "scroll_up";
export const KEY_SCROLL_DOWN: string = "scroll_down";
export const KEY_MOUSE_PRESS: string = "mouse_press";
export const KEY_MOUSE_DRAG: string = "mouse_drag";
export const KEY_MOUSE_RELEASE: string = "mouse_release";
export const KEY_EOF: string = "eof";
export const KEY_UNKNOWN: string = "unknown";
export const KEY_TIMEOUT: string = "timeout";

export type Key = { kind: string, char: string, row: int, col: int };

function simpleKey(kind: string): Key {
  return { kind: kind, char: "", row: 0, col: 0 };
}

function charKey(ch: string): Key {
  return { kind: KEY_CHAR, char: ch, row: 0, col: 0 };
}

function mouseKey(kind: string, row: int, col: int): Key {
  return { kind: kind, char: "", row: row, col: col };
}

function utf8ContinuationCount(first: int): int {
  if (first >= 240) { return 3; }
  if (first >= 224) { return 2; }
  if (first >= 192) { return 1; }
  return 0;
}

function readUtf8Char(fd: int, first: int): string {
  let extra = utf8ContinuationCount(first);
  let out = String.fromCharCode(first);
  let i = 0;
  while (i < extra) {
    let b = readByte(fd);
    if (b < 0) { return out; }
    out = out + String.fromCharCode(b);
    i = i + 1;
  }
  return out;
}

function keyForMouse(ev: MouseEvent): Key {
  if (ev.kind == MOUSE_WHEEL_UP) { return simpleKey(KEY_SCROLL_UP); }
  if (ev.kind == MOUSE_WHEEL_DOWN) { return simpleKey(KEY_SCROLL_DOWN); }
  if (ev.kind == MOUSE_PRESS) { return mouseKey(KEY_MOUSE_PRESS, ev.row, ev.col); }
  if (ev.kind == MOUSE_DRAG) { return mouseKey(KEY_MOUSE_DRAG, ev.row, ev.col); }
  if (ev.kind == MOUSE_RELEASE) { return mouseKey(KEY_MOUSE_RELEASE, ev.row, ev.col); }
  return simpleKey(KEY_UNKNOWN);
}

function readSgrMouse(fd: int): Key {
  let params = "";
  let terminator = 0;
  while (terminator == 0) {
    let b = readByteTimeout(fd, 50);
    if (b < 0) { return simpleKey(KEY_UNKNOWN); }
    if (b == 77 || b == 109) {
      terminator = b;
    } else {
      params = params + String.fromCharCode(b);
    }
  }
  return keyForMouse(decodeSgrMouse(params, terminator == 77));
}

function readEscapeSequence(fd: int): Key {
  let b2 = readByteTimeout(fd, 50);
  if (b2 < 0) {
    return simpleKey(KEY_ESCAPE);
  }
  if (b2 != 91) {
    return simpleKey(KEY_UNKNOWN);
  }
  let b3 = readByteTimeout(fd, 50);
  if (b3 == 60) { return readSgrMouse(fd); }
  if (b3 == 90) { return simpleKey(KEY_BACKTAB); }
  if (b3 == 65) { return simpleKey(KEY_ARROW_UP); }
  if (b3 == 66) { return simpleKey(KEY_ARROW_DOWN); }
  if (b3 == 67) { return simpleKey(KEY_ARROW_RIGHT); }
  if (b3 == 68) { return simpleKey(KEY_ARROW_LEFT); }
  if (b3 == 53 || b3 == 54) {
    let b4 = readByteTimeout(fd, 50);
    if (b4 == 126) {
      if (b3 == 53) { return simpleKey(KEY_PAGE_UP); }
      return simpleKey(KEY_PAGE_DOWN);
    }
    return simpleKey(KEY_UNKNOWN);
  }
  return simpleKey(KEY_UNKNOWN);
}

function decodeFromByte(fd: int, b: int): Key {
  if (b == -1) { return simpleKey(KEY_EOF); }
  if (b < 0) { return simpleKey(KEY_UNKNOWN); }
  if (b == 13 || b == 10) { return simpleKey(KEY_ENTER); }
  if (b == 127 || b == 8) { return simpleKey(KEY_BACKSPACE); }
  if (b == 9) { return simpleKey(KEY_TAB); }
  if (b == 3) { return simpleKey(KEY_CTRL_C); }
  if (b == 4) { return simpleKey(KEY_CTRL_D); }
  if (b == 15) { return simpleKey(KEY_CTRL_O); }
  if (b == 27) { return readEscapeSequence(fd); }
  return charKey(readUtf8Char(fd, b));
}

export function readKey(fd: int): Key {
  let b = readByte(fd);
  return decodeFromByte(fd, b);
}

export function readKeyTimeout(fd: int, timeoutMs: int): Key {
  let b = readByteTimeout(fd, timeoutMs);
  if (b == -3) { return simpleKey(KEY_TIMEOUT); }
  return decodeFromByte(fd, b);
}

const ESC: string = String.fromCharCode(27);

export const ENTER_ALT_SCREEN: string = ESC + "[?1049h";
export const EXIT_ALT_SCREEN: string = ESC + "[?1049l";
export const HIDE_CURSOR: string = ESC + "[?25l";
export const SHOW_CURSOR: string = ESC + "[?25h";
export const CLEAR_SCREEN: string = ESC + "[2J";
export const CLEAR_LINE: string = ESC + "[2K";
export const ENABLE_MOUSE_REPORTING: string = ESC + "[?1000h" + ESC + "[?1002h" + ESC + "[?1006h";
export const DISABLE_MOUSE_REPORTING: string = ESC + "[?1006l" + ESC + "[?1002l" + ESC + "[?1000l";

export function cursorTo(row: int, col: int): string {
  return ESC + "[" + `${row}` + ";" + `${col}` + "H";
}

export function cursorUp(n: int): string {
  return ESC + "[" + `${n}` + "A";
}

export function cursorDown(n: int): string {
  return ESC + "[" + `${n}` + "B";
}

export function cursorToColumn(col: int): string {
  return ESC + "[" + `${col}` + "G";
}

export function openTestPipe(): int {
  return tty_open_test_pipe();
}

export function writeByteToTestPipe(byte: int): void {
  tty_write_byte_to_test_pipe(byte);
}

test("isatty is false for a non-terminal fd", () => {
  let fd = tty_open_devnull_for_test();
  expect(!isatty(fd));
});

test("raw_enable fails on a non-terminal fd, rather than crashing", () => {
  let fd = tty_open_devnull_for_test();
  expect(!rawEnable(fd));
});

test("raw_disable fails when nothing was enabled", () => {
  let fd = tty_open_devnull_for_test();
  expect(!rawDisable(fd));
});

test("readByte hits EOF on an empty source", () => {
  let fd = tty_open_devnull_for_test();
  expect(readByte(fd) == -1);
});

test("cols and rows are -1 on a non-terminal fd", () => {
  let fd = tty_open_devnull_for_test();
  expect(cols(fd) == -1);
  expect(rows(fd) == -1);
});

test("readByteTimeout times out on a pipe with no writer activity", () => {
  let fd = tty_open_test_pipe();
  expect(readByteTimeout(fd, 30) == -3);
});

test("readKeyTimeout times out with KEY_TIMEOUT on an idle pipe", () => {
  let fd = tty_open_test_pipe();
  expect(readKeyTimeout(fd, 30).kind == KEY_TIMEOUT);
});

test("readKeyTimeout decodes a real key exactly like readKey", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(97);
  let k = readKeyTimeout(fd, 50);
  expect(k.kind == KEY_CHAR);
  expect(k.char == "a");
});

test("readKey decodes Enter, Backspace, Tab, Ctrl-C, Ctrl-D", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(13);
  expect(readKey(fd).kind == KEY_ENTER);
  tty_write_byte_to_test_pipe(127);
  expect(readKey(fd).kind == KEY_BACKSPACE);
  tty_write_byte_to_test_pipe(9);
  expect(readKey(fd).kind == KEY_TAB);
  tty_write_byte_to_test_pipe(3);
  expect(readKey(fd).kind == KEY_CTRL_C);
  tty_write_byte_to_test_pipe(4);
  expect(readKey(fd).kind == KEY_CTRL_D);
});

test("readKey decodes Ctrl-O as its own key rather than a control character", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(15);
  let k = readKey(fd);
  expect(k.kind == KEY_CTRL_O);
  expect(k.char == "");
});

test("readKey decodes a plain ASCII character", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(97);
  let k = readKey(fd);
  expect(k.kind == KEY_CHAR);
  expect(k.char == "a");
});

test("readKey decodes the arrow keys", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(65);
  expect(readKey(fd).kind == KEY_ARROW_UP);
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(66);
  expect(readKey(fd).kind == KEY_ARROW_DOWN);
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(67);
  expect(readKey(fd).kind == KEY_ARROW_RIGHT);
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(68);
  expect(readKey(fd).kind == KEY_ARROW_LEFT);
});

test("readKey decodes PageUp and PageDown", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(53);
  tty_write_byte_to_test_pipe(126);
  expect(readKey(fd).kind == KEY_PAGE_UP);
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(54);
  tty_write_byte_to_test_pipe(126);
  expect(readKey(fd).kind == KEY_PAGE_DOWN);
});

test("readKey falls back to unknown for an unterminated CSI digit sequence", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(53);
  tty_write_byte_to_test_pipe(50);
  expect(readKey(fd).kind == KEY_UNKNOWN);
});

test("readKey decodes a lone Escape with nothing following", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(27);
  expect(readKey(fd).kind == KEY_ESCAPE);
});

function writeBacktab(): void {
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(90);
}

test("readKey decodes shift+tab as backtab, distinct from Tab, consuming exactly its three bytes", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(9);
  expect(readKey(fd).kind == KEY_TAB);
  writeBacktab();
  tty_write_byte_to_test_pipe(122);
  let k = readKey(fd);
  expect(k.kind == KEY_BACKTAB);
  expect(k.char == "");
  let next = readKey(fd);
  expect(next.kind == KEY_CHAR);
  expect(next.char == "z");
});

test("backtab decoding leaves lone Escape and the neighbouring CSI finals alone", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(27);
  expect(readKeyTimeout(fd, 50).kind == KEY_ESCAPE);
  writeBacktab();
  expect(readKeyTimeout(fd, 50).kind == KEY_BACKTAB);
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(65);
  expect(readKey(fd).kind == KEY_ARROW_UP);
  tty_write_byte_to_test_pipe(27);
  tty_write_byte_to_test_pipe(91);
  tty_write_byte_to_test_pipe(54);
  tty_write_byte_to_test_pipe(126);
  expect(readKey(fd).kind == KEY_PAGE_DOWN);
});

test("readKey decodes a 2-byte UTF-8 character", () => {
  let fd = tty_open_test_pipe();
  tty_write_byte_to_test_pipe(195);
  tty_write_byte_to_test_pipe(169);
  let k = readKey(fd);
  expect(k.kind == KEY_CHAR);
  expect(k.char.length == 2);
});

test("ANSI helpers produce the expected escape sequences", () => {
  expect(cursorTo(3, 5) == ESC + "[3;5H");
  expect(cursorUp(2) == ESC + "[2A");
  expect(cursorDown(1) == ESC + "[1B");
  expect(cursorToColumn(1) == ESC + "[1G");
  expect(CLEAR_LINE == ESC + "[2K");
});
