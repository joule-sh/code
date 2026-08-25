import { isPointerKey, isMouseSelectKey, handlePointerKey, copyOnRelease, applyMouseState } from "./mouse_select.ts";
import { Scrollback } from "./scrollback.ts";
import { InputLine } from "./input_state.ts";
import { CODE_MARKER } from "./prompt_rows.ts";
import { Key, KEY_MOUSE_PRESS, KEY_MOUSE_DRAG, KEY_MOUSE_RELEASE, KEY_SCROLL_UP, KEY_SCROLL_DOWN, KEY_PAGE_UP, KEY_ESCAPE, KEY_CHAR, KEY_ENTER } from "../vendor/tty/tty.ts";

const ROWS: int = 24;

function pointer(kind: string, row: int, col: int): Key {
  return { kind: kind, char: "", row: row, col: col };
}

function seededScrollback(): Scrollback {
  let sb = new Scrollback();
  let i = 0;
  while (i < 40) {
    sb.append("line " + `${i}` + " body\n");
    i = i + 1;
  }
  return sb;
}

function mapRowsToLines(sb: Scrollback, first: int, count: int): void {
  let map: int[] = [];
  while (map.length < first) { map.push(-1); }
  let i = 0;
  while (i < count) {
    map.push(i);
    i = i + 1;
  }
  while (map.length <= ROWS) { map.push(-1); }
  sb.selection.setRowMap(map);
}

test("pointer keys cover the wheel, the paging keys, the button events and Escape", () => {
  expect(isPointerKey(KEY_SCROLL_UP));
  expect(isPointerKey(KEY_SCROLL_DOWN));
  expect(isPointerKey(KEY_PAGE_UP));
  expect(isPointerKey(KEY_MOUSE_PRESS));
  expect(isPointerKey(KEY_MOUSE_DRAG));
  expect(isPointerKey(KEY_MOUSE_RELEASE));
  expect(isPointerKey(KEY_ESCAPE));
  expect(!isPointerKey(KEY_CHAR));
  expect(!isPointerKey(KEY_ENTER));
});

test("only the button events count as selection events", () => {
  expect(isMouseSelectKey(KEY_MOUSE_PRESS));
  expect(isMouseSelectKey(KEY_MOUSE_DRAG));
  expect(isMouseSelectKey(KEY_MOUSE_RELEASE));
  expect(!isMouseSelectKey(KEY_SCROLL_UP));
  expect(!isMouseSelectKey(KEY_ESCAPE));
});

test("the wheel still scrolls while a selection is possible, and while one is live", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  mapRowsToLines(sb, 1, 20);
  expect(handlePointerKey(pointer(KEY_SCROLL_UP, 0, 0), sb, input, ROWS));
  expect(!sb.isAtBottom());
  let scrolledTo = sb.offset;

  handlePointerKey(pointer(KEY_MOUSE_PRESS, 3, 2), sb, input, ROWS);
  handlePointerKey(pointer(KEY_MOUSE_DRAG, 5, 6), sb, input, ROWS);
  expect(sb.selection.hasRange());

  expect(handlePointerKey(pointer(KEY_SCROLL_UP, 0, 0), sb, input, ROWS));
  expect(sb.offset > scrolledTo);
  expect(sb.selection.hasRange());

  handlePointerKey(pointer(KEY_SCROLL_DOWN, 0, 0), sb, input, ROWS);
  expect(sb.offset < scrolledTo + 3);
});

test("press then drag builds a range anchored to scrollback lines, not screen rows", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  mapRowsToLines(sb, 1, 20);
  handlePointerKey(pointer(KEY_MOUSE_PRESS, 4, 3), sb, input, ROWS);
  expect(sb.selection.anchorLine == 3);
  expect(sb.selection.anchorCol == 3);
  expect(!sb.selection.hasRange());
  handlePointerKey(pointer(KEY_MOUSE_DRAG, 7, 5), sb, input, ROWS);
  expect(sb.selection.hasRange());
  expect(sb.selection.startLine() == 3);
  expect(sb.selection.endLine() == 6);
});

test("a press on a row that holds no transcript line starts nothing", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  mapRowsToLines(sb, 1, 20);
  handlePointerKey(pointer(KEY_MOUSE_PRESS, ROWS, 4), sb, input, ROWS);
  expect(!sb.selection.dragging);
  expect(!sb.selection.hasRange());
});

test("a drag arriving with no press behind it is ignored", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  mapRowsToLines(sb, 1, 20);
  expect(!handlePointerKey(pointer(KEY_MOUSE_DRAG, 5, 5), sb, input, ROWS));
  expect(!sb.selection.hasRange());
});

