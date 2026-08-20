import { CODE_ALPHABET, CODE_LENGTH, codeFromRandomHex, generateCode, generateSecret, generateSessionId, constantTimeEqual } from "./pairing.ts";

function allCharsInAlphabet(s: string): bool {
  let i = 0;
  while (i < s.length) {
    if (CODE_ALPHABET.indexOf(s.charAt(i)) < 0) {
      return false;
    }
    i = i + 1;
  }
  return true;
}

test("codeFromRandomHex is deterministic for a fixed input", () => {
  let hex = "000102030405";
  let a = codeFromRandomHex(hex);
  let b = codeFromRandomHex(hex);
  expect(a == b);
  expect(a.length == CODE_LENGTH);
});

test("codeFromRandomHex only ever picks from the restricted alphabet", () => {
  let code = codeFromRandomHex("aabbccddeeff00112233445566778899");
  expect(allCharsInAlphabet(code));
});

test("the code alphabet excludes the visually confusable characters", () => {
  expect(CODE_ALPHABET.indexOf("0") < 0);
  expect(CODE_ALPHABET.indexOf("O") < 0);
  expect(CODE_ALPHABET.indexOf("1") < 0);
  expect(CODE_ALPHABET.indexOf("I") < 0);
  expect(CODE_ALPHABET.indexOf("L") < 0);
});

test("generateCode produces a code of the right length from the alphabet", () => {
  let code = generateCode();
  expect(code.length == CODE_LENGTH);
  expect(allCharsInAlphabet(code));
});

test("generateSecret and generateSessionId produce non-empty, distinct values", () => {
  let s1 = generateSecret();
  let s2 = generateSecret();
  expect(s1.length > 0);
  expect(s1 != s2);

  let id1 = generateSessionId();
  let id2 = generateSessionId();
  expect(id1.length > 0);
  expect(id1 != id2);
});

test("constantTimeEqual is true only for an exact match", () => {
  expect(constantTimeEqual("ABCDEF", "ABCDEF"));
  expect(!constantTimeEqual("ABCDEF", "ABCDEG"));
});

test("constantTimeEqual is false, not a crash, on mismatched lengths", () => {
  expect(!constantTimeEqual("ABC", "ABCDEF"));
  expect(!constantTimeEqual("ABCDEF", "ABC"));
  expect(!constantTimeEqual("", "ABCDEF"));
});
