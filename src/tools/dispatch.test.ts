import { redactSecrets } from "./dispatch.ts";

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
