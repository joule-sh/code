import { parseAccountVerify, consoleUrlFromEnv, verifyUrl, requestJson, VERIFY_OK, VERIFY_UNREACHABLE, VERIFY_REJECTED, VERIFY_PATH } from "./account_verify.ts";

test("a negative status means the console could not be reached", () => {
  let r = parseAccountVerify(-1, "");
  expect(r.status == VERIFY_UNREACHABLE);
  expect(r.accountId == "");
});

test("a 200 with an account object is read into a verified result", () => {
  let body = "{\"account\":{\"id\":\"acct_1\",\"email\":\"aymen@example.com\"}}";
  let r = parseAccountVerify(200, body);
  expect(r.status == VERIFY_OK);
  expect(r.accountId == "acct_1");
  expect(r.accountEmail == "aymen@example.com");
});

test("a 200 with no account member is rejected, not treated as anonymous-ok", () => {
  let r = parseAccountVerify(200, "{\"ok\":true}");
  expect(r.status == VERIFY_REJECTED);
});

test("a 200 with an account object but an empty id is rejected", () => {
  let r = parseAccountVerify(200, "{\"account\":{\"id\":\"\",\"email\":\"x@example.com\"}}");
  expect(r.status == VERIFY_REJECTED);
});

test("a 401 from the console is rejected, same as any other non-200", () => {
  let r = parseAccountVerify(401, "{\"error\":\"revoked\"}");
  expect(r.status == VERIFY_REJECTED);
});

test("consoleUrlFromEnv falls back to the default server when unset", () => {
  expect(consoleUrlFromEnv("") == "https://joule.sh");
});

test("consoleUrlFromEnv normalizes a configured value", () => {
  expect(consoleUrlFromEnv("http://100.89.7.80:8090/") == "http://100.89.7.80:8090");
});

test("verifyUrl joins a normalized base with the fixed verify path", () => {
  expect(verifyUrl("https://joule.sh/") == "https://joule.sh" + VERIFY_PATH);
  expect(VERIFY_PATH == "/terminal/verify");
});

test("requestJson sends exactly the secret field the console reads", () => {
  expect(requestJson("abc123") == "{\"secret\":\"abc123\"}");
});

test("requestJson escapes a secret containing a quote rather than breaking the JSON", () => {
  let body = requestJson("a\"b");
  expect(body.indexOf("\\\"") >= 0);
});