test("releasing after a real drag yields the selected text and marks it copied", () => {
  let sb = new Scrollback();
  sb.append("alpha\nbeta\ngamma");
  let sel = sb.selection;
  sel.begin(0, 3);
  sel.extend(1, 2);
  let copied = copyOnRelease(sel, sb.lines);
  expect(copied == "pha" + String.fromCharCode(10) + "be");
  expect(sel.copied);
  expect(sel.copiedLines == 2);
  expect(!sel.dragging);
});

test("a click that never moved copies nothing and leaves no selection behind", () => {
  let sb = new Scrollback();
  sb.append("alpha\nbeta");
  let sel = sb.selection;
  sel.begin(1, 2);
  expect(copyOnRelease(sel, sb.lines) == "");
  expect(!sel.copied);
  expect(!sel.isLive());
});

test("a drag over blank space copies nothing rather than an empty clipboard write", () => {
  let sb = new Scrollback();
  sb.append("   \n   ");
  let sel = sb.selection;
  sel.begin(0, 1);
  sel.extend(1, 3);
  expect(copyOnRelease(sel, sb.lines) == "");
  expect(!sel.copied);
});

test("while the input line is capturing a code, no selection starts and any live one is dropped", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  mapRowsToLines(sb, 1, 20);
  handlePointerKey(pointer(KEY_MOUSE_PRESS, 3, 2), sb, input, ROWS);
  handlePointerKey(pointer(KEY_MOUSE_DRAG, 6, 4), sb, input, ROWS);
  expect(sb.selection.hasRange());

  input.captureWith(CODE_MARKER);
  expect(handlePointerKey(pointer(KEY_MOUSE_DRAG, 8, 4), sb, input, ROWS));
  expect(!sb.selection.isLive());

  handlePointerKey(pointer(KEY_MOUSE_PRESS, 4, 2), sb, input, ROWS);
  expect(!sb.selection.dragging);
  handlePointerKey(pointer(KEY_MOUSE_DRAG, 6, 4), sb, input, ROWS);
  expect(!sb.selection.hasRange());
  expect(copyOnRelease(sb.selection, sb.lines) == "");
});

test("the wheel keeps working while the input line is capturing a code", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  input.captureWith(CODE_MARKER);
  expect(handlePointerKey(pointer(KEY_SCROLL_UP, 0, 0), sb, input, ROWS));
  expect(!sb.isAtBottom());
});

test("Escape clears a live selection, and does nothing when there is none", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  mapRowsToLines(sb, 1, 20);
  expect(!handlePointerKey(pointer(KEY_ESCAPE, 0, 0), sb, input, ROWS));
  handlePointerKey(pointer(KEY_MOUSE_PRESS, 3, 2), sb, input, ROWS);
  handlePointerKey(pointer(KEY_MOUSE_DRAG, 5, 6), sb, input, ROWS);
  expect(handlePointerKey(pointer(KEY_ESCAPE, 0, 0), sb, input, ROWS));
  expect(!sb.selection.isLive());
});

test("clearing the scrollback drops the selection pointing into it", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  mapRowsToLines(sb, 1, 20);
  handlePointerKey(pointer(KEY_MOUSE_PRESS, 3, 2), sb, input, ROWS);
  handlePointerKey(pointer(KEY_MOUSE_DRAG, 5, 6), sb, input, ROWS);
  expect(sb.selection.hasRange());
  sb.clear();
  expect(!sb.selection.isLive());
});

test("with /mouse off the button events are ignored and no selection can form", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  mapRowsToLines(sb, 1, 20);
  applyMouseState(sb, false);
  expect(!handlePointerKey(pointer(KEY_MOUSE_PRESS, 3, 2), sb, input, ROWS));
  expect(!handlePointerKey(pointer(KEY_MOUSE_DRAG, 6, 4), sb, input, ROWS));
  expect(!handlePointerKey(pointer(KEY_MOUSE_RELEASE, 6, 4), sb, input, ROWS));
  expect(!sb.selection.hasRange());
  expect(!sb.selection.isLive());
});

test("turning reporting off drops a selection that was already on screen", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  mapRowsToLines(sb, 1, 20);
  handlePointerKey(pointer(KEY_MOUSE_PRESS, 3, 2), sb, input, ROWS);
  handlePointerKey(pointer(KEY_MOUSE_DRAG, 6, 4), sb, input, ROWS);
  expect(sb.selection.hasRange());
  applyMouseState(sb, false);
  expect(!sb.selection.isLive());
  applyMouseState(sb, true);
  expect(handlePointerKey(pointer(KEY_MOUSE_PRESS, 3, 2), sb, input, ROWS));
});

test("paging keys keep working with reporting off, so scrolling never depends on the mouse", () => {
  let sb = seededScrollback();
  let input = new InputLine();
  applyMouseState(sb, false);
  expect(handlePointerKey(pointer(KEY_PAGE_UP, 0, 0), sb, input, ROWS));
  expect(!sb.isAtBottom());
});
