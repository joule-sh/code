# The daemon frame protocol (#348, #346)

`bin/joule-daemon` serves one workspace over a plain websocket, and everything
a client can do with a session it does by sending and receiving JSON frames on
that socket. `joule attach` is one such client; nothing in the protocol is
private to it. This document is what a client that is not joule - the console
engine of #348, or anything else - needs in order to drive a session without
reading `src/`.

The frame types and their fields are `src/protocol/frames.ts`. The reference
client is `src/daemon/attach_client.ts` (`DaemonClient`) plus its caller
`src/terminal/attach.ts`. The server side is `src/daemon/daemon.ts`,
`connection.ts` and `dispatch.ts`. Where this document and those files
disagree, they are right.

## The transport

A plain, unencrypted websocket. No subprotocol, no authentication, no HTTP
API beside it. The daemon binds `127.0.0.1` only.

The URL carries the client's identity in its path:

```
ws://127.0.0.1:<port>/attach/<connId>/ws
```

`connId` is chosen by the client and must be 1 to 128 characters of
`[0-9A-Za-z-]` (`isSafeConnId`, `src/daemon/paths.ts`). `DaemonClient` uses
`crypto.randomUUID()`. A path that does not match `/attach/<connId>/ws`, or a
`connId` outside that alphabet, gets the connection closed with websocket
status 1002 and the reason `bad attach path`.

Every message is a websocket text frame holding exactly one JSON object. There
is no framing beyond that: no length prefix, no batching, one object per
message.

Two clients on one daemon is the normal case, not an edge case. Every frame
the session emits goes to every attached client, and any client can send input,
answer an approval or change the mode.

## Finding the port

A running daemon writes `~/.config/joule-code/daemon/<sessionKey>.json`:

```json
{"workspace":"/home/you/proj","session":"","port":8351,"startedAt":"1756000000000"}
```

Reading `port` out of that file is how a client finds a daemon that is already
up (`readDaemonInfo`, `src/daemon/lifecycle.ts`). The file is written after the
daemon is listening and removed when it stops, so its presence is a reasonable
liveness hint but not a guarantee - `joule attach` still probes the port before
trusting it.

If no daemon is running, the port a client would start one on is derived from
the session key rather than allocated: `portFromWorkspace` sums the key's
character codes and takes `8300 + (sum % 400)`, then scans forward for a port
no other recorded daemon holds. A daemon launched directly, with no
`JOULE_DAEMON_PORT` in its environment, listens on 8199.

`JOULE_DAEMON_PORT`, `JOULE_SESSION_NAME` and `JOULE_DAEMON_RESUME=1` are the
three environment variables that configure a daemon at spawn;
`daemonSpawnCommand` in `lifecycle.ts` is the exact command `joule attach`
uses on each platform.

## Session identity

One daemon serves one `(workspace root, session name)` pair. The pair collapses
to a single string by `sessionKeyFor(workspaceRoot, name)`
(`src/session/persistence.ts`), and that string is what names everything on
disk:

| what | path |
| --- | --- |
| info file | `~/.config/joule-code/daemon/<key>.json` |
| log | `~/.config/joule-code/daemon/<key>.log` |
| runtime directory | `~/.config/joule-code/daemon/<key>/` |
| persisted history | `~/.config/joule-code/sessions/<key>.json` |

The key is a slug and a hash:

- the slug is the workspace root with every character outside
  `[A-Za-z0-9._-]` replaced by `-`, cut to its last 60 characters if longer;
- a non-empty session name appends `-` and the same sanitising of the name;
- the hash is the first 8 bytes of `sha1(workspaceRoot)`, hex-encoded - or of
  `workspaceRoot + " session:" + name` when the name is not empty, so
  `("/a/bc", "")` and `("/a", "bc")` cannot collide;
- the two are joined with `-`.

The default session is the empty name, and its key is the slug and hash of the
workspace path alone. A client that wants to talk to a specific session must
compute the same key from the same absolute workspace root; `/proj` and
`/proj/` are different keys.

`session.hello` reports both halves back (`workspace`, `session`), which is the
cheap way to confirm the daemon on a port is the one you meant. It also carries
`sessionId`, which is unrelated identity: the daemon sets it to
`daemon-<port>`, and a relay share sets it to the relay's pairing id.

