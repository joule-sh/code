import { normalizeCode, parseExchange, requestJson, loginUrl, exchangeUrl, CODE_ALPHABET, CODE_LENGTH, LOGIN_PATH, EXCHANGE_PATH, EX_OK, EX_BAD_CODE, EX_UNKNOWN, EX_EXPIRED, EX_USED, EX_THROTTLED, EX_REFUSED, EX_UNREACHABLE, EX_NOT_JOULE, EX_NO_ACCOUNTS, EX_SERVER_ERROR, EX_REVOKED } from "./exchange.ts";

test("normalizeCode uppercases and accepts a clean six-character code", () => {
  expect(normalizeCode("abc234") == "ABC234");
});

test("normalizeCode strips spaces, dashes and tabs a person typed in", () => {
  expect(normalizeCode("AB-C2 34") == "ABC234");
  expect(normalizeCode("AB\tC2\t34") == "ABC234");
  expect(normalizeCode("  ABC234  ") == "ABC234");
});

test("normalizeCode rejects a code that is the wrong length once cleaned", () => {
  expect(normalizeCode("ABC23") == "");
  expect(normalizeCode("ABC2345") == "");
  expect(normalizeCode("") == "");
});

test("normalizeCode rejects the ambiguous characters the alphabet omits", () => {
  expect(normalizeCode("ABCDEI") == "");
  expect(normalizeCode("ABCDEL") == "");
  expect(normalizeCode("ABCDEO") == "");
  expect(normalizeCode("ABCDE0") == "");
  expect(normalizeCode("ABCDE1") == "");
});

test("the pairing alphabet omits I, L, O, 0 and 1 and is six characters long", () => {
  expect(CODE_ALPHABET.indexOf("I") < 0);
  expect(CODE_ALPHABET.indexOf("L") < 0);
  expect(CODE_ALPHABET.indexOf("O") < 0);
  expect(CODE_ALPHABET.indexOf("0") < 0);
  expect(CODE_ALPHABET.indexOf("1") < 0);
  expect(CODE_LENGTH == 6);
});

test("loginUrl and exchangeUrl join a normalized base with the fixed paths", () => {
  expect(loginUrl("https://joule.sh/") == "https://joule.sh" + LOGIN_PATH);
  expect(exchangeUrl("http://100.89.7.80:8090") == "http://100.89.7.80:8090" + EXCHANGE_PATH);
  expect(LOGIN_PATH == "/terminal/login");
  expect(EXCHANGE_PATH == "/terminal/exchange");
});

test("requestJson sends exactly the code field the server reads", () => {
  expect(requestJson("ABC234") == "{\"code\":\"ABC234\"}");
});

test("requestJson escapes a code containing a quote rather than breaking the JSON", () => {
  let body = requestJson("A\"B");
  expect(body.indexOf("\\\"") >= 0);
});

test("a negative status means the server could not be reached at all", () => {
  let r = parseExchange("https://joule.sh", -1, "", 0);
  expect(r.outcome == EX_UNREACHABLE);
  expect(r.credential.secret == "");
});

test("a 200 with a credential and account is read into the stored fields", () => {
  let body = "{\"credential\":{\"id\":\"key_1\",\"secret\":\"jl_verysecret\",\"keyPrefix\":\"jl_ab\",\"name\":\"Terminal\",\"scopes\":\"search,retrieve\"},\"account\":{\"id\":\"acct_1\",\"email\":\"aymen@example.com\"},\"revokeAt\":\"/platform/keys\"}";
  let r = parseExchange("https://joule.sh", 200, body, 1000);
  expect(r.outcome == EX_OK);
  expect(r.credential.secret == "jl_verysecret");
  expect(r.credential.keyId == "key_1");
  expect(r.credential.keyPrefix == "jl_ab");
  expect(r.credential.scopes == "search,retrieve");
  expect(r.credential.accountId == "acct_1");
  expect(r.credential.accountEmail == "aymen@example.com");
  expect(r.credential.server == "https://joule.sh");
});

test("a 200 whose body has no credential is treated as not a Joule server", () => {
  let r = parseExchange("https://example.com", 200, "{\"ok\":true}", 0);
  expect(r.outcome == EX_NOT_JOULE);
  expect(r.credential.secret == "");
});

