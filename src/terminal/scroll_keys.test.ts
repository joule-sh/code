import { isScrollKey, applyScrollKey, WHEEL_SCROLL_LINES } from "./scroll_keys.ts";
import { Scrollback } from "./scrollback.ts";
import { KEY_PAGE_UP, KEY_PAGE_DOWN, KEY_SCROLL_UP, KEY_SCROLL_DOWN, KEY_CHAR, KEY_ENTER } from "../vendor/tty/tty.ts";

function longScrollback(): Scrollback {
  let sb = new Scrollback();
  let i = 0;
  while (i < 100) {
    sb.append("line " + i + "\n");
    i = i + 1;
  }
  return sb;
}

test("the four scrolling keys are recognised and nothing else is", () => {
  expect(isScrollKey(KEY_PAGE_UP));
  expect(isScrollKey(KEY_PAGE_DOWN));
  expect(isScrollKey(KEY_SCROLL_UP));
  expect(isScrollKey(KEY_SCROLL_DOWN));
  expect(!isScrollKey(KEY_CHAR));
  expect(!isScrollKey(KEY_ENTER));
});

test("PageUp scrolls a whole screen and PageDown brings it back", () => {
  let sb = longScrollback();
  expect(applyScrollKey(KEY_PAGE_UP, sb, 24));
  expect(sb.offset == 23);
  expect(!sb.isAtBottom());
  expect(applyScrollKey(KEY_PAGE_DOWN, sb, 24));
  expect(sb.isAtBottom());
});

test("the wheel scrolls a few lines at a time", () => {
  let sb = longScrollback();
  expect(applyScrollKey(KEY_SCROLL_UP, sb, 24));
  expect(sb.offset == WHEEL_SCROLL_LINES);
  expect(applyScrollKey(KEY_SCROLL_DOWN, sb, 24));
  expect(sb.isAtBottom());
});

test("a key that is not a scrolling key leaves the view alone", () => {
  let sb = longScrollback();
  expect(!applyScrollKey(KEY_CHAR, sb, 24));
  expect(sb.isAtBottom());
});
