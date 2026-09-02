import { redactSecrets, redactKnownSecrets, rememberSecret, ok, fail } from "./dispatch.ts";

// The first version redacted inside `read` and `run` only, so the interactive
// session (which answers a foreground run through run_wait.ts) and `grep` both
// leaked. Everything builds its result through ok/fail, so that is where the
// scrub belongs and this is what pins it there.
test("a remembered secret is scrubbed from every tool result, whichever tool built it", () => {
  rememberSecret("sk-pinned-0001");
  expect(ok("key=sk-pinned-0001 here", false).output == "key=[redacted] here");
  expect(fail("failed with sk-pinned-0001").output == "failed with [redacted]");
  expect(redactKnownSecrets("a sk-pinned-0001 b") == "a [redacted] b");
});

test("remembering is idempotent and ignores an empty secret", () => {
  rememberSecret("");
  rememberSecret("sk-pinned-0002");
  rememberSecret("sk-pinned-0002");
  // An empty secret must never match, or it would redact the whole string.
  expect(ok("untouched text", false).output == "untouched text");
  expect(ok("has sk-pinned-0002", false).output == "has [redacted]");
});

test("every occurrence of a known secret is redacted, wherever it surfaces", () => {
  let out = redactSecrets("token: sk-abc123, again sk-abc123 here", ["sk-abc123"]);
  expect(out.indexOf("sk-abc123") < 0);
  expect(out == "token: [redacted], again [redacted] here");
});

test("text with no secret in it is left untouched", () => {
  expect(redactSecrets("nothing sensitive here", ["sk-abc123"]) == "nothing sensitive here");
});

test("an empty secret is never matched against, so it cannot redact everything", () => {
  expect(redactSecrets("plain text", ["", ""]) == "plain text");
});

test("more than one secret is redacted independently", () => {
  let out = redactSecrets("key=abc token=xyz", ["abc", "xyz"]);
  expect(out == "key=[redacted] token=[redacted]");
});
