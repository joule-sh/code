import { Scrollback } from "./scrollback.ts";
import { InputLine } from "./input_state.ts";
import { CODE_MARKER } from "./prompt_rows.ts";
import { styleBanner, wrap, DIM, GREEN, VIOLET } from "./style.ts";
import { shellQuoteSingle } from "../tools/shell_quote.ts";
import { checkServer, insecureAllowed, normalizeServer, serverPinned, serverSourceLabel, ServerOrigin, SERVER_OK, INSECURE_ENV, DEFAULT_SERVER, SERVER_FROM_DEFAULT } from "../auth/server.ts";
import { loginUrl, exchangeCode, normalizeCode, CODE_LENGTH, EX_OK, EX_BAD_CODE, EX_UNKNOWN } from "../auth/exchange.ts";
import { credentialsPath, loadCredential, saveCredential, forgetCredential, accountLabel, otherServers } from "../auth/credentials.ts";
import { rememberServer, configFilePath } from "../providers/config.ts";
import { envOr } from "../vendor/platform/platform.ts";

const MAX_ATTEMPTS: int = 3;
const LIST_LIMIT: int = 3;

export function browserCommand(url: string): string {
  let quoted = shellQuoteSingle(url);
  return "if [ -n \"$BROWSER\" ]; then \"$BROWSER\" " + quoted + " </dev/null >/dev/null 2>&1 & exit 0; fi; "
    + "for opener in xdg-open open; do "
    + "if command -v \"$opener\" >/dev/null 2>&1; then \"$opener\" " + quoted + " </dev/null >/dev/null 2>&1 & exit 0; fi; "
    + "done; exit 1";
}

export function openBrowser(url: string): bool {
  let args: string[] = ["-c", browserCommand(url)];
  let r = child_process.spawnSync("/bin/sh", args);
  return r.status == 0;
}

export function platformNote(): string {
  return "signing in records the account. Joule exposes no model inference yet, so turns keep using "
    + "the provider settings joule already has.";
}

export function retryable(outcome: string): bool {
  return outcome == EX_BAD_CODE || outcome == EX_UNKNOWN;
}

export function loginTarget(origin: ServerOrigin, requested: string): string {
  if (requested.trim() != "") { return requested.trim(); }
  return origin.base;
}

export function serverListNote(lead: string, servers: string[]): string {
  if (servers.length == 0) { return ""; }
  let shown = "";
  let i = 0;
  while (i < servers.length && i < LIST_LIMIT) {
    if (i > 0) { shown = shown + ", "; }
    shown = shown + servers[i];
    i = i + 1;
  }
  if (servers.length > LIST_LIMIT) {
    shown = shown + " and " + `${servers.length - LIST_LIMIT}` + " more";
  }
  return "\n" + wrap(DIM, lead + " " + shown);
}

export function serverHint(origin: ServerOrigin, requested: string): string {
  if (serverPinned(origin.source)) {
    return "\n" + wrap(DIM, "this address comes from " + serverSourceLabel(origin.source)
      + ", which outranks anything /login is told, so it stays the one joule uses.");
  }
  return "";
}

export function waitingLines(origin: ServerOrigin): string {
  let out = "\n" + wrap(DIM, "waiting for the code. Type it below.");
  if (serverPinned(origin.source)) { return out; }
  return out + "\n" + wrap(DIM, "another server? type its address instead.");
}

export function looksLikeServer(text: string): bool {
  let t = text.trim();
  if (t == "") { return false; }
  if (t.indexOf(" ") >= 0) { return false; }
  if (normalizeCode(t) != "") { return false; }
  if (t.indexOf("://") >= 0) { return true; }
  return t.indexOf(".") >= 0 || t.indexOf(":") >= 0;
}

export function typedServerAddress(text: string): string {
  let t = text.trim();
  if (t.indexOf("://") >= 0) { return t; }
  return "https://" + t;
}

export function chosenServerNote(origin: ServerOrigin, base: string): string {
  if (serverPinned(origin.source)) {
    return "\n" + wrap(DIM, "the credential is kept for " + base + ", but joule still talks to "
      + origin.base + " here, because " + serverSourceLabel(origin.source) + " sets it.");
  }
  return "\n" + wrap(DIM, "joule now uses " + base + ", written to " + configFilePath()
    + ". /login " + DEFAULT_SERVER + " goes back.");
}

function keepServer(sb: Scrollback, origin: ServerOrigin, base: string): void {
  if (base == origin.base) { return; }
  if (!serverPinned(origin.source)) { rememberServer(base); }
  sb.append(chosenServerNote(origin, base));
}

