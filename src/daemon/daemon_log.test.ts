import { describeFrame, shortConnId } from "./daemon_log.ts";
import { PROTOCOL_VERSION, INPUT, InputFrame, encodeInput } from "../protocol/frames.ts";

test("a frame is described by its type and sequence number", () => {
  let f: InputFrame = { v: PROTOCOL_VERSION, seq: 12, type: INPUT, text: "fix the health route" };
  expect(describeFrame(encodeInput(f)) == "input seq 12");
});

test("a frame a client sent without a sequence number is described by type alone", () => {
  let f: InputFrame = { v: PROTOCOL_VERSION, seq: 0, type: INPUT, text: "hi" };
  expect(describeFrame(encodeInput(f)) == "input");
});

test("something that is not a frame at all is named rather than logged as blank", () => {
  expect(describeFrame("not json") == "unrecognised");
  expect(describeFrame("") == "unrecognised");
});

test("a connection id is shortened for the log but a short one is left alone", () => {
  expect(shortConnId("0f8c1d2e-4b6a-4c3d-9e1f-2a3b4c5d6e7f") == "0f8c1d2e");
  expect(shortConnId("abc") == "abc");
});
