import { base64Encode, osc52Sequence, clipboardPayload, OSC52_MAX_BYTES } from "./osc52.ts";

const ESC: string = String.fromCharCode(27);
const BEL: string = String.fromCharCode(7);

test("base64Encode matches the RFC 4648 test vectors, padding included", () => {
  expect(base64Encode("") == "");
  expect(base64Encode("f") == "Zg==");
  expect(base64Encode("fo") == "Zm8=");
  expect(base64Encode("foo") == "Zm9v");
  expect(base64Encode("foob") == "Zm9vYg==");
  expect(base64Encode("fooba") == "Zm9vYmE=");
  expect(base64Encode("foobar") == "Zm9vYmFy");
});

test("base64Encode handles the bytes above 127 a UTF-8 line is made of", () => {
  expect(base64Encode(String.fromCharCode(200) + String.fromCharCode(100)) == "yGQ=");
  expect(base64Encode(String.fromCharCode(255) + String.fromCharCode(254)) == "/" + "/4=");
  expect(base64Encode("caf" + String.fromCharCode(195) + String.fromCharCode(169)) == "Y2Fmw6k=");
});

test("base64Encode encodes a newline rather than emitting one", () => {
  let encoded = base64Encode("a" + String.fromCharCode(10) + "b");
  expect(encoded == "YQpi");
  expect(encoded.indexOf(String.fromCharCode(10)) < 0);
});

test("osc52Sequence is a well-formed OSC 52 clipboard write ending in BEL", () => {
  expect(osc52Sequence("foobar") == ESC + "]52;c;Zm9vYmFy" + BEL);
});

test("an OSC 52 sequence never carries a raw newline, whatever the selection held", () => {
  let seq = osc52Sequence("one" + String.fromCharCode(10) + "two" + String.fromCharCode(10) + "three");
  expect(seq.indexOf(String.fromCharCode(10)) < 0);
  expect(seq.startsWith(ESC + "]52;c;"));
  expect(seq.endsWith(BEL));
});

test("an oversized selection is truncated to the payload cap rather than sent whole", () => {
  let big = "";
  let i = 0;
  while (i < OSC52_MAX_BYTES + 500) {
    big = big + "x";
    i = i + 1;
  }
  expect(clipboardPayload(big).length == OSC52_MAX_BYTES);
  expect(clipboardPayload("short").length == 5);
});
