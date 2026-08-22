import { normalizeServer, serverScheme, serverHost, serverAuthority, isPrivateHost, isDefaultServer, checkServer, resolveServer, insecureAllowed, DEFAULT_SERVER, SERVER_OK, SERVER_BAD_URL, SERVER_INSECURE } from "./server.ts";

test("normalizeServer lowercases scheme and host, drops a trailing slash", () => {
  expect(normalizeServer("HTTPS://Example.COM/") == "https://example.com");
});

test("normalizeServer keeps path case, only the authority is lowered", () => {
  expect(normalizeServer("https://Example.COM/Some/Path") == "https://example.com/Some/Path");
});

test("normalizeServer strips more than one trailing slash", () => {
  expect(normalizeServer("https://example.com///") == "https://example.com");
});

test("normalizeServer trims surrounding whitespace before parsing", () => {
  expect(normalizeServer("  https://example.com  ") == "https://example.com");
});

test("serverScheme and serverHost read the pieces a checker needs", () => {
  expect(serverScheme("https://example.com:8090/x") == "https");
  expect(serverHost("https://example.com:8090/x") == "example.com");
  expect(serverHost("http://100.89.7.80:8090") == "100.89.7.80");
});

test("serverAuthority drops the path, and serverHost also drops any userinfo", () => {
  expect(serverAuthority("https://example.com:8090/x") == "example.com:8090");
  expect(serverAuthority("https://user:pass@example.com:8090/x") == "example.com:8090");
  expect(serverHost("https://user:pass@example.com:8090/x") == "example.com");
});

test("serverHost reads a bracketed IPv6 literal without its brackets or port", () => {
  expect(serverHost("http://[::1]:8090") == "::1");
});

test("isPrivateHost accepts loopback, RFC1918, link-local, CGNAT and local names", () => {
  expect(isPrivateHost("127.0.0.1"));
  expect(isPrivateHost("localhost"));
  expect(isPrivateHost("10.1.2.3"));
  expect(isPrivateHost("172.16.0.1"));
  expect(isPrivateHost("172.31.255.255"));
  expect(isPrivateHost("192.168.1.1"));
  expect(isPrivateHost("169.254.1.1"));
  expect(isPrivateHost("100.89.7.80"));
  expect(isPrivateHost("::1"));
  expect(isPrivateHost("fd00::1"));
  expect(isPrivateHost("box.local"));
  expect(isPrivateHost("box.internal"));
});

test("isPrivateHost refuses a public address and a public name", () => {
  expect(!isPrivateHost("8.8.8.8"));
  expect(!isPrivateHost("joule.sh"));
  expect(!isPrivateHost("172.32.0.1"));
  expect(!isPrivateHost("172.15.255.255"));
  expect(!isPrivateHost("100.63.0.1"));
  expect(!isPrivateHost("100.128.0.1"));
});

test("isDefaultServer compares normalized forms, not raw text", () => {
  expect(isDefaultServer("https://joule.sh"));
  expect(isDefaultServer("https://joule.sh/"));
  expect(isDefaultServer("HTTPS://JOULE.SH"));
  expect(!isDefaultServer("http://joule.sh"));
  expect(!isDefaultServer("https://staging.joule.sh"));
});

test("checkServer accepts https to a public host", () => {
  let r = checkServer("https://joule.sh", false);
  expect(r.status == SERVER_OK);
  expect(r.base == "https://joule.sh");
});

test("checkServer accepts plain http to a private or loopback host without asking", () => {
  expect(checkServer("http://127.0.0.1:8090", false).status == SERVER_OK);
  expect(checkServer("http://localhost:8090", false).status == SERVER_OK);
  expect(checkServer("http://100.89.7.80:8090", false).status == SERVER_OK);
  expect(checkServer("http://box.internal", false).status == SERVER_OK);
});

test("checkServer refuses plain http to a public host unless insecure is allowed", () => {
  let refused = checkServer("http://joule.sh", false);
  expect(refused.status == SERVER_INSECURE);
  expect(refused.message.indexOf("plain http") >= 0);

  let allowed = checkServer("http://joule.sh", true);
  expect(allowed.status == SERVER_OK);
});

test("checkServer rejects a scheme that is neither http nor https", () => {
  let r = checkServer("ftp://joule.sh", false);
  expect(r.status == SERVER_BAD_URL);
});

test("checkServer rejects garbage that is not a URL at all", () => {
  let r = checkServer("not a url", false);
  expect(r.status == SERVER_BAD_URL);
  let empty = checkServer("", false);
  expect(empty.status == SERVER_BAD_URL);
});

test("resolveServer prefers the flag, then the env var, then the config file, then the default", () => {
  expect(resolveServer("https://flag.example", "https://env.example", "https://file.example") == "https://flag.example");
  expect(resolveServer("", "https://env.example", "https://file.example") == "https://env.example");
  expect(resolveServer("", "", "https://file.example") == "https://file.example");
  expect(resolveServer("", "", "") == normalizeServer(DEFAULT_SERVER));
});

test("resolveServer normalizes whichever source it picks", () => {
  expect(resolveServer("HTTPS://Flag.Example/", "", "") == "https://flag.example");
});

test("insecureAllowed accepts 1, true or yes, case-insensitively, and nothing else", () => {
  expect(insecureAllowed("1"));
  expect(insecureAllowed("true"));
  expect(insecureAllowed("YES"));
  expect(insecureAllowed(" true "));
  expect(!insecureAllowed(""));
  expect(!insecureAllowed("0"));
  expect(!insecureAllowed("false"));
  expect(!insecureAllowed("nope"));
});
