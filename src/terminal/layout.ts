import { VIOLET, DIM, wrap } from "./style.ts";
import { VERSION } from "../version.ts";

const BOX_WIDTH: int = 54;
const CONTENT_WIDTH: int = BOX_WIDTH - 2;
const LABEL_WIDTH: int = 10;

function repeatChar(ch: string, n: int): string {
  let out = "";
  let i = 0;
  while (i < n) {
    out = out + ch;
    i = i + 1;
  }
  return out;
}

function padTo(text: string, width: int): string {
  let t = text;
  if (t.length > width) {
    if (width > 3) {
      t = t.slice(0, width - 3) + "...";
    } else {
      t = t.slice(0, width);
    }
  }
  return t + repeatChar(" ", width - t.length);
}

function field(label: string, value: string): string {
  return " " + padTo(label, LABEL_WIDTH) + padTo(value, CONTENT_WIDTH - LABEL_WIDTH - 1);
}

function borderLine(left: string, right: string): string {
  return left + repeatChar("─", BOX_WIDTH - 2) + right;
}

function contentLine(text: string): string {
  return "│" + padTo(text, CONTENT_WIDTH) + "│";
}

export function buildWelcomeBox(model: string, workspace: string, mode: string): string {
  let out = wrap(VIOLET, borderLine("┌", "┐"));
  out = out + "\n" + wrap(VIOLET, contentLine(" joule " + VERSION));
  out = out + "\n" + wrap(VIOLET, contentLine(""));
  out = out + "\n" + wrap(VIOLET, contentLine(field("model", model)));
  out = out + "\n" + wrap(VIOLET, contentLine(field("workspace", workspace)));
  out = out + "\n" + wrap(VIOLET, contentLine(field("mode", mode)));
  out = out + "\n" + wrap(VIOLET, contentLine(""));
  out = out + "\n" + wrap(VIOLET, contentLine(" agentic coding, on your machine"));
  out = out + "\n" + wrap(VIOLET, borderLine("└", "┘"));
  return out;
}

export function buildStatusLine(mode: string): string {
  return wrap(DIM, "mode: " + mode + "   /help for commands   PageUp/PageDown to scroll");
}
