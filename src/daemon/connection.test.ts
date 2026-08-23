import { isAcceptedInboundType } from "./connection.ts";
import { INPUT, CANCEL, APPROVAL_REPLY, MODE_SET, MODEL_SET, TASKS_REQUEST, DAEMON_STOP, SHARE_REQUEST, RESUME, SESSION_HELLO, TEXT_DELTA } from "../protocol/frames.ts";

test("client-to-daemon frame types are accepted", () => {
  expect(isAcceptedInboundType(INPUT));
  expect(isAcceptedInboundType(CANCEL));
  expect(isAcceptedInboundType(APPROVAL_REPLY));
  expect(isAcceptedInboundType(MODE_SET));
  expect(isAcceptedInboundType(MODEL_SET));
  expect(isAcceptedInboundType(TASKS_REQUEST));
  expect(isAcceptedInboundType(DAEMON_STOP));
  expect(isAcceptedInboundType(SHARE_REQUEST));
});

test("RESUME is handled separately, not through the accepted-inbound path", () => {
  expect(!isAcceptedInboundType(RESUME));
});

test("daemon-to-client-only frame types are refused as inbound", () => {
  expect(!isAcceptedInboundType(SESSION_HELLO));
  expect(!isAcceptedInboundType(TEXT_DELTA));
});

test("an unrecognised type is refused, not silently accepted", () => {
  expect(!isAcceptedInboundType("some.future.frame"));
  expect(!isAcceptedInboundType(""));
});
