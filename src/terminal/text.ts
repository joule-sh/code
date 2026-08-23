const ELLIPSIS: string = "...";

export function repeatChar(ch: string, n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    out = out + ch;
    i = i + 1;
  }
  return out;
}

function utf8ByteCount(first: int): int {
  if (first >= 240) { return 4; }
  if (first >= 224) { return 3; }
  if (first >= 192) { return 2; }
  return 1;
}

export function visualWidth(plain: string): int {
  let count = 0;
  let i = 0;
  while (i < plain.length) {
    i = i + utf8ByteCount(plain.charCodeAt(i));
    count = count + 1;
  }
  return count;
}

export function truncateToWidth(text: string, width: int): string {
  if (width <= 0) { return ""; }
  let count = 0;
  let i = 0;
  while (i < text.length && count < width) {
    i = i + utf8ByteCount(text.charCodeAt(i));
    count = count + 1;
  }
  return text.slice(0, i);
}

export function tailToWidth(text: string, width: int): string {
  if (width <= 0) { return ""; }
  let total = visualWidth(text);
  if (total <= width) { return text; }
  let skip = total - width;
  let i = 0;
  let n = 0;
  while (n < skip && i < text.length) {
    i = i + utf8ByteCount(text.charCodeAt(i));
    n = n + 1;
  }
  return text.slice(i, text.length);
}

export function fitText(text: string, width: int): string {
  if (width <= 0) { return ""; }
  if (visualWidth(text) <= width) { return text; }
  if (width <= 3) { return truncateToWidth(text, width); }
  return truncateToWidth(text, width - 3) + ELLIPSIS;
}

export function fitPath(text: string, width: int): string {
  if (width <= 0) { return ""; }
  if (visualWidth(text) <= width) { return text; }
  if (width <= 3) { return tailToWidth(text, width); }
  return ELLIPSIS + tailToWidth(text, width - 3);
}

export function padTo(text: string, width: int): string {
  let t = fitText(text, width);
  let pad = width - visualWidth(t);
  if (pad < 0) { pad = 0; }
  return t + repeatChar(" ", pad);
}
