import { browserCommand, platformNote, retryable } from "./login_ui.ts";
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

test("platformNote says signing in does not enable platform inference yet", () => {
  let note = platformNote();
  expect(note.indexOf("no model inference yet") >= 0);
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