## Attaching

The daemon sends nothing until a client asks for it. The sequence is:

1. Open the websocket to `/attach/<connId>/ws`.
2. Send a `resume` frame immediately.
3. Read frames until `session.hello` arrives.

Step 2 is not optional and not a formality. `daemonOnMessage` starts the
per-peer pusher only on `resume` (`src/daemon/connection.ts`); a client that
connects and waits will wait forever, on a socket that is open and healthy.
`DaemonClient` sends it from `attachReceiveLoop` the instant the socket
connects, before anything else.

```json
{"v":1,"seq":0,"type":"resume","since":-1}
```

`since` is the highest sequence number the client has already seen. A fresh
client sends `-1`, which replays everything the daemon has emitted since it
started, beginning with `session.hello`. A reconnecting client sends its last
seen `seq` and gets only what it missed.

The daemon holds every emitted frame in a broadcast log
(`<runtimeDir>/broadcast.log`), truncated at startup, and the pusher walks it
sending anything above the watermark. One consequence is worth knowing: if
`since` is higher than the highest sequence in the first batch the pusher
reads, the watermark drops to `-1` and the whole log is replayed
(`watermarkForResume`). That is what makes a client reconnecting to a daemon
that restarted underneath it get the new session from the top rather than
silence.

Send `resume` exactly once per connection. Each one starts another pusher loop
on the same peer, and each loop pushes the same frames.

### The build check

`session.hello` carries `build`, the daemon's `VERSION`. `joule attach`
refuses to stay attached to a daemon whose `build` is not its own exact
version, and says so rather than reaping it (`buildMismatchNotes`,
`src/daemon/attach_lifecycle.ts`): the two ends agree on the frames and not on
what they mean, and the failure that follows is a session that goes quiet
rather than an error. A third-party client is not bound to that rule, but it
is the reason the field exists, and pinning against a known daemon version is
the safe reading of it.

## Frames

Every frame has `v` (the protocol version, currently `1`), `seq` and `type`.
The remaining fields depend on the type. `PROTOCOL_VERSION` is `1` and
`isSupportedVersion` accepts only that; the daemon does not currently reject an
inbound frame on `v`, but a client should send `1`.

### What the daemon sends

| type | fields | what it means |
| --- | --- | --- |
| `session.hello` | `sessionId`, `workspace`, `session`, `model`, `mode`, `protocol`, `build` | the first frame of the log: who this daemon is, and its current model and approval mode |
| `turn.start` | `turnId`, `prompt` | a turn began; `prompt` is the submitted text verbatim |
| `text.delta` | `turnId`, `text` | a chunk of the assistant's reply, to be appended |
| `tool.call` | `turnId`, `callId`, `tool`, `args` | a tool is about to run; `args` is a JSON string |
| `tool.result` | `turnId`, `callId`, `ok`, `output`, `truncated` | that tool finished |
| `approval.request` | `turnId`, `callId`, `tool`, `summary`, `detail`, `args` | a tool needs a decision before it runs |
| `approval.settled` | `turnId`, `callId`, `summary`, `detail`, `decision`, `decidedBy` | an approval was decided without asking - the mode allowed it |
| `approval.reply.result` | `callId`, `applied`, `decision` | the outcome of an `approval.reply` |
| `turn.end` | `turnId`, `reason` | the turn is over; `reason` is `done`, `cancelled` or `error` |
| `error` | `code`, `message` | the turn failed, or a client frame was rejected |
| `mode.changed` | `mode` | the approval mode is now this, for every client |
| `model.changed` | `model` | the model is now this, for every client |
| `tasks.response` | `text` | the answer to a `tasks.request`, already formatted |
| `daemon.stopping` | `reason` | the daemon is shutting down |
| `share.started` | `code`, `url` | a relay share is up |
| `share.failed` | `error` | it is not |

### What the daemon accepts

