// /color (#338): a small fixed accent palette, the same shape as /mouse -
// show the current choice with no argument, set and persist it with one -
// rather than a picker, since unlike /model's provider-fetched list or
// /session's live daemon list, this list is five fixed names known at
// compile time; typing the name is not meaningfully slower than arrowing to
// it, and every other small enum-valued setting in this file's family
// (/mouse) already works this way.
import { ACCENT_PALETTE, DEFAULT_ACCENT_NAME, setAccentByName, wrap, ACCENT, BOLD, DIM } from "./style.ts";
import { loadConfigFile, configFilePath, rememberColor } from "../providers/config.ts";
import { envOr } from "../vendor/platform/platform.ts";

export const COLOR_ENV: string = "JOULE_CODE_COLOR";

function isKnownAccentName(name: string): bool {
  for (const opt of ACCENT_PALETTE) {
    if (opt.name == name) { return true; }
  }
  return false;
}

// The name to apply at startup: flag-less env var first (mirrors how the
// mouse setting reads JOULE_CODE_MOUSE), then the config file, then the
// built-in default - an unrecognised value from either falls back rather
// than refusing to start.
export function configuredAccentName(envValue: string, fileValue: string): string {
  if (isKnownAccentName(envValue.trim())) { return envValue.trim(); }
  if (isKnownAccentName(fileValue.trim())) { return fileValue.trim(); }
  return DEFAULT_ACCENT_NAME;
}

export function currentAccentName(): string {
  for (const opt of ACCENT_PALETTE) {
    if (opt.code == ACCENT) { return opt.name; }
  }
  return DEFAULT_ACCENT_NAME;
}

// Called once at startup in both entry points, the same moment mouse
// reporting and the scratch dir are set up - after this, every existing
// wrap(ACCENT, ...) call site across the terminal UI already picks it up,
// because style.ts's ACCENT export is a live-bound `let` (verified: a
// setter in one module is visible immediately through another module's own
// import of the same binding), not a value copied at import time.
export function applyConfiguredAccent(): void {
  let file = loadConfigFile(configFilePath());
  setAccentByName(configuredAccentName(envOr(COLOR_ENV, ""), file.color));
}

function paletteLine(): string {
  let out = "";
  let i = 0;
  while (i < ACCENT_PALETTE.length) {
    if (i > 0) { out = out + "  "; }
    let opt = ACCENT_PALETTE[i];
    if (opt.name == currentAccentName()) {
      out = out + wrap(BOLD, wrap(opt.code, opt.name)) + wrap(DIM, " (current)");
    } else {
      out = out + wrap(opt.code, opt.name);
    }
    i = i + 1;
  }
  return out;
}

export function colorStateText(): string {
  return "\naccent: " + paletteLine();
}

export function runColorCommand(arg: string): string {
  let name = arg.trim().toLowerCase();
  if (name == "") { return colorStateText(); }
  if (!isKnownAccentName(name)) {
    return "\nusage: /color or /color <name>, where <name> is one of: " + paletteLine();
  }
  setAccentByName(name);
  rememberColor(name);
  return colorStateText() + "\nsaved to " + configFilePath();
}

test("configuredAccentName prefers env over file, and falls back to the default for a bad or empty value", () => {
  expect(configuredAccentName("blue", "cyan") == "blue");
  expect(configuredAccentName("", "cyan") == "cyan");
  expect(configuredAccentName("not-a-colour", "") == DEFAULT_ACCENT_NAME);
  expect(configuredAccentName("", "") == DEFAULT_ACCENT_NAME);
});

test("runColorCommand with no argument shows the current accent without changing it", () => {
  setAccentByName("magenta");
  let text = runColorCommand("");
  expect(currentAccentName() == "magenta");
  expect(text.indexOf("magenta") >= 0);
});

test("runColorCommand with a valid name sets and reports it", () => {
  setAccentByName(DEFAULT_ACCENT_NAME);
  let text = runColorCommand("Blue");
  expect(currentAccentName() == "blue");
  expect(text.indexOf("saved to") >= 0);
});

test("runColorCommand with an unknown name refuses without changing the current accent", () => {
  setAccentByName("orange");
  let text = runColorCommand("chartreuse");
  expect(currentAccentName() == "orange");
  expect(text.indexOf("usage: /color") >= 0);
});
