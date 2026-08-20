# Spec 003: WebSocket between the three, SSE to the model

## What is true today

`packages/websocket` in std-contrib is a WebSocket implementation in Lumen:
`frame.ts` (encode, decode, masking, opcodes, close codes), `handshake.ts`,
`session.ts`, `server.ts` and `client.ts`, with unit tests and a check against a
real browser. `packages/socketio` is built on it and completes an Engine.IO
handshake with the unmodified socket.io 4.7.5 client from their CDN.

It exists because [spec 474](https://github.com/lumen-lang-org/lumen) added
`crypto.sha1` and base64 as primitives, for the one hash RFC 6455 fixes into the
handshake. The objection to adding SHA-1 in 2026 was raised in that spec and
overruled with the reason recorded: it is a fixed token compared for equality,
not a signature, and refusing it meant refusing WebSocket permanently.

Separately, `http.stream` (spec 452) is a live read handle over a response in
progress, chunk-decoding, `Accept-Encoding: identity`, written for token
streams.

So both transports are available and neither has to be built.

## What this settles

**Relay to browser: WebSocket.** Native in the browser, bidirectional over one
connection, and the server side is the in-house implementation that has already
been proven against a real browser client.

**Terminal to relay: WebSocket**, using `connectWebSocket`. The terminal dials
out, it is behind NAT and nothing can dial in, and gets one bidirectional
connection instead of a stream in one direction plus a POST for every keystroke
of intent.

**Terminal to the model: SSE, over `http.stream`.** Not a preference. Providers
speak SSE, `http.stream` was written for exactly this, and the terminal needs it
regardless of anything else in this document.

## The consequence that shapes the terminal

`receive()` blocks until a message arrives, the peer closes, or the connection
breaks. Its own comment is the design note: *"a caller that needs otherwise
wants a thread rather than a flag here."*

So the terminal cannot sit in `receive()` on its main path. During a turn it is
already draining an `http.stream` from the model and may have a child process
streaming output; a blocking read of a third thing has to live somewhere else.

The shape that follows: **the relay connection is owned by a `Worker`**, which
blocks in `receive()` and hands frames to the turn loop. This is what
[#14](https://github.com/joule-sh/code/issues/14) has to prove before
[#10](https://github.com/joule-sh/code/issues/10) is written, a `Worker`
blocking in `receive()`, an `http.stream` being drained, and a spawned child, in
one process, none starving the others.

If that does not hold, the fallback is a short poll from the terminal, which
costs latency on approvals and on browser input and nothing else. Decide it on
evidence.

## What we give up by not using SSE, and what replaces it

SSE carries resumption in the transport: an event has an `id`, and a client that
reconnects sends `Last-Event-ID`. WebSocket has no equivalent, so it becomes
ours.

A reconnecting participant sends `resume {since}` as its first frame, naming the
last `seq` it saw. The relay replays from its ring, or says it cannot. That is
one frame added to [spec 001](../001-frames/spec.md) and the `seq` field was
already there for this reason.

## The rules

1. **One connection per participant, bidirectional.** Not a stream plus a
   side-channel for writes. A single connection is one thing to reconnect, one
   thing to authenticate and one thing to reason about when it drops.
2. **The blocking read lives off the main path**, in a `Worker`, and nothing on
   the turn loop ever calls `receive()` directly.
3. **The model link stays SSE and is not reconsidered.** It is one-directional
   by nature and the provider decides the protocol.
4. **The first frame after connecting is `resume {since}` or `session.hello`.**
   There is no third possibility, so a connection is always in a known state.
5. **The relay answers a ping.** `session.ts` does this already; a heartbeat a
   caller has to remember is one that eventually stops.
6. **The console proxy has to forward the upgrade.** This is a real requirement
   on [console#7](https://github.com/joule-sh/console/issues/7), not an
   implementation detail, a proxy that only forwards ordinary requests answers
   the handshake with something that is not a 101, and `connectWebSocket`
   verifies the server's token rather than assuming it, so the failure is at
   least loud.

## Deliberately not in scope

**Binary frames.** Everything sent is JSON text. `OP_BINARY` exists and is
unused; revisit if a transcript is ever measurably the bottleneck.

**Falling back to SSE when a proxy eats the upgrade.** Two transports means two
code paths and two sets of bugs, and the proxy in front of this is ours. If a
future deployment sits behind something hostile, that is when a fallback earns
its cost.

## A correction, recorded

This spec exists because the plan originally said the opposite, that Lumen had
no WebSocket, citing a `426 Upgrade Required` in `lumen_runtime_net.zig` and a
comment reading "No SHA-1, no WebSocket". Both readings were wrong. The 426 is
one row in the complete HTTP status-reason table, and the comment is spec 474's
problem statement describing what it then fixed.

Worth keeping because the failure is a repeatable one: a status code in a lookup
table read as policy, and a problem statement read as a current limitation. When
the question is "can this toolchain do X", the answer is in the packages and the
tests, not in a grep for X in the compiler.