test("a 200 with a credential object but an empty secret is also not-joule, not a broken login", () => {
  let r = parseExchange("https://example.com", 200, "{\"credential\":{\"id\":\"x\",\"secret\":\"\"}}", 0);
  expect(r.outcome == EX_NOT_JOULE);
});

test("429 reports throttling and carries the seconds to wait", () => {
  let r = parseExchange("https://joule.sh", 429, "{\"error\":\"too many attempts. Wait and try again\",\"retryAfter\":42}", 0);
  expect(r.outcome == EX_THROTTLED);
  expect(r.retryAfter == 42);
  expect(r.message.indexOf("42") >= 0);
});

test("429 with no usable retryAfter falls back to sixty seconds", () => {
  let r = parseExchange("https://joule.sh", 429, "{\"error\":\"too many attempts\"}", 0);
  expect(r.outcome == EX_THROTTLED);
  expect(r.retryAfter == 60);
});

test("400 with reason expired, used or unknown map to their own outcomes", () => {
  expect(parseExchange("https://joule.sh", 400, "{\"error\":\"that code has expired\",\"reason\":\"expired\"}", 0).outcome == EX_EXPIRED);
  expect(parseExchange("https://joule.sh", 400, "{\"error\":\"that code has already been used\",\"reason\":\"used\"}", 0).outcome == EX_USED);
  expect(parseExchange("https://joule.sh", 400, "{\"error\":\"that code is not one this console is holding\",\"reason\":\"unknown\"}", 0).outcome == EX_UNKNOWN);
});

test("400 without a recognized reason still fails cleanly with the server's message", () => {
  let r = parseExchange("https://joule.sh", 400, "{\"error\":\"malformed request\"}", 0);
  expect(r.outcome == EX_UNKNOWN);
  expect(r.message.indexOf("malformed request") >= 0);
});

test("404 means this deployment keeps no accounts to sign a terminal in to", () => {
  let r = parseExchange("https://joule.sh", 404, "{\"error\":\"this deployment keeps no accounts to sign a terminal in to\"}", 0);
  expect(r.outcome == EX_NO_ACCOUNTS);
});

test("401 and 403 mean the credential this terminal held is no longer accepted", () => {
  expect(parseExchange("https://joule.sh", 401, "{\"error\":\"revoked\"}", 0).outcome == EX_REVOKED);
  expect(parseExchange("https://joule.sh", 403, "{\"error\":\"revoked\"}", 0).outcome == EX_REVOKED);
});

test("409 and 502 mean the code was accepted but no credential could be minted, and nothing was spent", () => {
  let r = parseExchange("https://joule.sh", 409, "{\"error\":\"the key service refused to mint a key\"}", 0);
  expect(r.outcome == EX_REFUSED);
  expect(r.message.indexOf("the key service refused to mint a key") >= 0);
  expect(r.message.indexOf("Nothing was spent") >= 0);

  let r2 = parseExchange("https://joule.sh", 502, "{\"error\":\"the key service could not be reached\"}", 0);
  expect(r2.outcome == EX_REFUSED);
});

test("an unmapped status from a real Joule response falls back to a generic server error", () => {
  let r = parseExchange("https://joule.sh", 500, "{\"error\":\"boom\"}", 0);
  expect(r.outcome == EX_SERVER_ERROR);
  expect(r.message.indexOf("500") >= 0);
});

test("an error status from something that is not a Joule server is reported as such, not misread as a specific refusal", () => {
  let r = parseExchange("http://example.com", 404, "<html><body>not found</body></html>", 0);
  expect(r.outcome == EX_NOT_JOULE);

  let r2 = parseExchange("http://example.com", 400, "{\"unrelated\":true}", 0);
  expect(r2.outcome == EX_NOT_JOULE);
});

test("a failed outcome never carries a partial credential", () => {
  let r = parseExchange("https://joule.sh", 500, "{\"error\":\"boom\"}", 0);
  expect(r.credential.secret == "");
  expect(r.credential.accountEmail == "");
  expect(r.credential.keyId == "");
});
