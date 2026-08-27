import { INPUT, CANCEL, APPROVAL_REPLY } from "../protocol/frames.ts";
import { refusalCodeOf, refusalEndsShare, REFUSAL_BUSY, shouldGiveUp, firstLine, resharedMessage, outageEndedMessage, refusedMessage, staleShareProblem, SHARE_GIVE_UP_MS, REFUSAL_SESSION_GONE, shouldSayUnreachable, UNREACHABLE_QUIET_MS, nextBackoffMs, maxSeqSeen, pushBounded, isDownstreamAllowed, encodeMailboxFrame, encodeMailboxControl, parseMailboxLine, nonEmptyLines, webUrlFor, resolveRelayConfig, relayBaseUrl, splitEndpoint, shareProblem, attributionProblem, TAG_FRAME, TAG_DISCONNECTED } from "./client_logic.ts";

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

test("webUrlFor hands the pairing code to the page as a query", () => {
  expect(webUrlFor("https://joule.sh/terminal/sessions", "ABC123") == "https://joule.sh/terminal/sessions?code=ABC123");
  expect(webUrlFor("https://joule.sh/terminal/sessions?x=1", "ABC123") == "https://joule.sh/terminal/sessions?x=1&code=ABC123");
  expect(webUrlFor("", "ABC123") == "");
});

test("splitEndpoint reads host and port out of a url", () => {
  let a = splitEndpoint("http://relay.example.com:8790");
  expect(a.ok);
  expect(a.host == "relay.example.com");
  expect(a.port == 8790);

  let b = splitEndpoint("ws://100.89.7.80:8791/anything");
  expect(b.ok);
  expect(b.host == "100.89.7.80");
  expect(b.port == 8791);
});

test("splitEndpoint takes the port the scheme implies when none is written", () => {
  let a = splitEndpoint("https://relay.example.com");
  expect(a.ok);
  expect(a.port == 443);
  let b = splitEndpoint("ws://relay.example.com");
  expect(b.ok);
  expect(b.port == 80);
});

test("splitEndpoint refuses what it cannot turn into an address", () => {
  expect(!splitEndpoint("").ok);
  expect(!splitEndpoint("relay.example.com").ok);
  expect(!splitEndpoint("http://:8790").ok);
});

test("resolveRelayConfig is unconfigured, not defaulted, when the server said nothing", () => {
  let cfg = resolveRelayConfig("", "", "", "");
  expect(!cfg.configured);
  expect(cfg.host == "");
  expect(cfg.webBaseUrl == "");
  expect(cfg.tmpDir == "/tmp");
});

test("resolveRelayConfig needs all three of http, ws and web to be configured", () => {
  expect(!resolveRelayConfig("http://h:1", "ws://h:2", "", "").configured);
  expect(!resolveRelayConfig("http://h:1", "", "https://c/terminal/sessions", "").configured);
  expect(!resolveRelayConfig("", "ws://h:2", "https://c/terminal/sessions", "").configured);
});

test("resolveRelayConfig takes every field from the urls it is given", () => {
  let cfg = resolveRelayConfig("http://relay.example.com:9090", "ws://relay.example.com:9091", "https://console.example.com/terminal/sessions", "/var/tmp");
  expect(cfg.configured);
  expect(cfg.host == "relay.example.com");
  expect(cfg.httpBaseUrl == "http://relay.example.com:9090");
  expect(cfg.wsPort == 9091);
  expect(cfg.webBaseUrl == "https://console.example.com/terminal/sessions");
  expect(cfg.tmpDir == "/var/tmp");
});

test("relayBaseUrl keeps a relay served on a path whole, and joins /sessions once", () => {
  expect(relayBaseUrl("https://joule.sh/relay") == "https://joule.sh/relay");
  expect(relayBaseUrl("https://joule.sh/relay/") == "https://joule.sh/relay");
  expect(relayBaseUrl("  https://joule.sh/relay//  ") == "https://joule.sh/relay");
  expect(relayBaseUrl("http://127.0.0.1:8790") == "http://127.0.0.1:8790");
  expect(relayBaseUrl("") == "");
  let slashes = "/" + "/" + "/";
  expect(relayBaseUrl(slashes) == "");
  expect(relayBaseUrl("https://joule.sh/relay") + "/sessions" == "https://joule.sh/relay/sessions");
  expect(relayBaseUrl("https://joule.sh/relay/") + "/sessions" == "https://joule.sh/relay/sessions");
});

