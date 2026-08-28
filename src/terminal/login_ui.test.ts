import { browserCommand, platformNote, retryable, loginTarget, serverHint, waitingLines, looksLikeServer, typedServerAddress, chosenServerNote, serverListNote } from "./login_ui.ts";
import { checkServer, ServerOrigin, SERVER_OK, SERVER_INSECURE, SERVER_ENV, INSECURE_ENV, DEFAULT_SERVER, SERVER_FROM_FLAG, SERVER_FROM_ENV, SERVER_FROM_DEFAULT } from "../auth/server.ts";
import { configFilePath } from "../providers/config.ts";
import { shellQuoteSingle } from "../tools/shell_quote.ts";
import { EX_OK, EX_BAD_CODE, EX_UNKNOWN, EX_EXPIRED, EX_USED, EX_THROTTLED, EX_REFUSED, EX_UNREACHABLE, EX_NOT_JOULE, EX_NO_ACCOUNTS, EX_SERVER_ERROR, EX_REVOKED } from "../auth/exchange.ts";

test("browserCommand tries $BROWSER first, then falls back to xdg-open or open", () => {
  let script = browserCommand("https://joule.sh/terminal/login");
  expect(script.indexOf("$BROWSER") >= 0);
  expect(script.indexOf("xdg-open") >= 0);
  expect(script.indexOf("open") >= 0);
});

test("browserCommand passes the exact URL through single-quoted, so a shell metacharacter cannot break out", () => {
  let url = "https://joule.sh/terminal/login?x=a&b=c";
  let script = browserCommand(url);
  expect(script.indexOf(shellQuoteSingle(url)) >= 0);
});

test("platformNote says signing in offers the platform's search tools, and that turns are unaffected", () => {
  let note = platformNote();
  expect(note.indexOf("web_search") >= 0);
  expect(note.indexOf("web_retrieve") >= 0);
  expect(note.indexOf("does not change what runs a turn") >= 0);
});

test("retryable lets a mistyped or unrecognized code be tried again", () => {
  expect(retryable(EX_BAD_CODE));
  expect(retryable(EX_UNKNOWN));
});

test("retryable does not offer another attempt for outcomes a retry cannot fix", () => {
  expect(!retryable(EX_OK));
  expect(!retryable(EX_EXPIRED));
  expect(!retryable(EX_USED));
  expect(!retryable(EX_THROTTLED));
  expect(!retryable(EX_REFUSED));
  expect(!retryable(EX_UNREACHABLE));
  expect(!retryable(EX_NOT_JOULE));
  expect(!retryable(EX_NO_ACCOUNTS));
  expect(!retryable(EX_SERVER_ERROR));
  expect(!retryable(EX_REVOKED));
});

function originOf(base: string, source: string): ServerOrigin {
  let o: ServerOrigin = { base: base, source: source };
  return o;
}

test("loginTarget signs in to the resolved server when /login is given nothing", () => {
  let o = originOf("https://joule.sh", SERVER_FROM_DEFAULT);
  expect(loginTarget(o, "") == "https://joule.sh");
  expect(loginTarget(o, "   ") == "https://joule.sh");
});

test("loginTarget takes the address typed after /login, trimmed", () => {
  let o = originOf("https://joule.sh", SERVER_FROM_DEFAULT);
  expect(loginTarget(o, "  https://joule.internal  ") == "https://joule.internal");
});

test("an address typed after /login goes through the same check as any other, so public plain http is still refused", () => {
  let o = originOf("https://joule.sh", SERVER_FROM_DEFAULT);
  let refused = checkServer(loginTarget(o, "http://joule.example.com"), false);
  expect(refused.status == SERVER_INSECURE);
  expect(refused.message.indexOf("refusing to sign in") >= 0);
  expect(refused.message.indexOf(INSECURE_ENV) >= 0);
});

test("a private or loopback http address typed after /login is accepted without any extra step", () => {
  let o = originOf("https://joule.sh", SERVER_FROM_DEFAULT);
  expect(checkServer(loginTarget(o, "http://localhost:8080"), false).status == SERVER_OK);
  expect(checkServer(loginTarget(o, "http://192.168.1.9"), false).status == SERVER_OK);
  expect(checkServer(loginTarget(o, "http://box.internal"), false).status == SERVER_OK);
});

test("the default sign-in offers the other server at the prompt that is already taking input", () => {
  let lines = waitingLines(originOf("https://joule.sh", SERVER_FROM_DEFAULT));
  expect(lines.indexOf("waiting for the code") >= 0);
  expect(lines.indexOf("another server? type its address instead.") >= 0);
});

