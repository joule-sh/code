import { isAcceptedInboundType, highestSeq, watermarkForResume } from "./connection.ts";
import { MailboxEntry } from "../tasks/mailbox.ts";
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

function entry(seq: int): MailboxEntry {
  let e: MailboxEntry = { recvAt: 0, tag: "F", payload: "{\"v\":1,\"seq\":" + `${seq}` + ",\"type\":\"text.delta\"}" };
  return e;
}

test("highestSeq is the largest seq the log holds, and -1 for an empty one", () => {
  expect(highestSeq([]) == -1);
  expect(highestSeq([entry(1), entry(7), entry(4)]) == 7);
});

test("a client resuming inside the session it left keeps the point it left at", () => {
  expect(watermarkForResume(4, 9) == 4);
  expect(watermarkForResume(9, 9) == 9);
});

test("a first attach asks for everything and keeps asking for everything", () => {
  expect(watermarkForResume(-1, 9) == -1);
  expect(watermarkForResume(-1, -1) == -1);
});

test("a client resuming past everything this session ever emitted is replayed the whole of it", () => {
  expect(watermarkForResume(40, 9) == -1);
  expect(watermarkForResume(1, -1) == -1);
});
