# #139 spike: can the agent loop move into a headless daemon

## The honest summary

State extraction works, in the sense that matters most: `Session`, `Gate`,
`LiveProvider` and `ToolsRegistry` already have no hidden dependency on being
in the same process as a terminal. A real daemon built from the real classes,
serving a real websocket, ran a real turn against a real model with no tty
anywhere in the process - proven live, not inferred. That is the good news.

The bad news outweighs it for now. Two things block this today, and neither
is a design problem in this codebase:

1. **The toolchain cannot currently compile the combination this ticket
   asks for.** `Session` + `Gate` + `LiveProvider` + `ToolsRegistry`, wired
   together exactly the way `terminal.ts` already ships them, fails native
   codegen with `ambiguous reference` the moment the same compilation unit
   also imports `vendor/websocket/server.ts`'s `serveWebSocket`. Every piece
   compiles fine alone or in smaller combinations; only this specific,
   necessary combination fails. Filed as
   [lumen-lang-org/lumen#29](https://github.com/lumen-lang-org/lumen/issues/29)
   with a minimal repro. This is not a workaround-with-effort situation the
   way #13's inline-arrow trick was - restructuring the calling code (single-
   purpose helper functions, nested structs so no statement names more than
   two class instances, moving the blocking call into its own near-empty
   function) did not move the needle once `ToolsRegistry` (or even just
   `dispatchCoreTool`, bypassing the class) joined the graph.

