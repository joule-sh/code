import { Credential, emptyCredential, parseCredentialLine, credentialLine, findCredentialIn, removeCredentialIn, upsertCredentialIn, loadCredentialFrom, saveCredentialTo, forgetCredentialIn, credentialSource, accountLabel, SOURCE_ENV, SOURCE_JOULE, SOURCE_FILE, SOURCE_NONE } from "./credentials.ts";

function freshRoot(name: string): string {
  let root = "/tmp/credentials-test-" + name;
  if (fs.existsSync(root)) {
    fs.rmSync(root, true);
  }
  fs.mkdirSync(root, true);
  return root;
}

function credFor(server: string, secret: string): Credential {
  let c: Credential = {
    server: server, secret: secret, accountId: "acct_1", accountEmail: "aymen@example.com",
    keyId: "key_1", keyPrefix: "jl_ab", scopes: "search,retrieve", savedAt: "1000",
  };
  return c;
}

function statOctal(path: string): string {
  let args: string[] = ["-c", "stat -c %a " + path];
  let r = child_process.spawnSync("/bin/sh", args);
  return r.stdout.trim();
}

test("parseCredentialLine reads every field back out of the JSON it was written as", () => {
  let c = credFor("https://joule.sh", "jl_secret1");
  let line = credentialLine(c);
  let parsed = parseCredentialLine(line);
  expect(parsed.server == "https://joule.sh");
  expect(parsed.secret == "jl_secret1");
  expect(parsed.accountId == "acct_1");
  expect(parsed.accountEmail == "aymen@example.com");
  expect(parsed.keyId == "key_1");
  expect(parsed.keyPrefix == "jl_ab");
  expect(parsed.scopes == "search,retrieve");
});

test("parseCredentialLine on a blank or malformed line returns empty rather than crashing", () => {
  expect(parseCredentialLine("").secret == "");
  expect(parseCredentialLine("not json").secret == "");
  expect(parseCredentialLine("   ").secret == "");
});

test("findCredentialIn keys strictly by server, a staging token is invisible to the hosted lookup and back", () => {
  let text = credentialLine(credFor("http://100.89.7.80:8090", "staging_secret")) + "\n"
    + credentialLine(credFor("https://joule.sh", "hosted_secret")) + "\n";
  let staging = findCredentialIn(text, "http://100.89.7.80:8090");
  let hosted = findCredentialIn(text, "https://joule.sh");
  expect(staging.secret == "staging_secret");
  expect(hosted.secret == "hosted_secret");
  expect(staging.secret != hosted.secret);
});

test("findCredentialIn normalizes the server it is asked about", () => {
  let text = credentialLine(credFor("https://joule.sh", "hosted_secret")) + "\n";
  expect(findCredentialIn(text, "https://joule.sh/").secret == "hosted_secret");
  expect(findCredentialIn(text, "HTTPS://JOULE.SH").secret == "hosted_secret");
});

test("findCredentialIn returns empty for a server that has never signed in", () => {
  let text = credentialLine(credFor("https://joule.sh", "hosted_secret")) + "\n";
  expect(findCredentialIn(text, "https://other.example").secret == "");
});

test("upsertCredentialIn replaces only the row for its own server, leaving the others alone", () => {
  let text = credentialLine(credFor("https://joule.sh", "hosted_old")) + "\n"
    + credentialLine(credFor("http://100.89.7.80:8090", "staging_secret")) + "\n";
  let updated = upsertCredentialIn(text, credFor("https://joule.sh", "hosted_new"));
  expect(findCredentialIn(updated, "https://joule.sh").secret == "hosted_new");
  expect(findCredentialIn(updated, "http://100.89.7.80:8090").secret == "staging_secret");
  let lines = updated.trim().split("\n");
  expect(lines.length == 2);
});

test("removeCredentialIn drops the named server's row and keeps the rest", () => {
  let text = credentialLine(credFor("https://joule.sh", "hosted_secret")) + "\n"
    + credentialLine(credFor("http://100.89.7.80:8090", "staging_secret")) + "\n";
  let after = removeCredentialIn(text, "https://joule.sh");
  expect(findCredentialIn(after, "https://joule.sh").secret == "");
  expect(findCredentialIn(after, "http://100.89.7.80:8090").secret == "staging_secret");
});

test("save, load and forget round trip through a real file, keyed per server", () => {
  let root = freshRoot("roundtrip");
  let file = root + "/credentials.jsonl";

  saveCredentialTo(file, credFor("https://joule.sh", "hosted_secret"));
  saveCredentialTo(file, credFor("http://100.89.7.80:8090", "staging_secret"));

  expect(loadCredentialFrom(file, "https://joule.sh").secret == "hosted_secret");
  expect(loadCredentialFrom(file, "http://100.89.7.80:8090").secret == "staging_secret");

  let removed = forgetCredentialIn(file, "https://joule.sh");
  expect(removed);
  expect(loadCredentialFrom(file, "https://joule.sh").secret == "");
  expect(loadCredentialFrom(file, "http://100.89.7.80:8090").secret == "staging_secret");

  let removedAgain = forgetCredentialIn(file, "https://joule.sh");
  expect(!removedAgain);
});

test("loadCredentialFrom on a file that does not exist yet is empty, not an error", () => {
  let root = freshRoot("missing");
  expect(loadCredentialFrom(root + "/nope.jsonl", "https://joule.sh").secret == "");
});

test("saveCredentialTo writes the credential file and its directory with restrictive permissions", () => {
  let root = freshRoot("perms");
  let file = root + "/nested/credentials.jsonl";
  saveCredentialTo(file, credFor("https://joule.sh", "hosted_secret"));

  expect(statOctal(file) == "600");
  expect(statOctal(root + "/nested") == "700");
});

test("saveCredentialTo overwriting an existing file keeps it at 600", () => {
  let root = freshRoot("reperm");
  let file = root + "/credentials.jsonl";
  saveCredentialTo(file, credFor("https://joule.sh", "first_secret"));
  saveCredentialTo(file, credFor("https://joule.sh", "second_secret"));
  expect(statOctal(file) == "600");
  expect(loadCredentialFrom(file, "https://joule.sh").secret == "second_secret");
});

test("credentialSource follows env over a stored joule credential over a file key, and none when nothing is set", () => {
  expect(credentialSource("env_key", "joule_secret", "file_key") == SOURCE_ENV);
  expect(credentialSource("", "joule_secret", "file_key") == SOURCE_JOULE);
  expect(credentialSource("", "", "file_key") == SOURCE_FILE);
  expect(credentialSource("", "", "") == SOURCE_NONE);
});

test("accountLabel prefers the email, then the account id, then an unnamed placeholder", () => {
  expect(accountLabel(credFor("https://joule.sh", "s")) == "aymen@example.com");

  let noEmail: Credential = { server: "s", secret: "s", accountId: "acct_9", accountEmail: "", keyId: "", keyPrefix: "", scopes: "", savedAt: "" };
  expect(accountLabel(noEmail) == "acct_9");

  expect(accountLabel(emptyCredential()) == "an unnamed account");
});

test("accountLabel, the text shown to the user, never contains the secret", () => {
  let c = credFor("https://joule.sh", "SECRET-DO-NOT-LEAK-93af1");
  let shown = accountLabel(c);
  expect(shown.indexOf("SECRET-DO-NOT-LEAK-93af1") < 0);
  expect(credentialLine(c).indexOf("SECRET-DO-NOT-LEAK-93af1") >= 0);
});
