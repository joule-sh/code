import { readKey, cols, rows, cursorTo, CLEAR_LINE, KEY_CHAR, KEY_ENTER, KEY_BACKSPACE, KEY_CTRL_C, KEY_CTRL_D, KEY_EOF } from "../vendor/tty/tty.ts";
import { Scrollback } from "./scrollback.ts";
import { InputLine, clip } from "./input_state.ts";
import { TurnStatusTracker, drawScreen } from "./screen.ts";
import { stylePrompt, styleBanner, wrap, DIM } from "./style.ts";
import { shellQuoteSingle } from "../tools/shell_quote.ts";
import { checkServer, insecureAllowed, normalizeServer, SERVER_OK, INSECURE_ENV } from "../auth/server.ts";
import { loginUrl, exchangeCode, CODE_LENGTH, EX_OK, EX_BAD_CODE, EX_UNKNOWN } from "../auth/exchange.ts";
import { credentialsPath, loadCredential, saveCredential, forgetCredential, accountLabel } from "../auth/credentials.ts";

const STDIN: int = 0;
const MAX_ATTEMPTS: int = 3;

export function browserCommand(url: string): string {
  let quoted = shellQuoteSingle(url);
  return "if [ -n \"$BROWSER\" ]; then \"$BROWSER\" " + quoted + " >/dev/null 2>&1 & exit 0; fi; "
    + "for opener in xdg-open open; do "
    + "if command -v \"$opener\" >/dev/null 2>&1; then \"$opener\" " + quoted + " >/dev/null 2>&1 & exit 0; fi; "
    + "done; exit 1";
}

export function openBrowser(url: string): bool {
  let args: string[] = ["-c", browserCommand(url)];
  let r = child_process.spawnSync("/bin/sh", args);
  return r.status == 0;
}

function promptRow(): int {
  let r = rows(STDIN);
  if (r <= 1) { r = 24; }
  return r;
}

function promptWidth(): int {
  let c = cols(STDIN);
  if (c <= 0) { c = 80; }
  return c;
}

function drawCodePrompt(buf: string): void {
  let line = stylePrompt("code> ") + buf;
  process.stdout().write(cursorTo(promptRow(), 1) + CLEAR_LINE + clip(line, promptWidth()));
}

export function readCodeFromTerminal(): string {
  let buf = "";
  drawCodePrompt(buf);
  while (true) {
    let k = readKey(STDIN);
    if (k.kind == KEY_CTRL_C || k.kind == KEY_CTRL_D || k.kind == KEY_EOF) { return ""; }
    if (k.kind == KEY_ENTER) { return buf; }
    if (k.kind == KEY_BACKSPACE) {
      if (buf.length > 0) { buf = buf.slice(0, buf.length - 1); }
      drawCodePrompt(buf);
      continue;
    }
    if (k.kind == KEY_CHAR) {
      buf = buf + k.char;
      drawCodePrompt(buf);
      continue;
    }
  }
  return "";
}

export function platformNote(): string {
  return "signing in records the account. Joule exposes no model inference yet, so turns keep using "
    + "the provider settings joule already has.";
}

export function retryable(outcome: string): bool {
  return outcome == EX_BAD_CODE || outcome == EX_UNKNOWN;
}

function introduce(sb: Scrollback, base: string, url: string): void {
  let existing = loadCredential(base);
  if (existing.secret != "") {
    sb.append("\n" + wrap(DIM, "already signed in to " + base + " as " + accountLabel(existing)
      + ". Signing in again replaces that credential."));
  }
  sb.append("\n" + styleBanner("sign in to " + base));
  sb.append("\nopen this page, sign in, and it will show you a " + `${CODE_LENGTH}` + "-character code:");
  sb.append("\n  " + url);
  if (!openBrowser(url)) {
    sb.append("\n" + wrap(DIM, "no browser could be opened from here, so copy the address into one yourself."));
  }
  sb.append("\n" + wrap(DIM, "type the code below and press enter, or ctrl-c to stop."));
}

function announce(sb: Scrollback, base: string, email: string, scopes: string): void {
  sb.append("\nsigned in to " + base + " as " + email);
  sb.append("\n" + wrap(DIM, "credential stored per server in " + credentialsPath() + ", readable only by you."));
  if (scopes != "") {
    sb.append("\n" + wrap(DIM, "it can use: " + scopes));
  }
  sb.append("\n" + wrap(DIM, platformNote()));
}

export function runLogin(sb: Scrollback, input: InputLine, mode: string, rk: TurnStatusTracker, server: string): void {
  let check = checkServer(server, insecureAllowed(process.env(INSECURE_ENV) ?? ""));
  if (check.status != SERVER_OK) {
    sb.append("\n" + check.message);
    return;
  }
  let base = check.base;
  introduce(sb, base, loginUrl(base));
  drawScreen(sb, input, mode, rk);

  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    attempt = attempt + 1;
    let typed = readCodeFromTerminal();
    if (typed.trim() == "") {
      sb.append("\nsign-in stopped. Nothing was saved.");
      return;
    }
    let outcome = exchangeCode(base, typed, Date.now());
    if (outcome.outcome == EX_OK) {
      saveCredential(outcome.credential);
      announce(sb, base, accountLabel(outcome.credential), outcome.credential.scopes);
      return;
    }
    sb.append("\n" + outcome.message);
    if (!retryable(outcome.outcome)) { return; }
    if (attempt < MAX_ATTEMPTS) {
      sb.append("\n" + wrap(DIM, "type it again, or ctrl-c to stop."));
      drawScreen(sb, input, mode, rk);
    }
  }
  sb.append("\nthat is " + `${MAX_ATTEMPTS}` + " tries. Run /login again for a fresh code.");
}

export function logoutText(server: string): string {
  let base = normalizeServer(server);
  let existing = loadCredential(base);
  if (existing.secret == "") {
    return "\nnot signed in to " + base;
  }
  forgetCredential(base);
  return "\nsigned out of " + base + ", the stored credential is gone from this machine."
    + "\n" + wrap(DIM, "the key itself still exists on the account. Revoke it at " + base + "/platform");
}
