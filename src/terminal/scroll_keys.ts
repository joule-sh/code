import { KEY_PAGE_UP, KEY_PAGE_DOWN, KEY_SCROLL_UP, KEY_SCROLL_DOWN } from "../vendor/tty/tty.ts";
import { Scrollback } from "./scrollback.ts";

export const WHEEL_SCROLL_LINES: int = 3;

export function isScrollKey(kind: string): bool {
  return kind == KEY_PAGE_UP || kind == KEY_PAGE_DOWN || kind == KEY_SCROLL_UP || kind == KEY_SCROLL_DOWN;
}

export function applyScrollKey(kind: string, sb: Scrollback, rows: int): bool {
  let page = rows - 1;
  if (kind == KEY_PAGE_UP) { sb.scrollUp(page, page); return true; }
  if (kind == KEY_PAGE_DOWN) { sb.scrollDown(page, page); return true; }
  if (kind == KEY_SCROLL_UP) { sb.scrollUp(page, WHEEL_SCROLL_LINES); return true; }
  if (kind == KEY_SCROLL_DOWN) { sb.scrollDown(page, WHEEL_SCROLL_LINES); return true; }
  return false;
}
