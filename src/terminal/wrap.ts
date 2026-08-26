const ESC_CODE: int = 27;
const RESET_SEQ: string = String.fromCharCode(27) + "[0m";
const MIN_WRAP_WIDTH: int = 8;

function isSgrTerminator(c: string): bool {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
}

function utf8ByteCount(first: int): int {
  if (first >= 240) { return 4; }
  if (first >= 224) { return 3; }
  if (first >= 192) { return 2; }
  return 1;
}

function escapeEnd(line: string, i: int): int {
  let j = i + 1;
  if (j < line.length && line.charAt(j) == "[") {
    j = j + 1;
    while (j < line.length && !isSgrTerminator(line.charAt(j))) { j = j + 1; }
    if (j < line.length) { j = j + 1; }
  }
  return j;
}

export function plainWidth(line: string): int {
  let n = 0;
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) == ESC_CODE) {
      i = escapeEnd(line, i);
      continue;
    }
    i = i + utf8ByteCount(line.charCodeAt(i));
    n = n + 1;
  }
  return n;
}

function leadingSpaces(line: string): int {
  let i = 0;
  while (i < line.length && line.charAt(i) == " ") { i = i + 1; }
  return i;
}

function spaces(n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    out = out + " ";
    i = i + 1;
  }
  return out;
}

export function wrapToWidth(line: string, width: int): string[] {
  if (width < MIN_WRAP_WIDTH) { return [line]; }
  if (plainWidth(line) <= width) { return [line]; }

  let indentWidth = leadingSpaces(line);
  if (indentWidth > width / 2) { indentWidth = 0; }
  let indent = spaces(indentWidth);

  let out: string[] = [];
  let open = "";
  let cur = "";
  let col = 0;
  let breakAt = -1;
  let breakResume = -1;
  let i = 0;

  while (i < line.length) {
    if (line.charCodeAt(i) == ESC_CODE) {
      let j = escapeEnd(line, i);
      let seq = line.slice(i, j);
      if (seq == RESET_SEQ) { open = ""; } else { open = open + seq; }
      cur = cur + seq;
      i = j;
      continue;
    }

    let end = i + utf8ByteCount(line.charCodeAt(i));
    if (end > line.length) { end = line.length; }
    let ch = line.slice(i, end);

    if (col >= width) {
      let head = cur;
      let tail = "";
      if (ch != " " && breakAt > 0) {
        let candidate = cur.slice(breakResume, cur.length);
        if (indentWidth + plainWidth(candidate) < width) {
          head = cur.slice(0, breakAt);
          tail = candidate;
        }
      }
      if (open != "") { head = head + RESET_SEQ; }
      out.push(head);
      cur = indent + open + tail;
      col = indentWidth + plainWidth(tail);
      breakAt = -1;
      breakResume = -1;
      if (ch == " ") { i = end; }
      continue;
    }

    if (ch == " " && col > indentWidth) {
      breakAt = cur.length;
      breakResume = cur.length + 1;
    }
    cur = cur + ch;
    col = col + 1;
    i = end;
  }

  if (out.length > 0 && cur.trim() == "") { return out; }
  out.push(cur);
  return out;
}

test("a line inside the width is returned unchanged", () => {
  let out = wrapToWidth("hello", 20);
  expect(out.length == 1);
  expect(out[0] == "hello");
});

test("a long line is broken at a space, not mid-word", () => {
  let out = wrapToWidth("It looks fine. I will start it and watch what it prints.", 40);
  expect(out.length == 2);
  expect(out[0] == "It looks fine. I will start it and watch");
  expect(out[1] == "what it prints.");
});

test("no row of a wrapped line is wider than the width", () => {
  let long = "the daemon walked past the busy port and settled on another one, so this notice is long enough to need more than one row";
  for (const row of wrapToWidth(long, 40)) {
    expect(plainWidth(row) <= 40);
  }
});

test("nothing is dropped: the rows rejoin into the original text", () => {
  let long = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
  let joined = "";
  for (const row of wrapToWidth(long, 20)) {
    if (joined != "") { joined = joined + " "; }
    joined = joined + row;
  }
  expect(joined == long);
});

test("a word longer than the width is broken rather than dropped", () => {
  let out = wrapToWidth("aaaaaaaaaaaaaaaaaaaaaaaa", 10);
  expect(out.length == 3);
  expect(out[0] == "aaaaaaaaaa");
  expect(out[2] == "aaaa");
});

test("a continuation row keeps the leading indent of its line", () => {
  let out = wrapToWidth("     ok: the command printed a great deal of output on one line", 30);
  expect(out.length > 1);
  expect(out[1].slice(0, 5) == "     ");
});

test("escape sequences do not count towards the width", () => {
  let coloured = RESET_SEQ + "short";
  expect(plainWidth(coloured) == 5);
  let out = wrapToWidth(coloured, 10);
  expect(out.length == 1);
});

test("a colour open at a break is closed on that row and reopened on the next", () => {
  let red = String.fromCharCode(27) + "[31m";
  let out = wrapToWidth(red + "alpha beta gamma delta", 12);
  expect(out.length == 2);
  expect(out[0].slice(out[0].length - RESET_SEQ.length, out[0].length) == RESET_SEQ);
  expect(out[1].indexOf(red) >= 0);
});

test("a width too small to wrap into leaves the line alone", () => {
  let out = wrapToWidth("some fairly long line", 4);
  expect(out.length == 1);
});