function introduce(sb: Scrollback, base: string, url: string, origin: ServerOrigin, requested: string): void {
  let existing = loadCredential(base);
  if (existing.secret != "") {
    sb.append("\n" + wrap(DIM, "already signed in to " + base + " as " + accountLabel(existing)
      + ". Signing in again replaces that credential."));
  }
  sb.append("\n" + styleBanner("sign in to " + base));
  let hint = serverHint(origin, requested);
  if (hint != "") { sb.append(hint); }
  let known = serverListNote("also signed in to", otherServers(base));
  if (known != "") { sb.append(known); }
  let lead = "open ";
  if (existing.secret == "") { lead = "first time here. Open "; }
  sb.append("\n" + lead + wrap(VIOLET, url) + " and enter the " + `${CODE_LENGTH}` + "-character code it shows you.");
  if (!openBrowser(url)) {
    sb.append("\n" + wrap(DIM, "no browser opened from here, so copy that address into one yourself."));
  }
  sb.append(waitingLines(origin));
}

function announce(sb: Scrollback, base: string, email: string, scopes: string): void {
  sb.append("\n" + wrap(GREEN, "signed in to " + base + " as " + email));
  sb.append("\n" + wrap(DIM, "it lasts until you sign out with /logout on this machine."));
  sb.append("\n" + wrap(DIM, "credential stored per server in " + credentialsPath() + ", readable only by you."));
  if (scopes != "") {
    sb.append("\n" + wrap(DIM, "it can use: " + scopes));
  }
  sb.append("\n" + wrap(DIM, platformNote()));
}

export class SignIn {
  active: bool;
  base: string;
  attempts: int;
  origin: ServerOrigin;

  constructor() {
    this.active = false;
    this.base = "";
    this.attempts = 0;
    this.origin = { base: DEFAULT_SERVER, source: SERVER_FROM_DEFAULT };
  }

  isActive(): bool {
    return this.active;
  }
}

function openSignIn(sb: Scrollback, input: InputLine, signin: SignIn, base: string, requested: string): void {
  signin.base = base;
  signin.active = true;
  signin.attempts = 0;
  introduce(sb, base, loginUrl(base), signin.origin, requested);
  input.captureWith(CODE_MARKER);
}

function endSignIn(input: InputLine, signin: SignIn): void {
  signin.active = false;
  signin.base = "";
  signin.attempts = 0;
  input.release();
}

export function beginSignIn(sb: Scrollback, input: InputLine, signin: SignIn, origin: ServerOrigin, requested: string): void {
  let check = checkServer(loginTarget(origin, requested), insecureAllowed(envOr(INSECURE_ENV, "")));
  if (check.status != SERVER_OK) {
    sb.append("\n" + check.message);
    return;
  }
  signin.origin = origin;
  openSignIn(sb, input, signin, check.base, requested);
}

export function cancelSignIn(sb: Scrollback, input: InputLine, signin: SignIn): void {
  if (!signin.active) { return; }
  endSignIn(input, signin);
  sb.append("\nsign-in stopped. Nothing was saved.");
}

function switchSignInServer(sb: Scrollback, input: InputLine, signin: SignIn, typed: string): void {
  let check = checkServer(typedServerAddress(typed), insecureAllowed(envOr(INSECURE_ENV, "")));
  if (check.status != SERVER_OK) {
    sb.append("\n" + check.message);
    sb.append(waitingLines(signin.origin));
    return;
  }
  openSignIn(sb, input, signin, check.base, check.base);
}

export function submitSignIn(sb: Scrollback, input: InputLine, signin: SignIn, typed: string): void {
  if (!signin.active) { return; }
  if (looksLikeServer(typed)) {
    switchSignInServer(sb, input, signin, typed);
    return;
  }
  let base = signin.base;
  let origin = signin.origin;
  signin.attempts = signin.attempts + 1;
  let outcome = exchangeCode(base, typed, Date.now());
  if (outcome.outcome == EX_OK) {
    saveCredential(outcome.credential);
    endSignIn(input, signin);
    announce(sb, base, accountLabel(outcome.credential), outcome.credential.scopes);
    keepServer(sb, origin, base);
    return;
  }
  sb.append("\n" + outcome.message);
  if (!retryable(outcome.outcome)) {
    endSignIn(input, signin);
    return;
  }
  if (signin.attempts >= MAX_ATTEMPTS) {
    sb.append("\nthat is " + `${MAX_ATTEMPTS}` + " tries. Run /login again for a fresh code.");
    endSignIn(input, signin);
    return;
  }
  sb.append("\n" + wrap(DIM, "type it again, or ctrl-c to stop."));
}

export function logoutText(server: string, requested: string): string {
  let base = normalizeServer(server);
  if (requested.trim() != "") { base = normalizeServer(requested); }
  let existing = loadCredential(base);
  if (existing.secret == "") {
    return "\nnot signed in to " + base + serverListNote("signed in to", otherServers(base));
  }
  forgetCredential(base);
  return "\nsigned out of " + base + ", the stored credential is gone from this machine."
    + "\n" + wrap(DIM, "the key itself still exists on the account. Revoke it at " + base + "/platform")
    + serverListNote("still signed in to", otherServers(base));
}