| type | fields | what it does |
| --- | --- | --- |
| `resume` | `since` | starts the push of frames to this peer |
| `input` | `text` | submits text as if typed |
| `cancel` | `turnId` | asks the running turn to stop |
| `approval.reply` | `callId`, `decision` | answers an `approval.request` |
| `mode.set` | `mode` | changes the approval mode |
| `model.set` | `model` | changes the model |
| `tasks.request` | `arg` | lists background tasks, or cancels one |
| `share.request` | - | starts a relay share |
| `daemon.stop` | - | asks the daemon to exit |

That list is `isAcceptedInboundType` and it is exhaustive. Anything else - a
frame the daemon only sends, a type it has never heard of, malformed JSON - is
dropped and written to the daemon log, with nothing sent back. A client gets no
signal that a frame it sent went nowhere, so it is worth being sure of the
types.

### Sequence numbers

`seq` is a single counter over everything one daemon emits, starting at `1` for
`session.hello` and incrementing per frame. It is per-daemon, not per-turn and
not per-client, and it is the only thing `resume` works against, so a client
must track the highest it has seen. `hasSeqGap(lastSeq, seq)` is the check:
anything other than `lastSeq + 1` is a gap.

Frames a client sends carry `seq` too, and the daemon ignores it. Sending `0`
is what the reference client does.

### Reading a frame

The daemon does not JSON-parse an inbound frame to learn its type. `frameType`
scans the raw text for `"type"` and reads the value after it, and `frameSeq`,
`frameTurnId` and the rest do the same for their fields. So a client must emit
ordinary, correctly escaped JSON - the scanner reads escaped strings, but not
comments, and not a `seq` that is anything other than a run of digits
(`parseNonNegativeInt` falls back to `-1` for anything else, negative numbers
included).

`resume` is the exception: `since` is read by a real `JSON.parse`
(`decodeResume`), which is why `-1` works there.

## Submitting input

```json
{"v":1,"seq":0,"type":"input","text":"add a health route and run the tests"}
```

That is the whole of it. The text goes to `RelayInputBridge.offer`
(`src/terminal/relay_bridge.ts`), which calls `Session.submit` and starts a
turn. There is no separate "run" or "send" frame, and no distinction between a
person typing and a client injecting - `--prompt` on the joule side is just an
`input` frame sent right after attaching.

Input arriving while a turn is running is queued, not dropped and not
interleaved: `offer` pushes onto `pending` when the bridge is busy, and
`drainPending` submits each queued text in order as the previous turn returns.
A client can therefore send input at any time; it just may not run right away.

## The echo, and what actually happens to it

This is the part that most easily goes wrong in a new client, and it is worth
stating precisely because it is easy to get backwards.

**The daemon does not suppress anything.** `Session.submit` always emits
`turn.start` with `prompt` set to the submitted text, and the broadcast log
goes to every attached peer, including the one that sent the `input`. There is
no per-client filtering anywhere in `connection.ts`, and no flag on `input`
that changes what comes back.

So the simple client is the correct one: send `input`, then render
`turn.start.prompt` when it arrives. The text appears exactly once, and it
appears at the point in the stream where the turn actually began.

What `src/terminal/attach_echo.ts` adds is a *client-side* concern that only
exists because a terminal draws the text the moment it is typed, before the
daemon has seen it. `LocalPrompts` is a small FIFO of prompts this client has
drawn itself: `sendInput` calls `echoes.note(text)` alongside publishing the
frame, and on `turn.start` the client calls `echoes.claim(start.prompt)` -
if the claim succeeds the frame's prompt is *not* drawn, because this client
already drew it, and if it fails the prompt *is* drawn, because it came from
somewhere else.

Two things follow, and both matter to a client built against #348:

- A client that renders nothing locally should keep no ledger at all. Every
  `turn.start` it receives gets drawn, its own included, and nothing is lost.
- A client that does render locally needs the ledger, or the text appears
  twice - once from its own optimistic render and once from `turn.start`. The
  ordering matters as much as the presence: `claim` only matches at the head of
  the queue, so a prompt another client submitted in between leaves this
  client's own echo waiting rather than consuming it.

Both directions are covered by the tests in `attach_echo.ts` itself, which are
the shortest statement of the rule.

## A turn, frame by frame

From `input` to `turn.end`, what a client sees:

```
turn.start      turnId=t3  prompt="add a health route and run the tests"
text.delta      turnId=t3  text="I'll add the route first."
tool.call       turnId=t3  callId=c7  tool="edit"  args={...}
tool.result     turnId=t3  callId=c7  ok=true  output="..."  truncated=false
text.delta      turnId=t3  text="Now the tests."
approval.request turnId=t3 callId=c8  tool="run"  summary="npm test"
   -> client sends approval.reply callId=c8 decision=allow
approval.reply.result  callId=c8  applied=true  decision=allow
tool.call       turnId=t3  callId=c8  tool="run"
tool.result     turnId=t3  callId=c8  ok=true
text.delta      turnId=t3  text="Tests pass."
turn.end        turnId=t3  reason=done
```

`turnId` is `t` followed by a counter that resets when the daemon restarts. It
is on every frame belonging to the turn, which is how a client attributes text
and tool activity when more than one thing is in flight.

`turn.end` is the only reliable end. `reason` is `done`, `cancelled` (a
`cancel` frame landed, or the turn was cancelled mid-tool) or `error` (the
provider failed, or the turn hit its step ceiling). An `error` frame is emitted
before the `turn.end` that reports `error`, carrying the provider's code and
message - `E_STREAM` and `E_EMPTY_ANSWER` are the two the OpenAI-shaped
provider produces.

`turn.end` is also where the daemon persists: the subscriber in `daemon.ts`
calls `saveWorkspaceSession` on every `turn.end`, writing the history to
`sessions/<key>.json`. Nothing is persisted mid-turn. A client that wants to
harvest a workspace after a turn - #348's step 3 - has `turn.end` as its
signal, and the history on disk is consistent at that moment.

Cancelling is a `cancel` frame naming the turn:

```json
{"v":1,"seq":0,"type":"cancel","turnId":"t3"}
```

It does not stop a tool that is already running; it stops the loop from taking
another step, and the turn closes with `reason: "cancelled"`.

### Frames from background tasks

Background runs and subagents emit frames on the same socket, with a `turnId`
that is prefixed rather than a plain `t<n>`: `bg:<id>` for a background run and
`agent:<id>` for a subagent (`src/tasks/task_board.ts`). They interleave freely
with the foreground turn's frames.

A client that does not care about them can drop every frame whose `turnId`
starts with `bg:` or `agent:`. A client that does care must route them
separately, which is what `isTaskTurnId` is for in the terminal - it keeps
their text out of the main transcript and out of the plan-mode tracking. What a
client must not do is treat a `turn.end` with a prefixed `turnId` as the end of
the foreground turn.

## Approvals

Whether a tool call needs a decision is the `Gate`'s call
(`src/approval/gate.ts`), and it depends on the mode:

| mode | what it does |
| --- | --- |
| `read-only` | denies anything that is not a read |
| `auto-edit` | edits go through, commands ask |
| `safe-auto` | edits go through, commands ask unless they are classified safe |
| `full-auto` | nothing asks |
| `plan` | no tool that changes anything runs; the model plans instead |