2. **`net.createServer`'s concurrency fix (lumen#11) shipped without the
   thread-safety that made the old serialization safe to remove.** A shared
   `Map` or array touched from two connections' handler threads now silently
   loses updates under light contention and crashes the process outright
   under heavier contention - reproduced directly, with a bare `Map<string,
   int>`, no daemon code involved. This is the exact hazard
   [lumen-lang-org/lumen#12](https://github.com/lumen-lang-org/lumen/issues/12)
   already documented for `http.createServer`, now shown (new evidence added
   to #12) to also apply to `net.createServer` as of v0.6.3, which is what
   the relay's own WS listeners are built on specifically because
   `net.createServer` used to be safe from this. **A second client attaching
   concurrently is not merely "the interesting case to test" - it is the
   scenario that breaks a naive daemon on the current runtime.**

Given both of those, the honest recommendation is: **this is larger than it
looked from the ticket.** Not because the architecture is wrong - the frame
protocol, the separation of `Session`/`Gate`/tools from the terminal, and the
already-shipped approval-reply idempotence (#136) all turned out to be
exactly as daemon-ready as hoped. It is larger because the runtime underneath
does not yet support running it safely, and one of the two blockers (the
compile failure) cannot be worked around from application code at all.

## Setup

Everything below ran on a fresh v0.6.3 (`gh release download v0.6.3`, not the
box's ambient toolchain, to rule out a stale local build - `lumen --version`
is unreliable, see lumen#24) against `joule-sh/code` at `31e9a6f` (main,
"Fix the approval-reply race between a paired browser and the terminal
(#138)"), in an isolated clone.

## Question 1: does state extraction work?

Yes, empirically, for the part that could be made to compile. `src/daemon/
daemon_live_demo.ts` constructs the real `Session`, `Gate` (with its real
~120s approval-wait poll loop) and `LiveProvider` exactly the way `terminal.ts`
does, subscribes a broadcast function instead of a scrollback renderer, and
serves it over a real websocket accept loop built on the same vendored
`packages/websocket` the relay uses. No tty, no `vendor/tty` import beyond
what `LiveProvider`'s `CancelWatch` already needed (and that polls a
harmless closed fd in this process). A client speaking exactly the frames
spec 001 already defines - reusing `scripts/miniws.mjs` from the #134 spike,
because rewriting a second hand-rolled websocket client would have been
pointless - connected, sent `resume`, got `session.hello`, sent `input`, and
received a real `text.delta`/`turn.end` sequence from a real DeepSeek
response. See `scripts/spike_139_daemon_check.mjs`.

`Session.submit()` itself (`src/session/session.ts`) never assumed a
terminal: it takes a `Provider`, a `ToolRegistry` and an `ApprovalGate` as
interfaces, holds its own `history`/`subscribers`, and reports everything
through `emit()`. `Gate.check()`'s `onRequest`/`onPoll` callbacks are already
injected, not hardcoded to terminal UI - the daemon supplies its own
(`onApprovalRequest` emits a frame instead of writing to scrollback;
`onApprovalPoll` is a no-op, because there is no keyboard to poll and the
relevant activity - an `approval.reply` frame arriving on some other
connection - already flows through `dispatchInboundFrame`, not through the
poll callback). None of this needed changing to work outside a terminal.

What did NOT extract cleanly is tool dispatch, but not for a design reason -
see lumen#29 above. `ToolsRegistry` (`src/tools/registry.ts`) and even the
bare `dispatchCoreTool` free function it wraps (`src/tools/dispatch.ts`,
which pulls in `child_process.spawnSync` via `tools/run.ts`) cannot currently
be compiled into the same binary as `vendor/websocket/server.ts` alongside
`Session`/`Gate`/`LiveProvider`. `daemon_live_demo.ts` stubs tool execution
(`stubToolRun` returns a canned result) specifically to route around this and
still prove the session/frame half end to end. `src/daemon/daemon.ts` is the
real, intended wiring - it fails to compile today with exactly lumen#29's
error, left in the tree deliberately so the shape of the intended real daemon
is visible rather than only its stub.

**Verdict: the extraction is clean at the design level. The toolchain does
not yet let you build the binary.**

## Question 2: can a second client attach concurrently and see consistent state?

This is what lumen#11 was supposed to unblock, so it was exercised directly
rather than assumed - and the answer is: it unblocks the *connections*, not
*safe shared state*.

Isolated first, deliberately without any of this codebase's own code, to
rule out anything specific to `Session`/`Gate`: a bare `net.createServer`
handler touching a shared `Map<string, int>` (`docs/00-plan.md`'s own
description of the `http.createServer` version of this, adapted to
`net.createServer`).

- 10 concurrent connections, light contention (300 map operations each, a
  couple of milliseconds of sleep sprinkled in): no crash, but the map lost
  updates. Expected total 3000, got 2983. Individual connections' own counts
  came back short (288, 299, instead of exactly 300 every time). Confirmed
  the ten handlers genuinely overlapped in time (timestamped logs, all ten
  `START` lines within the same millisecond) rather than being silently
  serialized - this is real concurrent thread-pool dispatch, not a
  coincidence.
- 20 concurrent connections, heavier contention (3000 operations each, no
  sleeps): a real crash. `runtime error: index out of bounds: index 12, len
  12` inside `Map.get`, taking the whole process down mid-request (remaining
  connections got `ECONNRESET`). Same failure family lumen#12 already
  documented for `http.createServer` (a segfault inside the hashmap's own
  `eql`), reproduced here through `net.createServer` for the first time -
  added as new evidence to lumen#12 rather than filing a duplicate, since
  it's the same root cause reappearing through a route #12's own text said
  didn't need to be checked ("no `net.createServer` at all" - that was true
  before #11 shipped).

This directly answers the architectural question underneath Q2: `Session`
holds `subscribers: Subscriber[]` and `history: Message[]` as plain mutable
arrays, exactly the shape that crashed above. A daemon that lets
`net.createServer`'s thread pool call into `Session`/`Gate`/a peer list
directly - which is the natural, obvious way to write it, and is what
`daemon_live_demo.ts` and `daemon_ws.ts` currently do - is one unlucky
scheduling decision away from the same crash the moment two clients are
concurrently active. The live demo survived two clients sending input
around the same time (see the Q1 test transcript), but that is exactly the
"lucky" case the standalone repro above shows is not guaranteed - two clients
is not enough load to reliably trigger the corruption, twenty-plus rapid
connections is.

**What would actually fix this**, and is not itself compiler-blocked: this
codebase already has the pattern for it, used everywhere state needs to
cross a thread boundary safely - `src/tasks/mailbox.ts`'s
append-only-file mailbox, exactly what `src/relay/client_worker.ts`'s
`receiveLoop` and every background-task/subagent worker already use. A safe
daemon would let `net.createServer`'s thread pool own connection I/O only
(reading raw frames off the socket, writing outbound frames back), and
funnel every inbound frame through a mailbox file into a single thread that
alone ever touches `Session`/`Gate`/the peer list - the same discipline
`RelayInputBridge` already half-imposes for input ordering, generalized to
mutation safety, not just ordering. This was not built in this spike (the
compile blocker made it moot to also chase a second unproven architecture
before the first one can even build with real tools), but it is a concrete,
precedented next step, not a hand-wave.

**Verdict: lumen#11 unblocked concurrent connections. It did not make
touching shared session state from them safe, and nothing in this codebase
does that today. This is the single most load-bearing finding of the spike.**

## Question 3: where does the workspace boundary land?

Unchanged, and that turns out to be exactly right rather than an oversight.
`jail()` (`src/tools/jail.ts`) resolves a path against `workspaceRoot` via
`realpathSync` and refuses anything that doesn't land under it - checked
directly:

```
jail(root, 'inside.txt')                              ok=true
jail(root, '../jail-check-outside-secret.txt')         ok=false
jail(root, '../../../../../../etc/passwd')              ok=false
dispatchCoreTool(root, "read", {path: "../...secret"}) ok=false, "path escapes the workspace root"
dispatchCoreTool(root, "read", {path: "/tmp/...secret"}) ok=false, "no such file" (absolute path never resolves under root)
```

None of this is client-aware - `jail()` has no idea whether the tool call
that reached it originated from a keystroke at the terminal or an `input`
frame from a browser three time zones away, and it does not need to, because
the frame vocabulary itself is the first boundary: a client (spec 001 rule
5) can only ever send `input`, `cancel`, `approval.reply` and `resume` - it
cannot name a tool or a path directly. Whatever it types becomes a prompt;
the model decides what tool calls to make; `jail()` clamps where those calls
can touch. That chain does not change by moving the loop into a daemon,
because none of it currently depends on being colocated with a keyboard -
it depends on being colocated with the filesystem, which the daemon still
is.

The one thing that *does* matter and is worth stating plainly: `Gate.check()`
never asks for approval on `read`/`list`/`grep` in any mode (`isReadTool()`
short-circuits to `{allow: true}` before the mode switch even runs). `jail()`
is not one layer of defense for reads, it is the *only* layer, in the
terminal today and in a daemon tomorrow. That was already true before this
ticket; a daemon does not make it more or less true, but it does mean a
remote-attach story sharpens the stakes on `jail()` staying correct.

**Verdict: the boundary is exactly where it already was, because tools were
never client-aware to begin with. This is not a gap the daemon opens - it is
a property the daemon inherits unchanged.**

## Question 4: what does startup and lifecycle look like?

Built and tested in isolation: `src/daemon/lifecycle.ts` writes/reads a
small JSON info file (`~/.config/joule-code/daemon/<workspace-key>.json`,
reusing `sessionKeyFor()` from `session/persistence.ts` rather than
inventing a second hashing scheme) recording which port a workspace's daemon
is listening on. Verified directly - write, read back, remove, confirm gone:

```
wrote and read back: port=8199 workspace=/tmp/some-workspace
info path: .../daemon/-tmp-some-workspace-22bd91d01c9244b4.json
spawn args: -c cd /tmp/some-workspace && JOULE_DAEMON_PORT=8199 nohup bin/joule-daemon >... & disown
after removal, info is null: true
```

This is the "attach if one is running" half. The "spawn if none is running"
half hits a real, already-documented platform gap: Lumen's `child_process`
has no way to detach a spawned process from its parent (no `kill()`, `close()`
blocks in `wait()` until the child exits - spec 450, lumen#6, the exact
reason `docs/00-plan.md`'s own `#12` landing notes says the e2e test harness
had to be a standalone Node script instead of `lumen test`). A terminal
cannot use Lumen's own `child_process.spawn` to launch a daemon that outlives
it. The workaround that does work, and is what `daemonBinaryArgs()` above
already builds: shell out through `/bin/sh -c 'nohup ... & disown'`, so the
*shell* backgrounds the real daemon and exits immediately, and
`spawnSync` only ever waits on that fast-exiting shell, never on the daemon
itself. This is not a new problem the daemon introduces; it is the same gap
this codebase already routed around once, applied a second time.

Who owns shutdown was not resolved, and is worth naming as an open question
rather than guessing: unlike `RelayClient`'s attach (which explicitly
`detach()`es and lets the relay keep the session for reconnect), nothing
built here decides whether the daemon should die when its last client
disconnects (fragile - a single network blip would kill an otherwise-healthy
session) or persist until explicitly stopped (which needs a `/daemon stop`
or equivalent nobody designed). Given #85 persistence already writes the
session to disk on every turn end regardless of which process is running it,
outliving any one client is clearly the right default; an explicit stop path
is the piece this spike did not get to.

**Verdict: attach-if-running is built and works. Spawn-if-absent has a real
but known, already-routed-around platform gap, not a new one. Shutdown
ownership is a genuine open question, not an oversight - it needs a decision,
not more spike code.**

## Question 5: what actually breaks

Tested and read, not predicted - here is what resists the move and what
doesn't, and why.

**Session resume (#85): does not resist it.** `saveWorkspaceSession()` /
`loadWorkspaceSession()` (`src/session/persistence.ts`) write plain JSON to
`~/.config/joule-code/sessions/<key>.json`, keyed by a hash of
`workspaceRoot`, with no reference to a process, a terminal, or a tty
anywhere in the file format or the read/write path. `daemon.ts`'s intended
wiring (blocked only by lumen#29, not by anything in persistence.ts itself)
loads it as history on startup and saves it on every `turn.end`, identically
to how `terminal.ts` already does. This was already daemon-shaped before
this ticket.

**Memory (#118): does not resist it, same reason.** `memory.ts`'s
`loadUserMemoryText()`/`addMemoryEntryText()` read/write
`~/.config/joule-code/memory.json`, per-user by virtue of being under `$HOME`,
with no session or process affinity at all. A daemon reads it the same way
`terminal.ts` does at startup.

**The approval gate (#136's two-answer resolution): does not resist it - it
already speaks the daemon's own language.** `Gate.reply()` is
already idempotent (first reply wins; a second reply to the same `callId`
returns `false` rather than double-applying), and `relay_bridge.ts`'s
`dispatchInboundFrame` already turns a losing `approval.reply` into an
`APPROVAL_REPLY_RESULT` frame telling the late replier what actually
happened. This exists *today*, in the shipped terminal, specifically because
a keyboard-driven approval and a relay-forwarded browser approval already
race against the same `Gate` in the current one-terminal-one-browser design.
A daemon with N clients replying to the same approval is the identical race
with a bigger N, not a new kind of problem - #136 already solved the general
case, not just the two-party one.

**Background tasks and subagents (#77): likely resist it, but for the same
reason tool dispatch does, not a new one.** `TaskManager`
(`src/tasks/manager.ts`) constructs `BackgroundRunTask`/`SubagentTask`
objects via `Worker.run` + the exact mailbox-file mechanism already argued as
the *fix* for Q2's concurrency hazard, which is a point in its favor - but
`subagent_worker.ts` and `background_run.ts` both spawn through
`child_process.spawn`, the same stdlib surface that made `dispatchCoreTool`
alone (without the `ToolsRegistry` class wrapper) trip lumen#29 when combined
with `vendor/websocket`. This was not separately compiled and tested in
isolation - once the tools half already failed to compile, chasing a second,
larger unproven combination stopped being useful - but the evidence points
at the same compiler wall, not a design problem specific to tasks. Worth
retesting once lumen#29 has a fix or workaround, not worth re-deriving from
scratch.

**What genuinely surprised: nothing in the agent-loop *design* resisted the
move.** Every piece that failed, failed at the compiler, not at the API
boundary between "session logic" and "terminal logic" - that boundary was
already drawn correctly, apparently as a side effect of this codebase's own
450-line-file discipline forcing real separation of concerns from day one
rather than as something this ticket had to discover.

## The relay-overlap question

Sitting beside the relay is not a real option, said plainly: `SessionStore`
and `PeerRegistry` (`src/relay/store.ts`, `src/relay/ws.ts`) are built
around exactly one terminal peer and one browser peer per session -
`registry.terminals.set(sessionId, peer)` and `.browsers.set(sessionId,
peer)` are last-writer-wins `Map`s, a deliberate v0 scope decision
(`docs/00-plan.md`: "sufficient for v0's one-terminal-one-browser-per-session
scope"). A daemon's entire premise is N concurrent clients on one live
session - a browser tab, the TUI, an editor, maybe a second browser tab. The
relay's data model cannot become "N clients" without becoming, structurally,
the same peer-list-plus-broadcast shape `daemon_store.ts` already is. "Two
things that both multiplex sessions" is exactly the bad end state the ticket
worried about, and building the daemon beside the relay unmodified is
precisely that.

Subsuming is closer to right but not free: `src/relay/relay.ts`'s pairing
flow (`POST /sessions` mints a `secret`, a short pairing `code`, and expires
it after ten minutes - spec 002) is doing something a same-machine daemon
attach does not need at all (there's no cross-machine trust boundary to
broker when the client and the tool execution are the same box), but a
daemon reachable from `joule.sh` the way the relay is today still needs
*something* playing exactly that role for a client that isn't local. The
honest shape: the daemon becomes the thing that owns the session and serves
frames to attached peers - what the relay's `SessionStore`/`PeerRegistry`
do today, generalized past one-per-role - and the relay's pairing/auth
surface (`POST /sessions`, `POST /pair`, the code TTL, rate limiting) becomes
the thing that authenticates a *remote* attach to that daemon, not a second,
parallel multiplexer sitting in front of it. Concretely: **replaces the
relay's frame-forwarding role, keeps (and narrows) the relay's pairing/auth
role.** That is a real redesign of `src/relay/`, not an addition beside it,
and it was not attempted in this spike - naming the shape correctly seemed
more valuable than a rushed, incomplete cut at it, especially with Q2's
concurrency hazard still unresolved underneath both the daemon and the
relay's own existing WS listeners.

## Lumen bugs filed this spike

- [lumen-lang-org/lumen#29](https://github.com/lumen-lang-org/lumen/issues/29) -
  new. `Session` + `Gate` + `LiveProvider` + `ToolsRegistry` combined with
  `vendor/websocket/server.ts`'s `serveWebSocket` in one compilation unit
  fails native codegen with `ambiguous reference`, blocking this ticket's
  entire premise at the compiler level.
- [lumen-lang-org/lumen#12](https://github.com/lumen-lang-org/lumen/issues/12) -
  new evidence added, not a new issue. The `Map`-across-thread-pool-workers
  segfault already documented for `http.createServer` now reproduces through
  `net.createServer` too, now that lumen#11 shipped - directly relevant
  because that's what the relay's own WS listeners, and any daemon, are
  built on.

## What to build next, if this is picked back up

1. Get lumen#29 fixed or find a real workaround (not attempted further here
   - every restructuring tried in this spike failed once `ToolsRegistry`
   joined the graph, which suggests it needs an upstream fix rather than a
   cleverer caller).
2. Build the mailbox-marshalled daemon architecture described under Q2
   before trusting any daemon with more than one client - the naive shape
   this spike's own code defaults to is now known to crash, not just
   theorized to.
3. Decide daemon shutdown ownership (Q4) as an explicit design decision.
4. Design the relay's narrowed pairing-only role (the relay-overlap section)
   as a real ticket, not an afterthought bolted onto the daemon work.
5. Only then attempt the TUI-as-client change - deliberately not attempted
   in this spike, because the daemon side needs to compile with real tools
   and be safe under concurrency before there is anything worth attaching
   to. `src/relay/client.ts`/`client_worker.ts`'s already-proven
   `Worker.run` + mailbox connection pattern is the right starting point
   when that day comes - reuse it for a same-machine daemon attach, not a
   third implementation of the same idea.
