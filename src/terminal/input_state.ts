export class Scrollback {
  lines: string[];
  offset: int;

  constructor() {
    this.lines = [""];
    this.offset = 0;
  }

  append(text: string): void {
    let before = this.lines.length;
    let parts = text.split("\n");
    let i = 0;
    while (i < parts.length) {
      if (i == 0) {
        let last = this.lines.length - 1;
        let merged = this.lines[last] + parts[i];
        this.lines = [...this.lines.slice(0, last), merged];
      } else {
        this.lines.push(parts[i]);
      }
      i = i + 1;
    }
    if (this.offset > 0) {
      let added = this.lines.length - before;
      if (added > 0) {
        this.offset = this.offset + added;
      }
    }
  }

  clear(): void {
    this.lines = [""];
    this.offset = 0;
  }

  tail(n: int): string[] {
    return this.tailFrom(n, 0);
  }

  tailFrom(visible: int, offset: int): string[] {
    let off = offset;
    if (off < 0) {
      off = 0;
    }
    let m = this.maxOffset(visible);
    if (off > m) {
      off = m;
    }
    let end = this.lines.length - off;
    if (end < 0) {
      end = 0;
    }
    let start = end - visible;
    if (start < 0) {
      start = 0;
    }
    let out: string[] = [];
    let i = start;
    while (i < end) {
      out.push(this.lines[i]);
      i = i + 1;
    }
    return out;
  }

  maxOffset(visible: int): int {
    let m = this.lines.length - visible;
    if (m < 0) {
      m = 0;
    }
    return m;
  }

  scrollUp(visible: int, n: int): void {
    this.offset = this.offset + n;
    let m = this.maxOffset(visible);
    if (this.offset > m) {
      this.offset = m;
    }
  }

  scrollDown(visible: int, n: int): void {
    this.offset = this.offset - n;
    if (this.offset < 0) {
      this.offset = 0;
    }
  }

  resetToBottom(): void {
    this.offset = 0;
  }

  isAtBottom(): bool {
    return this.offset <= 0;
  }
}

export class InputLine {
  buf: string;

  constructor() {
    this.buf = "";
  }

  push(ch: string): void {
    this.buf = this.buf + ch;
  }

  backspace(): void {
    if (this.buf.length > 0) {
      this.buf = this.buf.slice(0, this.buf.length - 1);
    }
  }

  takeAndClear(): string {
    let out = this.buf;
    this.buf = "";
    return out;
  }

  clear(): void {
    this.buf = "";
  }
}

export class PendingApproval {
  callId: string;

  constructor() {
    this.callId = "";
  }

  set(id: string): void {
    this.callId = id;
  }

  clearIfMatches(id: string): void {
    if (this.callId == id) {
      this.callId = "";
    }
  }

  isPending(): bool {
    return this.callId != "";
  }
}

const ESC_CODE: int = 27;

function isSgrTerminator(c: string): bool {
  return (c >= "A" && c <= "Z") || (c >= "a" && c <= "z");
}

export function clip(line: string, width: int): string {
  if (width <= 0) {
    return line;
  }

  let visible = 0;
  let out = "";
  let hadEscape = false;
  let i = 0;

  while (i < line.length) {
    if (line.charCodeAt(i) == ESC_CODE) {
      hadEscape = true;
      let j = i + 1;
      if (j < line.length && line.charAt(j) == "[") {
        j = j + 1;
        while (j < line.length && !isSgrTerminator(line.charAt(j))) {
          j = j + 1;
        }
        if (j < line.length) {
          j = j + 1;
        }
      }
      out = out + line.slice(i, j);
      i = j;
      continue;
    }

    if (visible >= width) {
      break;
    }
    out = out + line.charAt(i);
    visible = visible + 1;
    i = i + 1;
  }

  if (hadEscape) {
    out = out + String.fromCharCode(ESC_CODE) + "[0m";
  }
  return out;
}
