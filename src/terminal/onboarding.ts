import { rawEnable, rawDisable, readKey, CLEAR_LINE, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF } from "../vendor/tty/tty.ts";
import { ConfigFile, saveConfigFile, loadConfigFile, configFilePath } from "../providers/config.ts";
import { platformOf } from "../providers/platform.ts";
import { InputLine } from "./input_state.ts";
import { VIOLET, BOLD, DIM, wrap } from "./style.ts";

const STDIN: int = 0;

export const PROVIDER_OPENAI: string = "1";
export const PROVIDER_DEEPSEEK: string = "2";
export const PROVIDER_CUSTOM: string = "3";

export function providerBaseUrl(choice: string): string {
  if (choice == PROVIDER_OPENAI) { return "https://api.openai.com/v1"; }
  if (choice == PROVIDER_DEEPSEEK) { return "https://api.deepseek.com"; }
  return "";
}

export function providerLabel(choice: string): string {
  let platform = platformOf(providerBaseUrl(choice));
  if (platform == "") { return "custom"; }
  return platform;
}

function write(text: string): void {
  process.stdout().write(text);
}

function writeLine(text: string): void {
  write(text + "\r\n");
}

function abort(): void {
  rawDisable(STDIN);
  write("\r\n" + wrap(DIM, "setup cancelled, nothing saved") + "\r\n");
  process.exit(1);
}

function maskedBuf(buf: string): string {
  let out = "";
  let i = 0;
  while (i < buf.length) {
    out = out + "*";
    i = i + 1;
  }
  return out;
}

function redrawField(label: string, buf: string, mask: bool): void {
  let shown = buf;
  if (mask) { shown = maskedBuf(buf); }
  write("\r" + CLEAR_LINE + wrap(DIM, label + ": ") + shown);
}

function readRequiredField(label: string, prefill: string, mask: bool): string {
  while (true) {
    let input = new InputLine();
    input.setBuf(prefill);
    redrawField(label, input.buf, mask);

    let submitted = "";
    let haveValue = false;
    while (!haveValue) {
      let k = readKey(STDIN);
      if (k.kind == KEY_CTRL_C || k.kind == KEY_CTRL_D || k.kind == KEY_EOF) {
        abort();
      }
      if (k.kind == KEY_ENTER) {
        write("\r\n");
        submitted = input.buf;
        haveValue = true;
        continue;
      }
      if (k.kind == KEY_BACKSPACE) {
        input.backspace();
        redrawField(label, input.buf, mask);
        continue;
      }
      if (k.kind == KEY_CHAR) {
        input.push(k.char);
        redrawField(label, input.buf, mask);
        continue;
      }
    }

    if (submitted.trim() != "") {
      return submitted;
    }
    writeLine(wrap(DIM, label + " is required"));
  }
  return "";
}

function readProviderChoice(): string {
  writeLine(wrap(BOLD + VIOLET, "provider"));
  writeLine("  1) openai");
  writeLine("  2) deepseek");
  writeLine("  3) custom");
  write(wrap(DIM, "choice: "));
  while (true) {
    let k = readKey(STDIN);
    if (k.kind == KEY_CTRL_C || k.kind == KEY_CTRL_D || k.kind == KEY_EOF) {
      abort();
    }
    if (k.kind == KEY_CHAR) {
      if (k.char == "1") { writeLine("1"); return PROVIDER_OPENAI; }
      if (k.char == "2") { writeLine("2"); return PROVIDER_DEEPSEEK; }
      if (k.char == "3") { writeLine("3"); return PROVIDER_CUSTOM; }
    }
  }
  return PROVIDER_CUSTOM;
}

export function runOnboarding(): ConfigFile {
  rawEnable(STDIN);

  writeLine(wrap(BOLD + VIOLET, "joule needs a model provider"));
  writeLine(wrap(DIM, "pick one below, or go custom and type your own"));
  write("\r\n");

  let choice = readProviderChoice();
  write("\r\n");

  let baseUrl = readRequiredField("base url", providerBaseUrl(choice), false);
  let model = readRequiredField("model", "", false);
  let apiKey = readRequiredField("api key", "", true);

  let existing = loadConfigFile(configFilePath());
  let file: ConfigFile = { baseUrl: baseUrl, model: model, apiKey: apiKey, server: existing.server, updateCheck: existing.updateCheck, mouse: existing.mouse };
  saveConfigFile(configFilePath(), file);

  write("\r\n" + wrap(DIM, "saved to ~/.config/joule-code/config.json") + "\r\n\r\n");
  rawDisable(STDIN);
  return file;
}