test("resolveRelayConfig keeps the advertised url verbatim, scheme and path and all", () => {
  let cfg = resolveRelayConfig("https://joule.sh/relay", "wss://joule.sh:8791", "https://joule.sh/terminal/sessions", "");
  expect(cfg.configured);
  expect(cfg.httpBaseUrl == "https://joule.sh/relay");
  expect(cfg.httpBaseUrl + "/sessions" == "https://joule.sh/relay/sessions");
});

test("resolveRelayConfig still carries a bare host and port advert unchanged", () => {
  let cfg = resolveRelayConfig("http://100.89.7.80:8790", "ws://100.89.7.80:8791", "https://c/terminal/sessions", "");
  expect(cfg.configured);
  expect(cfg.httpBaseUrl == "http://100.89.7.80:8790");
  expect(cfg.host == "100.89.7.80");
  expect(cfg.wsPort == 8791);
});

test("resolveRelayConfig flags a wss:// terminal advert as needing TLS, a ws:// one as not", () => {
  let tls = resolveRelayConfig("https://joule.sh/relay", "wss://joule.sh:8791", "https://joule.sh/terminal/sessions", "");
  expect(tls.wsNeedsTls);
  expect(tls.wsUrl == "wss://joule.sh:8791");
  let plain = resolveRelayConfig("http://h:1", "ws://h:2", "https://c/terminal/sessions", "");
  expect(!plain.wsNeedsTls);
});

test("an advert that is not a url leaves the client unconfigured rather than guessed at", () => {
  expect(!resolveRelayConfig("joule.sh/relay", "ws://h:2", "https://c/terminal/sessions", "").configured);
  expect(!resolveRelayConfig("/relay", "ws://h:2", "https://c/terminal/sessions", "").configured);
});

test("shareProblem names the server when there is no credential to share under", () => {
  let cfg = resolveRelayConfig("http://h:1", "ws://h:2", "https://c/terminal/sessions", "");
  let said = shareProblem("https://console.example.com", "", cfg);
  expect(said.indexOf("https://console.example.com") >= 0);
  expect(said.indexOf("/login") >= 0);
});

test("shareProblem says the server never advertised a relay, and how to say it by hand", () => {
  let cfg = resolveRelayConfig("", "", "", "");
  let said = shareProblem("https://console.example.com", "jl_secret", cfg);
  expect(said.indexOf("did not say where its relay is") >= 0);
  expect(said.indexOf("JOULE_RELAY_URL") >= 0);
});

test("shareProblem is silent once a credential and a relay are both known", () => {
  let cfg = resolveRelayConfig("http://h:1", "ws://h:2", "https://c/terminal/sessions", "");
  expect(shareProblem("https://console.example.com", "jl_secret", cfg) == "");
});

test("shareProblem refuses up front when the terminal socket needs TLS this build cannot speak", () => {
  let cfg = resolveRelayConfig("https://joule.sh/relay", "wss://joule.sh/relay-terminal", "https://joule.sh/terminal/sessions", "");
  let said = shareProblem("https://joule.sh", "jl_secret", cfg);
  expect(said.indexOf("wss://joule.sh/relay-terminal") >= 0);
  expect(said.indexOf("TLS") >= 0);
});

test("a relay that could not attribute the session names the console it asked", () => {
  let said = attributionProblem("rejected", "http://100.89.7.80:8090");
  expect(said.indexOf("http://100.89.7.80:8090") >= 0);
  expect(said.indexOf("would not attribute") >= 0);
  expect(said.indexOf("different console") >= 0);
  expect(said.indexOf("/login") >= 0);
});

test("a console the relay could not reach is said to be unreachable, not a rejection", () => {
  let said = attributionProblem("unreachable", "http://100.89.7.80:8090");
  expect(said.indexOf("could not reach the console") >= 0);
  expect(said.indexOf("revoked") < 0);
});

test("a relay too old to answer with an account status is named as that, not treated as owned", () => {
  expect(attributionProblem("", "").indexOf("too old") >= 0);
});

test("an attributed session is no problem at all", () => {
  expect(attributionProblem("ok", "http://100.89.7.80:8090") == "");
});

test("every line a share failure prints fits a narrow terminal, which clips rather than wraps", () => {
  let unconfigured = shareProblem("https://console.example.com", "jl_secret", resolveRelayConfig("", "", "", ""));
  let unsigned = shareProblem("https://console.example.com", "", resolveRelayConfig("", "", "", ""));
  let rejected = attributionProblem("rejected", "http://100.89.7.80:8090");
  let unreachable = attributionProblem("unreachable", "http://100.89.7.80:8090");
  let stale = attributionProblem("", "");
  for (const line of (unconfigured + "\n" + unsigned).split("\n")) {
    expect(line.length <= 80);
  }
});

