export class Scrollback {
  lines: string[];

  constructor() {
    this.lines = [""];
  }

  append(text: string): void {
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
  }

  clear(): void {
    this.lines = [""];
  }

  tail(n: int): string[] {
    let start = this.lines.length - n;
    if (start < 0) {
      start = 0;
    }
    let out: string[] = [];
    let i = start;
    while (i < this.lines.length) {
      out.push(this.lines[i]);
      i = i + 1;
    }
    return out;
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