`safe-auto` is what a daemon starts in. `full-auto` is the mode for an
environment with nobody in it (#344), and a client sets it by sending
`mode.set` after attaching - the daemon has no flag for it.

When the gate needs a person, the daemon emits `approval.request` with a
`callId`, and the turn blocks until a reply lands or 120 seconds pass. The
reply names the call and the decision:

```json
{"v":1,"seq":0,"type":"approval.reply","callId":"c8","decision":"allow"}
```

`decision` is `allow`, `deny` or `always` (allow, and stop asking for calls
like it). The daemon answers with `approval.reply.result`:

- `applied: true` - this reply decided the call.
- `applied: false` - it did not, and `decision` carries what the call was
  actually decided as. This is the cross-client case: two clients see the same
  `approval.request` and both answer, and only the first one counts. A client
  showing an approval prompt should take `applied: false` as "someone else
  answered, close the prompt and show what they chose", not as an error.

`approval.settled` is the other half of that story. When the mode allows a call
without asking, no `approval.request` is ever sent, and `approval.settled`
reports it after the fact with `decision: "allow"` and `decidedBy: "mode"`. A
client that wants to show everything the agent was permitted to do, rather than
only what it was asked about, needs to render both.

In `approval.request`, `detail` and `args` currently carry the same value - the
call's arguments (`daemon.ts`). Read `args`.

## Mode, model and tasks

`mode.set` and `model.set` are requests, and the answer is a broadcast, not a
reply. Every attached client sees `mode.changed` or `model.changed`, including
the one that asked, which is what keeps two clients agreeing about the mode.

An unknown mode gets an `error` frame with code `mode.invalid`; an empty
`mode` is ignored silently. `model.set` normalises the name for the configured
provider and reports the qualified name back in `model.changed`, so the string
a client sends and the string it gets back need not be equal.

`tasks.request` carries `arg`: empty lists the tasks, `cancel <id>` cancels
one, anything else gets a usage line. The answer is one `tasks.response` frame
whose `text` is already formatted for display.

`share.request` starts a relay share and answers with `share.started` (a
six-character `code` and a `url`) or `share.failed`.

## Detaching, and a peer that goes away

There is no `detach` frame. A client detaches by closing the websocket, and it
should close it cleanly - `DaemonClient.detach` sends a websocket close with
status 1000 and waits up to 600ms for its receive loop to wind down.

On the daemon side, `daemonOnClose` writes a close marker into that
connection's inbox. The next drain seals the inbox, and the drain after that
removes the file if it has not grown in between - the two-step reap that keeps
a frame arriving in the same tick as the close from being lost (#164). The
peer's pusher loop is a `while (peer.open)` and exits on its own once the peer
is gone (#160).

Nothing else happens. The session keeps running, an in-flight turn runs to
completion, and its frames keep appending to the broadcast log with nobody
reading them. A client that reconnects with `since` set to its last `seq` gets
everything that happened while it was away. This is the property #348's lazy
start and idle reaping depend on: the daemon's liveness is not tied to any
client's.

The daemon does log when a frame it emitted could not be written for any
attached client to see, which is worth knowing when reading a daemon log that
looks like it lost something.

To stop the daemon rather than leave it, send `daemon.stop`. It broadcasts
`daemon.stopping` with a reason, then exits after a 400ms grace period, in
which the last frames still go out. Clients should treat `daemon.stopping` as
final and stop reconnecting - any client can send `daemon.stop`, so the one
that receives `daemon.stopping` is not necessarily the one that asked.

## What the daemon never sends

`notice` is in the frame set and the daemon never emits one. Every `notice`
that exists is manufactured locally by a client, about its own connection, and
injected into its own stream so it renders like any other frame:
`daemon.unreachable` when the socket has been down long enough to be worth
mentioning, `daemon.buffer_overflow` when frames queued while disconnected were
dropped (`attach_client.ts`), plus the `relay.*` codes on the relay path. A
third-party client will never receive one over the wire, and is free to use the
type the same way for its own diagnostics.

## The shortest client that works

Everything above, as a checklist:

1. Compute `sessionKeyFor(workspaceRoot, sessionName)`; read
   `~/.config/joule-code/daemon/<key>.json` for the port.
2. Open `ws://127.0.0.1:<port>/attach/<uuid>/ws`.
3. Send `{"v":1,"seq":0,"type":"resume","since":-1}`.
4. Read `session.hello`; check `workspace` and `session` are the ones you
   meant, and decide what to do about `build`.
5. Send `{"v":1,"seq":0,"type":"mode.set","mode":"full-auto"}` if nobody is
   there to answer approvals.
6. Send `{"v":1,"seq":0,"type":"input","text":"<the task>"}`.
7. Track the highest `seq` seen. Accumulate `text.delta` by `turnId`, render
   `turn.start.prompt`, show tool activity if you want it.
8. On `turn.end` with a `turnId` that is not `bg:`- or `agent:`-prefixed, the
   turn is done and the history is on disk. Harvest the workspace here.
9. Close the socket to detach. Reconnect with `since` set to the highest `seq`
   seen, and nothing is missed.

The parts a first attempt usually gets wrong are 3 (no `resume`, no frames,
ever), 7 (drawing a prompt twice, or not at all, depending on which way the
echo was assumed to work) and 8 (mistaking a background task's `turn.end` for
the turn's).