test("a connection lost and repaired inside the quiet window says nothing at all", () => {
  let started: i64 = 1000;
  expect(!shouldSayUnreachable(true, false, started, started));
  expect(!shouldSayUnreachable(true, false, started, started + 500));
  expect(!shouldSayUnreachable(true, false, started, started + UNREACHABLE_QUIET_MS - 1));
});

test("an outage that outlives the quiet window warns on the first retry past it", () => {
  let started: i64 = 1000;
  expect(shouldSayUnreachable(true, false, started, started + UNREACHABLE_QUIET_MS));
  expect(shouldSayUnreachable(true, false, started, started + 60000));
});

test("the warning is said once per outage, not once per failed retry", () => {
  let started: i64 = 1000;
  expect(!shouldSayUnreachable(true, true, started, started + 60000));
});

test("a clean disconnect is not a failed retry, so it never warns however long it lasts", () => {
  let started: i64 = 1000;
  expect(!shouldSayUnreachable(false, false, started, started + 60000));
});

test("with no outage recorded there is nothing to warn about", () => {
  expect(!shouldSayUnreachable(true, false, 0, 60000));
});

test("a relay that answers no such session is told apart from one that does not answer", () => {
  let gone = "{\"v\":1,\"seq\":0,\"type\":\"error\",\"code\":\"session_not_found\",\"message\":\"no such session\"}";
  let held = "{\"v\":1,\"seq\":0,\"type\":\"error\",\"code\":\"unauthorized\",\"message\":\"held\"}";
  expect(refusalCodeOf(gone) == REFUSAL_SESSION_GONE);
  expect(refusalCodeOf(held) == "unauthorized");
  expect(refusalCodeOf("{\"v\":1,\"seq\":4,\"type\":\"input\",\"text\":\"hi\"}") == "");
  expect(refusalCodeOf("") == "");
});

test("an outage gives up only once it has run the whole budget", () => {
  let started: i64 = 1000;
  expect(!shouldGiveUp(started, started));
  expect(!shouldGiveUp(started, started + SHARE_GIVE_UP_MS - 1));
  expect(shouldGiveUp(started, started + SHARE_GIVE_UP_MS));
});

test("with no outage recorded there is nothing to give up on", () => {
  expect(!shouldGiveUp(0, 999999));
});

test("firstLine takes one line and bounds it, so a banner is never clipped in half", () => {
  expect(firstLine("the peer closed the connection") == "the peer closed the connection");
  expect(firstLine("cannot reach the relay\n  tried http://x:1\n  nothing") == "cannot reach the relay");
  expect(firstLine("") == "nothing said why");
  expect(firstLine("   ") == "nothing said why");
  let long = "";
  let i = 0;
  while (i < 200) { long = long + "x"; i = i + 1; }
  expect(firstLine(long).length <= 58);
  expect(firstLine(long).endsWith("..."));
});

test("every line the reshare paths print fits a terminal that clips rather than wraps", () => {
  let said = resharedMessage() + "\n"
    + outageEndedMessage("http://100.89.7.80:8790", "the peer closed the connection") + "\n"
    + refusedMessage("unauthorized") + "\n"
    + staleShareProblem("cannot reach the relay\n  tried http://100.89.7.80:8790");
  for (const line of said.split("\n")) {
    expect(line.length <= 80);
  }
});

test("the silent re-share says the old code is dead without printing a new one", () => {
  let said = resharedMessage();
  expect(said.indexOf("re-made") >= 0);
  expect(said.indexOf("dead") >= 0);
  expect(said.indexOf("/share") >= 0);
});

test("giving up names the address tried and what it last answered, never silence", () => {
  let said = outageEndedMessage("http://100.89.7.80:8790", "the peer closed the connection");
  expect(said.indexOf("http://100.89.7.80:8790") >= 0);
  expect(said.indexOf("the peer closed the connection") >= 0);
  expect(said.indexOf("/share") >= 0);
});

test("a refusal is reported as a refusal, not as an outage", () => {
  let said = refusedMessage("unauthorized");
  expect(said.indexOf("unauthorized") >= 0);
  expect(said.indexOf("not an outage") >= 0);
});

test("a share the relay no longer holds is refused rather than replayed with its old code", () => {
  let said = staleShareProblem("cannot reach the relay");
  expect(said.indexOf("no longer holds") >= 0);
  expect(said.indexOf("not printed again") >= 0);
});

test("a relay too busy to answer its own store is an outage, not a refusal of this terminal", () => {
  expect(!refusalEndsShare(REFUSAL_BUSY));
  expect(!refusalEndsShare(REFUSAL_SESSION_GONE));
  expect(!refusalEndsShare(""));
  expect(refusalEndsShare("unauthorized"));
  expect(refusalEndsShare("unknown_role"));
});
