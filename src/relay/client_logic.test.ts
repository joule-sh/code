import { INPUT, CANCEL, APPROVAL_REPLY } from "../protocol/frames.ts";
import { nextBackoffMs, maxSeqSeen, pushBounded, isDownstreamAllowed, encodeMailboxFrame, encodeMailboxControl, parseMailboxLine, nonEmptyLines, webUrlFor, resolveRelayConfig, TAG_FRAME, TAG_DISCONNECTED } from "./client_logic.ts";

test("nextBackoffMs doubles and caps at BACKOFF_CAP_MS", () => {
  expect(nextBackoffMs(500) == 1000);
  expect(nextBackoffMs(1000) == 2000);
  expect(nextBackoffMs(8000) == 10000);
  expect(nextBackoffMs(10000) == 10000);
  expect(nextBackoffMs(20000) == 10000);
});

test("maxSeqSeen only advances, never regresses", () => {
  let f5 = "{\"v\":1,\"seq\":5,\"type\":\"input\"}";
  let f3 = "{\"v\":1,\"seq\":3,\"type\":\"input\"}";
  expect(maxSeqSeen(0, f5) == 5);
  expect(maxSeqSeen(5, f3) == 5);
  expect(maxSeqSeen(5, f5) == 5);
});

test("pushBounded keeps every frame under the cap, no overflow flagged", () => {
  let buf: string[] = [];
  let i = 0;
  while (i < 5) {
    let r = pushBounded(buf, 5, "f" + `${i}`);
    buf = r.buffer;
    expect(!r.overflowed);
    i = i + 1;
  }
  expect(buf.length == 5);
  expect(buf[0] == "f0");
});

test("pushBounded evicts the oldest frame and signals overflow past the cap", () => {
  let buf: string[] = ["f0", "f1", "f2"];
  let r = pushBounded(buf, 3, "f3");
  expect(r.overflowed);
  expect(r.buffer.length == 3);
  expect(r.buffer[0] == "f1");
  expect(r.buffer[2] == "f3");
});

test("isDownstreamAllowed accepts exactly input, cancel, approval.reply", () => {
  expect(isDownstreamAllowed(INPUT));
  expect(isDownstreamAllowed(CANCEL));
  expect(isDownstreamAllowed(APPROVAL_REPLY));
  expect(!isDownstreamAllowed("text.delta"));
  expect(!isDownstreamAllowed("session.hello"));
  expect(!isDownstreamAllowed("resume"));
  expect(!isDownstreamAllowed(""));
});

test("mailbox frame and control lines round-trip through parseMailboxLine", () => {
  let frameLine = encodeMailboxFrame("{\"v\":1,\"seq\":2,\"type\":\"input\"}");
  let parsedFrame = parseMailboxLine(frameLine);
  expect(parsedFrame.tag == TAG_FRAME);
  expect(parsedFrame.payload == "{\"v\":1,\"seq\":2,\"type\":\"input\"}");

  let ctrlLine = encodeMailboxControl(TAG_DISCONNECTED, "the peer closed the connection");
  let parsedCtrl = parseMailboxLine(ctrlLine);
  expect(parsedCtrl.tag == TAG_DISCONNECTED);
  expect(parsedCtrl.payload == "the peer closed the connection");
});

test("parseMailboxLine on a line with no tag separator returns an empty tag", () => {
  let p = parseMailboxLine("not a tagged line");
  expect(p.tag == "");
});

test("nonEmptyLines drops blank lines and preserves order", () => {
  let lines = nonEmptyLines("a\n\nb\nc\n");
  expect(lines.length == 3);
  expect(lines[0] == "a");
  expect(lines[1] == "b");
  expect(lines[2] == "c");
});

test("webUrlFor joins the base url and the pairing code", () => {
  expect(webUrlFor("https://joule.sh/w/", "ABC123") == "https://joule.sh/w/ABC123");
});

test("resolveRelayConfig falls back to defaults when nothing is set", () => {
  let cfg = resolveRelayConfig("", "", "", "", "");
  expect(cfg.host == "127.0.0.1");
  expect(cfg.httpPort == 8090);
  expect(cfg.wsPort == 8091);
  expect(cfg.webBaseUrl == "https://joule.sh/w/");
  expect(cfg.tmpDir == "/tmp");
});

test("resolveRelayConfig honors every field when set", () => {
  let cfg = resolveRelayConfig("relay.example.com", "9090", "9091", "https://example.com/w/", "/var/tmp");
  expect(cfg.host == "relay.example.com");
  expect(cfg.httpPort == 9090);
  expect(cfg.wsPort == 9091);
  expect(cfg.webBaseUrl == "https://example.com/w/");
  expect(cfg.tmpDir == "/var/tmp");
});
