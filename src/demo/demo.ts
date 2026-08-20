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
const WHITE_BG: string = ESC + "[48;2;255;255;255m";
const RESET: string = ESC + "[0m";
const DIM: string = ESC + "[38;2;120;120;125m";

function at(row: int, col: int): string {
  return ESC + "[" + `${row}` + ";" + `${col}` + "H";
}

function clearLine(row: int): string {
  return at(row, 1) + ESC + "[2K";
}

const ROW1: string = VIOLET_BG + "         " + RESET;
const VISOR_LEFT: string = VIOLET_BG + "  " + RESET + WHITE_BG + "   " + RESET + VIOLET_BG + "    " + RESET;
const VISOR_MID: string = VIOLET_BG + "   " + RESET + WHITE_BG + "   " + RESET + VIOLET_BG + "   " + RESET;
const VISOR_RIGHT: string = VIOLET_BG + "    " + RESET + WHITE_BG + "   " + RESET + VIOLET_BG + "  " + RESET;
const VISOR_DIM: string = VIOLET_BG + "   " + RESET + VIOLET_BG + "   " + RESET + VIOLET_BG + "   " + RESET;

const MASCOT_ROW: int = 1;
const STATE_ROW: int = 4;
const TRANSCRIPT_TOP: int = 6;
const TRANSCRIPT_BOTTOM: int = 19;
const INPUT_ROW: int = 21;
const HINT_ROW: int = 23;

function drawMascot(row2: string, label: string): void {
  console.log(at(MASCOT_ROW, 1) + ROW1);
  console.log(at(MASCOT_ROW + 1, 1) + row2);
  console.log(clearLine(STATE_ROW) + VIOLET + label + RESET);
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

function runScript(userText: string): void {
  say("you", userText);
  sleepMs(300);

  drawMascot(VISOR_DIM, "thinking");
  sleepMs(500);

  drawMascot(VISOR_LEFT, "reading");
  say("tool.call", "read_file src/routes/index.ts");
  sleepMs(400);
  drawMascot(VISOR_RIGHT, "reading");
  say("tool.call", "read_file src/routes/health.test.ts (not found)");
  sleepMs(400);

  drawMascot(VISOR_DIM, "thinking");
  say("joule", "No health route yet. I'll add GET /health and a test for it.");
  sleepMs(400);

  drawMascot(VISOR_LEFT, "writing");
  say("tool.call", "write_file src/routes/health.ts");
  sleepMs(400);
  drawMascot(VISOR_RIGHT, "writing");
  say("tool.call", "write_file src/routes/health.test.ts");
  sleepMs(400);

  drawMascot(VISOR_DIM, "waiting");
  say("approval", "run 'npm test' on your machine? (auto-approved in this demo)");
  sleepMs(400);

  drawMascot(VISOR_MID, "running");
  say("run", "npm test");
  sleepMs(650);

  drawMascot(VISOR_LEFT, "found it");
  say("result", "2 passed, 0 failed");
  sleepMs(300);

  say("joule", 'Done. Added GET /health (200, {"ok":true}) and a test for it. 2 files changed.');
  drawMascot(VISOR_RIGHT, "found it");
  sleepMs(400);
  drawMascot(VISOR_DIM, "idle");
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

  drawMascot(VISOR_DIM, "idle");
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