test("the offer is not a step: there is no option list and no key to press before the code", () => {
  let lines = waitingLines(originOf("https://joule.sh", SERVER_FROM_DEFAULT));
  expect(lines.indexOf("press") < 0);
  expect(lines.indexOf("1.") < 0);
  expect(lines.indexOf("2.") < 0);
  expect(lines.indexOf("[y/n]") < 0);
});

test("a pinned server is told, and offered nothing it would then override", () => {
  let env = serverHint(originOf("https://joule.sh", SERVER_FROM_ENV), "");
  expect(env.indexOf(SERVER_ENV) >= 0);
  let pinnedWait = waitingLines(originOf("https://joule.sh", SERVER_FROM_ENV));
  expect(pinnedWait.indexOf("another server?") < 0);
  let flag = serverHint(originOf("https://joule.sh", SERVER_FROM_FLAG), "https://joule.internal");
  expect(flag.indexOf("--server") >= 0);
});

test("an unpinned sign-in states no pin, because there is none to state", () => {
  expect(serverHint(originOf("https://joule.sh", SERVER_FROM_DEFAULT), "") == "");
});

test("a sign-in code is never mistaken for a server address", () => {
  expect(!looksLikeServer("ABC234"));
  expect(!looksLikeServer("abc234"));
  expect(!looksLikeServer("ABC-234"));
  expect(!looksLikeServer(" ABC234 "));
});

test("an address typed at the code prompt is recognized as one, with or without a scheme", () => {
  expect(looksLikeServer("https://joule.internal"));
  expect(looksLikeServer("joule.internal"));
  expect(looksLikeServer("http://127.0.0.1:8080"));
  expect(looksLikeServer("localhost:8080"));
});

test("neither an empty entry nor a sentence is treated as a server address", () => {
  expect(!looksLikeServer(""));
  expect(!looksLikeServer("   "));
  expect(!looksLikeServer("what is this. a server?"));
});

test("an address typed without a scheme becomes https, so switching can never quietly downgrade", () => {
  expect(typedServerAddress("joule.internal") == "https://joule.internal");
  expect(typedServerAddress("  joule.internal  ") == "https://joule.internal");
  expect(typedServerAddress("http://127.0.0.1:8080") == "http://127.0.0.1:8080");
});

test("a server chosen at the code prompt meets the same check, so plain http policy is untouched", () => {
  let refused = checkServer(typedServerAddress("http://joule.example.com"), false);
  expect(refused.status == SERVER_INSECURE);
  expect(refused.message.indexOf(INSECURE_ENV) >= 0);
  expect(checkServer(typedServerAddress("http://127.0.0.1:8080"), false).status == SERVER_OK);
  expect(checkServer(typedServerAddress("box.internal"), false).status == SERVER_OK);
});

test("the browser is opened with the terminal's own input shut off, so nothing else can read the keys", () => {
  let script = browserCommand("https://joule.sh/terminal/login");
  expect(script.indexOf("</dev/null") >= 0);
});

test("choosing a server says it is now the one joule uses, and where that is written", () => {
  let note = chosenServerNote(originOf("https://joule.sh", SERVER_FROM_DEFAULT), "https://joule.internal");
  expect(note.indexOf("joule now uses https://joule.internal") >= 0);
  expect(note.indexOf(configFilePath()) >= 0);
  expect(note.indexOf(DEFAULT_SERVER) >= 0);
});

test("signing in while a flag or env var pins the server still writes the server the daemon reads", () => {
  let note = chosenServerNote(originOf("https://joule.sh", SERVER_FROM_ENV), "https://joule.internal");
  expect(note.indexOf("https://joule.internal is now the server on disk") >= 0);
  expect(note.indexOf("daemon") >= 0);
  expect(note.indexOf(SERVER_ENV) >= 0);
  expect(note.indexOf("joule now uses") < 0);
});

test("serverListNote says nothing when no other server holds a credential", () => {
  let none: string[] = [];
  expect(serverListNote("also signed in to", none) == "");
});

test("serverListNote lists the servers it was given, folding a long tail into a count", () => {
  let two: string[] = ["https://a.example", "https://b.example"];
  expect(serverListNote("also signed in to", two).indexOf("also signed in to https://a.example, https://b.example") >= 0);
  let many: string[] = ["https://a.example", "https://b.example", "https://c.example", "https://d.example", "https://e.example"];
  let line = serverListNote("still signed in to", many);
  expect(line.indexOf("https://c.example and 2 more") >= 0);
  expect(line.indexOf("https://d.example") < 0);
});
