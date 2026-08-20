# Spec 001: one vocabulary, three processes

## What is true today

Nothing is built. What constrains the answer is that three processes written at
three different times must agree: the terminal (Lumen binary, on someone's
machine), the relay (Lumen binary, on a server), and the page (JavaScript, in a
browser that was loaded whenever it was loaded).

They will not be at the same version. The terminal is installed by a person and
updated when that person feels like it; the relay is deployed; the page is
whatever the browser cached. Any design that assumes all three move together is
wrong on the first day someone does not upgrade.

## What other systems decided

**The Language Server Protocol** got the important thing right and one thing
wrong. Right: a single document defining every message, with the server
announcing capabilities so a client never guesses. Wrong: it grew method
namespaces and optional fields until "does this server support X" became a
runtime maze. The lesson is to keep the vocabulary small enough to hold in your
head, and to make the version a single number rather than a capability matrix.

**The Chrome DevTools Protocol** shows the other failure: a domain-per-feature
sprawl where the transcript of a session is not something you can read. If you
cannot tail the frames and understand what happened, you cannot debug the
distributed part, and the distributed part is the whole product here.

**Server-Sent Events** contributes the piece worth copying outright: an event
carries an `id`, and a client that reconnects sends `Last-Event-ID` to resume.
Resumption is not an extra feature bolted on; it is the same field the transport
already carries. Our `seq` is that field.

## What this adds

One module that nothing else imports from, defining every frame. Both binaries
and the page read their frame names from it, so a name is never spelled twice.

Terminal to everyone:

| frame | payload |
| --- | --- |
| `session.hello` | `sessionId`, `workspace`, `model`, `mode`, `protocol` |
| `turn.start` | `turnId`, `prompt` |
| `text.delta` | `turnId`, `text` |
| `tool.call` | `turnId`, `callId`, `tool`, `args` |
| `tool.result` | `turnId`, `callId`, `ok`, `output`, `truncated` |
| `approval.request` | `turnId`, `callId`, `tool`, `summary`, `detail` |
| `turn.end` | `turnId`, `reason`: `done` \| `cancelled` \| `error` |
| `error` | `code`, `message` |

Browser to terminal — and this list is exhaustive, which is the point:

| frame | payload |
| --- | --- |
| `input` | `text` |
| `cancel` | `turnId` |
| `approval.reply` | `callId`, `decision`: `allow` \| `deny` \| `always` |

Three frames inbound. A browser cannot name a tool, cannot set a mode, cannot
reach the filesystem. Whatever the page is talked into sending, the worst it can
do is what a person sitting at the terminal could do — ask, cancel, or approve
something the terminal itself proposed.

Every frame carries `v` (protocol version) and `seq` (monotonic per session,
assigned by the terminal). `seq` is what `?since=` resumes from, and it is
assigned by the terminal because the terminal is the only participant that sees
every frame in order.

## The rules

1. **An unknown frame type is ignored, not fatal.** A relay that rejects a frame
   it does not recognise is a relay that must be upgraded before a terminal can
   be. It forwards what it does not understand.
2. **A newer `v` is ignored with a warning, never guessed at.** Best-effort
   parsing of a format you do not know produces a session that half works, which
   is worse to debug than one that refuses.
3. **The terminal assigns `seq`, and never reuses one.** A consumer that sees a
   gap knows it missed something and can ask for it.
4. **No frame carries a whole file.** `tool.result.output` is capped and sets
   `truncated`. A relay buffer sized for transcripts must not be sized for file
   contents, and a phone on cellular must not download a repository.
5. **The three inbound frames are the entire attack surface from the browser.**
   Adding a fourth is a decision this spec has to be amended for, not a patch.
6. **A frame is readable in a log.** JSON, one per line, names that say what they
   are. Debugging the distributed part means reading the tape.

## Deliberately not in scope

**Binary framing and compression.** Text deltas are small and SSE is text.
Revisit when a transcript is measurably the bottleneck, which it will not be at
v0 volumes.

**Capability negotiation.** A single integer `v` with the ignore rules above
covers the mismatch that actually happens. LSP's maze is what the alternative
grows into.

The consequence, recorded: because there is no negotiation, a terminal that
gains a frame type gets no signal that the page cannot render it. The page shows
a placeholder for unknown frames rather than nothing, so the gap is visible to a
person even though it is invisible to the protocol.
