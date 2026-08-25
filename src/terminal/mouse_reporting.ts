import { ENTER_ALT_SCREEN, EXIT_ALT_SCREEN, HIDE_CURSOR, SHOW_CURSOR, ENABLE_MOUSE_REPORTING, DISABLE_MOUSE_REPORTING } from "../vendor/tty/tty.ts";
import { loadConfigFile, configFilePath, rememberMouse } from "../providers/config.ts";
import { envOr } from "../vendor/platform/platform.ts";

export const MOUSE_ENV: string = "JOULE_CODE_MOUSE";
export const MOUSE_ON: string = "on";
export const MOUSE_OFF: string = "off";

function isOnWord(word: string): bool {
  let text = word.trim().toLowerCase();
  return text == "on" || text == "1" || text == "true" || text == "yes";
}

export function mouseReportingOn(envValue: string, fileValue: string): bool {
  if (envValue.trim() != "") { return isOnWord(envValue); }
  if (fileValue.trim() != "") { return isOnWord(fileValue); }
  return false;
}

export function mouseSettingWord(on: bool): string {
  if (on) { return MOUSE_ON; }
  return MOUSE_OFF;
}

export function mouseStateText(on: bool): string {
  if (on) {
    return "\nmouse reporting on - the wheel scrolls, Shift+drag still selects text";
  }
  return "\nmouse reporting off - drag selects text as usual, PageUp/PageDown scroll";
}

export class MouseReporting {
  on: bool;

  constructor(on: bool) {
    this.on = on;
  }

  enterSequence(): string {
    if (this.on) { return ENTER_ALT_SCREEN + HIDE_CURSOR + ENABLE_MOUSE_REPORTING; }
    return ENTER_ALT_SCREEN + HIDE_CURSOR;
  }

  exitSequence(): string {
    if (this.on) { return DISABLE_MOUSE_REPORTING + SHOW_CURSOR + EXIT_ALT_SCREEN; }
    return SHOW_CURSOR + EXIT_ALT_SCREEN;
  }

  switchSequence(on: bool): string {
    if (on == this.on) { return ""; }
    this.on = on;
    if (on) { return ENABLE_MOUSE_REPORTING; }
    return DISABLE_MOUSE_REPORTING;
  }
}

export function configuredMouseReporting(): MouseReporting {
  let file = loadConfigFile(configFilePath());
  return new MouseReporting(mouseReportingOn(envOr(MOUSE_ENV, ""), file.mouse));
}

export function enterScreen(): MouseReporting {
  let mouse = configuredMouseReporting();
  process.stdout().write(mouse.enterSequence());
  return mouse;
}

export function leaveScreen(mouse: MouseReporting): void {
  process.stdout().write(mouse.exitSequence());
}

export function runMouseCommand(mouse: MouseReporting, arg: string): string {
  let word = arg.trim().toLowerCase();
  if (word == "") { return mouseStateText(mouse.on); }
  if (word != MOUSE_ON && word != MOUSE_OFF) { return "\nusage: /mouse or /mouse on|off"; }
  let want: bool = word == MOUSE_ON;
  process.stdout().write(mouse.switchSequence(want));
  rememberMouse(mouseSettingWord(want));
  return mouseStateText(want) + "\nsaved to " + configFilePath();
}
