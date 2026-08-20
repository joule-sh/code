import { isatty, rawEnable, rawDisable, readKey, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF } from "./tty.ts";

const STDIN: int = 0;
const ESC: string = String.fromCharCode(27);
const ALT_ON: string = ESC + "[?1049h";
const ALT_OFF: string = ESC + "[?1049l";
const HIDE: string = ESC + "[?25l";
const SHOW: string = ESC + "[?25h";
const CLEAR: string = ESC + "[2J";
const VIOLET: string = ESC + "[38;2;139;92;246m";
const VIOLET_BG: string = ESC + "[48;2;139;92;246m";
const WHITE_FG: string = ESC + "[38;2;255;255;255m";
const RESET: string = ESC + "[0m";
const DIM: string = ESC + "[38;2;120;120;125m";
const BOLD: string = ESC + "[1m";

function at(row: int, col: int): string {
  return ESC + "[" + `${row}` + ";" + `${col}` + "H";
}

function clearLine(row: int): string {
  return at(row, 1) + ESC + "[2K";
}

const BODY_TOP: string = VIOLET_BG + "            " + RESET;
const BODY_BOTTOM: string = VIOLET_BG + "            " + RESET;
const EYE_OPEN: string = WHITE_FG + BOLD + "┃" + RESET;
const EYE_SHUT: string = WHITE_FG + BOLD + "─" + RESET;
const EYE_WIDE: string = WHITE_FG + BOLD + "┃┃" + RESET;

function face(left: string, right: string): string {
  return VIOLET_BG + "    " + RESET + left + VIOLET_BG + "  " + RESET + right + VIOLET_BG + "    " + RESET;
}

const FACE_OPEN: string = face(EYE_OPEN, EYE_OPEN);
const FACE_SHUT: string = face(EYE_SHUT, EYE_SHUT);
const FACE_LEFT: string = VIOLET_BG + "   " + RESET + EYE_WIDE + VIOLET_BG + "       " + RESET;
const FACE_RIGHT: string = VIOLET_BG + "       " + RESET + EYE_WIDE + VIOLET_BG + "   " + RESET;

const MASCOT_ROW: int = 1;
const STATE_ROW: int = 5;
const TRANSCRIPT_TOP: int = 7;
const TRANSCRIPT_BOTTOM: int = 20;
const INPUT_ROW: int = 22;
const HINT_ROW: int = 24;

function drawMascot(faceRow: string, label: string): void {
  console.log(at(MASCOT_ROW, 1) + BODY_TOP);
  console.log(at(MASCOT_ROW + 1, 1) + faceRow);
  console.log(at(MASCOT_ROW + 2, 1) + BODY_BOTTOM);
  console.log(clearLine(STATE_ROW) + VIOLET + BOLD + label + RESET);
}

let transcriptRow: int = TRANSCRIPT_TOP;

function resetTranscript(): void {
  let r = TRANSCRIPT_TOP;
  while (r <= TRANSCRIPT_BOTTOM) {
    console.log(clearLine(r));
    r = r + 1;
  }
  transcriptRow = TRANSCRIPT_TOP;
}

function say(tag: string, text: string): void {
  if (transcriptRow > TRANSCRIPT_BOTTOM) {
    resetTranscript();
  }
  console.log(clearLine(transcriptRow) + DIM + tag + RESET + "  " + text);
  transcriptRow = transcriptRow + 1;
}

function drawInput(buf: string): void {
  console.log(clearLine(INPUT_ROW) + VIOLET + "> " + RESET + buf);
}

function sleepMs(ms: int): void {
  process.sleep(ms);
}

function blink(faceRow: string, label: string): void {
  drawMascot(faceRow, label);
  sleepMs(260);
  drawMascot(FACE_SHUT, label);
  sleepMs(90);
  drawMascot(faceRow, label);
}

function runScript(userText: string): void {
  say("you", userText);
  sleepMs(400);

  blink(FACE_OPEN, "thinking");
  sleepMs(500);

  drawMascot(FACE_LEFT, "reading");
  say("tool.call", "read_file src/routes/index.ts");
  sleepMs(700);
  drawMascot(FACE_RIGHT, "reading");
  say("tool.call", "read_file src/routes/health.test.ts (not found)");
  sleepMs(700);

  blink(FACE_OPEN, "thinking");
  say("joule", "No health route yet. I'll add GET /health and a test for it.");
  sleepMs(600);

  drawMascot(FACE_LEFT, "writing");
  say("tool.call", "write_file src/routes/health.ts");
  sleepMs(650);
  drawMascot(FACE_RIGHT, "writing");
  say("tool.call", "write_file src/routes/health.test.ts");
  sleepMs(650);

  blink(FACE_OPEN, "waiting");
  say("approval", "run 'npm test' on your machine? (auto-approved in this demo)");
  sleepMs(600);

  drawMascot(FACE_LEFT, "running");
  sleepMs(220);
  drawMascot(FACE_RIGHT, "running");
  say("run", "npm test");
  sleepMs(750);

  blink(FACE_OPEN, "found it");
  say("result", "2 passed, 0 failed");
  sleepMs(400);

  say("joule", 'Done. Added GET /health (200, {"ok":true}) and a test for it. 2 files changed.');
  blink(FACE_OPEN, "found it");
  sleepMs(500);
  drawMascot(FACE_SHUT, "idle");
}

function teardown(): void {
  console.log(SHOW);
  console.log(ALT_OFF);
  rawDisable(STDIN);
}

export function runDemo(): void {
  if (!isatty(STDIN)) {
    console.log("joule --demo needs a real terminal (isatty(0) is false here).");
    return;
  }

  console.log(ALT_ON);
  console.log(CLEAR);
  console.log(HIDE);
  rawEnable(STDIN);

  drawMascot(FACE_SHUT, "idle");
  console.log(at(HINT_ROW, 1) + DIM + "type a request, enter to send, ctrl-c to quit" + RESET);
  drawInput("");

  let buf = "";
  let running = true;
  while (running) {
    let k = readKey(STDIN);
    if (k.kind == KEY_CTRL_C || k.kind == KEY_CTRL_D || k.kind == KEY_EOF) {
      running = false;
      continue;
    }
    if (k.kind == KEY_ENTER) {
      let text = buf;
      if (text == "") {
        text = "add a health endpoint and a test for it";
      }
      buf = "";
      drawInput(buf);
      runScript(text);
      drawInput(buf);
      continue;
    }
    if (k.kind == KEY_BACKSPACE) {
      if (buf.length > 0) {
        buf = buf.slice(0, buf.length - 1);
      }
      drawInput(buf);
      continue;
    }
    if (k.kind == KEY_CHAR) {
      buf = buf + k.char;
      drawInput(buf);
      continue;
    }
  }

  teardown();
}
