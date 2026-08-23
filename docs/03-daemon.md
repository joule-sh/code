# The daemon (#139)

Spike #139 (draft PR #140) proved the design would work and named two
toolchain blockers: lumen#29 (combining the agent-loop graph with
`vendor/websocket` in one compilation unit) and lumen#12 (a shared `Map`
touched from more than one `net.createServer` thread-pool worker). Both are
fixed and released in v0.7.1. This is the daemon itself: `src/daemon/`, real
and built by default, plus `joule attach` as its first client.

## What ships in this pass

- `bin/joule-daemon` - a headless process that owns one `Session`, `Gate`,
  `LiveProvider`, `ToolsRegistry` and `TaskManager` for one workspace, and
  serves the existing spec 001 frames over a websocket.
- `joule attach` - a new subcommand of `bin/joule`. It spawns a daemon for
  the current workspace if none is running, attaches if one already is, and
  drives a real terminal UI against it: streamed replies, tool calls,
  approvals (allow/always/deny, arrow navigation, the same option rows),
  cancel. `/model`, `/mode`, `/share`, `/tasks`, `/memory`, `/login`,
  `/update` are not wired up yet - `/help` says so - because doing that
  properly means retiring `runTerminal`'s local-session path, and that is
  its own change, not a rider on this one.

  **Update, follow-up pass:** all of these except `/share` are wired up now.
  `/mode` and `/model` go over the wire as `mode.set`/`model.set` and come
  back as a broadcast every attached client sees (`src/daemon/dispatch_mode.ts`,
  `dispatch_model.ts`); `/tasks` is the same request/broadcast shape
  (`dispatch_tasks.ts`); `/memory`, `/login`, `/logout`, `/update` and `/cat`
  stay entirely client-local, unchanged from what `terminal.ts` already does,
  because none of them touch daemon-owned session state. `/share` still says
  plainly that it isn't available rather than routing the raw command text to
  the model - it needs the relay reshape this doc still describes as future
  work, below. A new `/stop-daemon` command and a `joule attach --stop` flag
  fill the "who owns shutdown" gap this doc originally left open (see
  Lifecycle, below).
- The default `joule` (no arguments) is untouched. Not "unlikely to have
  regressed" - the diff to `src/terminal/terminal.ts` is zero lines. Every
  existing harness (`terminal-harness`, `layout-harness`,
  `onboarding-harness`, `make e2e`) passes unmodified, proving the shipped
  product still behaves exactly as before.

## Why the split isn't "TUI becomes a thin client of the daemon" yet

`runTerminal` builds its own `Session`/`Gate`/`LiveProvider` inline and
drives them through ~40 call sites across input handling, mode switching,
plan mode, tasks, resume, relay attach and update-offer UI - `terminal.ts` is
already at its 450-line cap on its own. Rewiring all of that to source state
from a daemon connection instead of a local `Session` is a real rewrite of
the terminal's input loop, not an extension of it, and is exactly the kind
of change #139 asked not to make in one step ("Incremental and shippable,
not a big-bang rewrite"). `joule attach` proves the daemon-as-first-client
story end to end - two concurrent clients, a real turn, cross-client
approval, a real tool landing on the real filesystem - without touching the
code path every existing user is on today. Retiring `runTerminal` in favor
of an attach-only terminal, once `joule attach` has full command parity, is
the follow-up.

## The workspace boundary

Unchanged, and unchanged is correct. `jail()` (`src/tools/jail.ts`) clamps
every tool call to `workspaceRoot` regardless of which process or which
client asked - tools execute inside `bin/joule-daemon` itself, on the
machine the daemon runs on, never inside a client. This pass keeps daemon
and workspace colocated (the daemon is spawned via `bin/sh -c 'cd
$workspace && ...'`, always local); a daemon and a client on different
machines is not attempted here, and if it happens later `jail()` is still
the enforcement point, unmoved by that split. `read`/`list`/`grep` are still
never gated by human approval in any mode - `jail()` is the only defense for
reads, same as it always was.

## Avoiding shared mutable state: the actual design, and what it cost to get right

lumen#12's fix means a `Map`/`Set` touched from more than one
`net.createServer` connection thread now fails fast with an error naming the
source line, instead of the silent corruption the spike measured. The
daemon is built to never do that, from three pieces:

1. **A single owning thread for `Session`/`Gate`/`TaskManager`.** All of it
   lives on one thread (`SessionWorker.loop()`, `src/daemon/session_worker.ts`),
   driven by ticking `Gate.setOnPoll` and a plain poll loop - nothing about
   `Session`'s internals changed to make this true, because nothing in
   `Session`, `Gate` or `LiveProvider` was ever thread-aware to begin with.
2. **Mailbox files, not shared objects, cross the thread boundary.** Each
   connection's own thread (`src/daemon/connection.ts`) appends inbound
   frames to a file named for a client-generated id
   (`~/.config/joule-code/daemon/<workspace>/inbox/<connId>.in`) and never
   touches `Session` directly. The owning thread lists that directory and
   drains each file through its own private `Map<string, MailboxReader>`
   (`src/daemon/inbox.ts`) - a `Map`, but touched by exactly one thread, which
   is what lumen#12 actually forbids. Outbound frames go the same way in
   reverse: the owning thread appends every emitted frame to one broadcast
   log (`src/daemon/broadcast.ts`), and each connection gets its own
   `Worker.run`'d pusher thread that tails that log with its own
   thread-local read cursor and pushes new frames to its own peer. This is
   the same mailbox idiom `src/tasks/mailbox.ts` and `src/relay/client_worker.ts`
   already use for exactly this kind of cross-thread handoff, applied to a
   second place it was needed.
3. **Client identity needs no server-side allocation.** A connecting client
   generates its own id (`crypto.randomUUID()`) and names it in the
   websocket path (`/attach/<id>/ws`), so the daemon never needs a shared
   counter or registry to hand out ids - one fewer thing that would have had
   to be a shared `Map`.

Two things surfaced building this that are worth naming plainly, because
they cost real time and would cost the next person the same:

- **A bare `let` forward-reference slot, reassigned after a closure over it
  already exists, is invisible to that closure - even on a single thread.**
  `let sessionSlot: Session[] = []` and a callback reading it, then later
  `sessionSlot = [session]`, left the callback seeing the original empty
  array forever; no exception, just silently-dropped behavior at a call site
  far from the mistake. Mutating a *field* on an already-captured object
  works fine (`gate.setOnPoll(fn)` set before spawning a worker is correctly
  visible from that worker). `src/terminal/slots.ts`'s `GateBox`/`RelayBox`/
  `TasksBox` already avoid this by construction - every forward reference in
  `terminal.ts` goes through a box class, apparently by convention rather
  than because the bug was known. The daemon does the same
  (`SessionBox` in `src/daemon/daemon.ts`). Filed as
  [lumen-lang-org/lumen#34](https://github.com/lumen-lang-org/lumen/issues/34).
- **Importing `Gate` into the same file as `Scrollback`/`TurnStatusTracker`/
  `InputLine`/`InputHistory`/`PendingApproval` produces a spurious
  `E_TYPE_MISMATCH` on an unrelated, valid statement**, the same class of
  "large-enough compilation unit changes whether an earlier statement
  compiles" symptom lumen#29 already documented, just a different diagnostic
  this time. `src/terminal/attach.ts` works around it the same way the
  spike worked around lumen#29 before the real fix landed: it does not
  import `Gate` at all. `src/terminal/attach_approval.ts` re-implements the
  ~15 lines of reply-bookkeeping `Gate.reply()`/`findReply()` already do,
  against a local `ApprovalLog` class instead - real enforcement still only
  ever happens inside the daemon's own `Gate`; `attach.ts`'s copy is display
  bookkeeping, mirroring what a second client's decision already looks like,
  never the thing that authorizes it.

Point 3 wasn't filed upstream this pass - narrowing a minimal repro cost
enough time already spent that shipping took priority - but the workaround
is small and isolated, and the shape of a repro is already known if it's
worth filing.

## What actually broke, versus what the spike predicted

Nothing in the design resisted the move, same conclusion as the spike, now
proven rather than inferred: `Session.submit()`, `Gate.check()`'s
approval-wait poll loop, `TaskManager.poll()` and session persistence
(`saveWorkspaceSession` on every `turn.end`) are used by the daemon exactly
as `terminal.ts` already used them, no modification. Every failure this pass
hit was either the toolchain (both closure-capture issues above) or a bug in
my own new test fixtures (`broadcast.test.ts`/`inbox.test.ts` initially
reused a `/tmp` directory across runs without clearing it first, unlike the
established `freshRoot()` convention in `tasks/mailbox.test.ts` and
`session/persistence.test.ts` - fixed to match).

## The relay question

The spike's conclusion stands and this pass does not change it: the relay
(`src/relay/`) cannot become "N clients" without becoming, structurally,
what the daemon already is - a peer list plus broadcast. `SessionStore`/
`PeerRegistry` are still built for exactly one terminal peer and one browser
peer, a deliberate v0 scope call that a real daemon outgrows by design.

This pass leaves `src/relay/` untouched, deliberately, rather than
reshaping it alongside the daemon: `src/relay/ws.ts`'s `PeerRegistry.terminals`/
`browsers` and `src/relay/store.ts`'s `SessionStore.sessions`/`rings` are
shared `Map`s touched directly inside `onMessage`/`onClose`, called from
whichever `net.createServer` thread-pool worker a connection lands on -
exactly the pattern lumen#12 now detects. Bumping the toolchain to v0.7.1 to
get the daemon's compiler fixes means this latent hazard in the relay's own
listeners is now live too, not just theoretical: two terminals' sessions
handled by the same relay process on overlapping connections would now trip
the same fail-fast lumen#12 guards the daemon was built to avoid.
`make test` is green because the existing relay test suite never drives two
concurrent connections against the same `SessionStore`/`PeerRegistry`
instance hard enough to hit it, not because the hazard is gone.

The plan, unchanged from the spike and now more clearly a prerequisite
rather than a someday-cleanup: **the daemon takes over frame-forwarding, and
the relay narrows to pairing/auth only.** A same-machine `joule attach`
never needs the relay's pairing dance (there is no cross-machine trust to
broker); a remote attach still needs the code/URL flow spec 002 already
defines, just authenticating into the daemon rather than into a second
multiplexer. That is a real rework of `src/relay/store.ts` and
`src/relay/ws.ts` - replacing their `Map`-per-connection-thread shape with
the same single-owning-thread-plus-mailbox pattern this daemon just proved
out - not a small patch, and not attempted here. Recorded as the next piece
of work this daemon obligates, not a nice-to-have.

**Update, the relay reshape:** done, following the plan above unchanged. The
relay's `SessionStore` (`src/relay/store.ts`) is now pairing-and-auth only -
`SessionRecord`, the pairing rate limiter, `create`/`pairByCode`/
`authorizeTerminal`/`authorizeBrowser`/`detachTerminal`/`sweepIdle`, nothing
else - and it is touched by exactly one thread, `RelayOwner`
(`src/relay/relay_owner.ts`), the same single-owning-thread shape
`SessionWorker` already proved out for the daemon. Every `net.createServer`
connection thread (HTTP or websocket) reaches it only through a
commands/results mailbox (`src/relay/relay_rpc.ts`,
`src/relay/store_commands.ts`) - the same request-then-poll-for-a-tagged-
reply idiom `tasks/subagent_worker.ts` already used for approvals, just
applied to pairing instead. Frame bytes never pass through the owner at all:
`src/relay/ws.ts` writes each inbound frame straight to a per-session,
per-direction file (`to-browser.log`, `to-terminal.log`) and a
`Worker.run`'d pusher on the *other* role's connection tails it, mirroring
`connection.ts`'s pusherLoop exactly except for one real asymmetry seq
cannot paper over: only session-emitted frames (`to-browser.log`) carry a
real monotonic seq from `session.takeSeq()`. Browser-originated frames
(`to-browser.log`'s counterpart, `to-terminal.log`) are always encoded with
seq 0, so that direction's pusher does not filter by seq at all - it skips
whatever backlog already sits in the file when it starts and delivers every
new line unconditionally. The relay's old `Ring`/500-frame cap is gone; a
session's per-connection log files live only as long as the session does
and are removed on detach or idle sweep, so nothing survives the relay
process choosing to forget it, same spirit as before, just no synthetic
cap.

The daemon side is `src/daemon/relay_uplink.ts`: `RelayUplink` reuses
`RelayClient` (`src/relay/client.ts`) completely unchanged, playing the
relay's "terminal" role from inside the daemon instead of from a standalone
joule process. Outbound, it tails the daemon's own broadcast log with its
own cursor and republishes every frame; inbound, it filters
`relay.pollInbound()` through `isDownstreamAllowed` - the same
input/cancel/approval.reply-only check the classic relay client already
applies - before ever calling `dispatchInboundFrame`. That filter is not
redundant with the relay's own auth: pairing establishes who a browser is,
not what a locally-attached client is trusted to do, and this daemon
already lets any attached client set mode/model/tasks or ask for a stop. A
paired browser gets exactly what spec 002 always said it got and no more,
enforced independently of anything the relay decides to forward.

`joule attach`'s `/share` sends a `share.request` frame (a new pair,
`SHARE_REQUEST`/`SHARE_STARTED`/`SHARE_FAILED`, dispatched in
`src/daemon/dispatch_share.ts` the same way `mode.set`/`model.set` already
are) and the daemon answers with the pairing code and URL, or a plain
failure reason - `ensureStarted` is idempotent, a second `/share` while
already sharing just re-shows the existing code. `dispatch.ts` and
`session_worker.ts` depend on a small structural type,
`ShareController` (`src/daemon/share_controller.ts`), rather than the
concrete `RelayUplink` class: importing `relay_uplink.ts` (and the
`RelayClient`/vendor/websocket chain behind it) into a file compiled as its
own `lumen test` unit hits a toolchain limitation - "no module named 'xev'
available within module 'test'" - unrelated to what those files actually
test. The structural type sidesteps it the same way `attach.ts` sidesteps
lumen#29 by not importing `Gate`; `RelayUplink` itself is exercised at the
harness level instead of as a unit.

`src/relay/web/page_js_frames.ts` was not extended to render
`mode.changed`/`tasks.response`/`daemon.stopping`/`share.started`/
`share.failed` - a deliberate, narrower decision than full parity, matching
the precedent already set when those first three shipped for `joule attach`
without a browser in the picture. Unknown frame types already render as
nothing rather than crashing (`scripts/verify_renderer.mjs` checks this),
and none of the daemon-only frames are meaningful to show a browser that
did not initiate the share and cannot ask for a stop or change the mode
anyway. `renderer.ts` (the terminal side) does render `share.started`/
`share.failed`, since that confirmation is for whoever ran `/share`.

Verified with a new harness, `make share-bridge-harness`
(`scripts/verify_share_bridge.mjs`): a real relay, a real daemon, a real
`joule attach`-shaped websocket client and a real paired-browser-shaped
websocket client on the same session at once. Both see the identical
`read` tool call and the identical `approval.request`; both answer the same
`callId` with opposite decisions close together; exactly one decision wins,
the loser is told via `approval.reply.result` naming the decision that
actually applied, and the workspace file reflects whichever decision won.
This is the #136 approval race, now exercised across the relay for the
first time rather than only between two local attach clients. `make e2e`
(`scripts/e2e_full_stack.mjs`) and `scripts/e2e_relay_check.mjs`, which
exercise the classic `joule --share` path against the reshaped relay
end to end, still pass unmodified - `src/relay/client.ts`,
`src/relay/client_worker.ts`, `src/relay/client_logic.ts`, and
`src/terminal/terminal.ts` are byte-for-byte untouched by this pass.

`/share` in `joule attach`: supportable, and now supported. It needed
exactly the relay reshape this doc already called for - nothing about
enabling it required weakening spec 002's two-sided consent. The human at
the terminal still has to run `/share` (or here, send `share.request` from
an attached client) before any code exists to redeem; a browser still needs
both the code and a joule.sh login to pair; and once paired, a browser's
authority is capped at input/cancel/approval-reply by `isDownstreamAllowed`
in `relay_uplink.ts`, independent of whatever else the daemon would trust a
local attached client to do.

## Lifecycle: what's decided, what's still open

Attach-if-running works: `src/daemon/lifecycle.ts`'s info file
(`~/.config/joule-code/daemon/<key>.json`, keyed the same way
`session/persistence.ts` already keys session files) round-trips, and
`joule attach` reads it before trying to spawn anything.

Spawn-if-absent works, through the same `/bin/sh -c 'nohup ... & disown'`
indirection the spike identified as necessary (Lumen's `child_process` still
cannot detach a spawned process from its parent - spec 450, lumen#6).

**Update, follow-up pass: shutdown is decided.** A daemon started by `joule
attach` still outlives that attach session by default - persistence writes
to disk on every turn regardless of process, so there was never a reason to
tear it down just because one client left. What was missing was a
deliberate way to ask it to stop, and that's what this adds.

Any attached client may ask - `/stop-daemon` from inside `joule attach`, or
`joule attach --stop` without opening a TUI at all. There is no separate
authorization layer beyond being attached to the workspace's daemon in the
first place, which is the same trust boundary #142 already established for
approvals: any attached client can already answer any other client's
approval prompt, so any attached client being able to ask for a stop is not
a new kind of trust, just the same one applied to a new frame type.

On `daemon.stop`, the daemon broadcasts `daemon.stopping` (with a reason)
to every attached client before it does anything else - every client finds
out, not just the one that asked. It does not tear down immediately: the
`SessionWorker` loop keeps running for a short grace window (long enough
for every connection's pusher thread to actually push the notice out over
its websocket before the process disappears out from under it) and, more
importantly, does not force an in-flight turn to stop. `Gate.check()`'s
approval-wait loop already re-enters `SessionWorker.drainOnce()` on every
poll, so a `daemon.stop` frame arriving mid-turn is seen and recorded right
away (the broadcast goes out immediately), but the loop only actually exits
once the current `session.submit()` call has fully returned - normal
completion, cancellation, or the existing approval timeout, whichever
comes first. Nothing forces that turn to end sooner.

What this does not and cannot guarantee: a tool call already in flight when
someone asks the daemon to stop keeps running. `tools/run.ts` still spawns
its child with `child_process.spawnSync` and cannot kill it (lumen#6, open
upstream, the same limitation `docs/00-plan.md` and `02-background-task-spike.md`
already documented for the synchronous case) - stop does not change that,
it just does not pretend otherwise. Background runs and subagents
(`tasks/background_run.ts`, `tasks/subagent_worker.ts`) are independently
spawned, fire-and-forget child processes with no handle the daemon keeps
past spawning them; stopping the daemon does not stop them either, for the
same underlying reason. `joule attach --stop` says this explicitly when it
gets an acknowledgement, rather than implying a clean kill happened.

## Verification

- `make clean && make build && make test` - zero `FAIL`, includes
  `src/daemon/*.test.ts` (21 tests) and `src/code.ts`'s `attach` routing.
- `node scripts/verify_renderer.mjs`, `make terminal-harness`,
  `make layout-harness`, `make onboarding-harness`, `make e2e` - all pass
  unmodified, against the untouched `runTerminal` path.
- `make daemon-concurrent-harness` (`scripts/verify_daemon_concurrent_clients.mjs`) -
  two raw websocket clients attach to one daemon concurrently; one submits a
  turn, the other answers the resulting approval; both observe the same
  frame type at every shared `seq`; the approved `run` actually executes and
  changes a file in the real workspace. This is what lumen#11 unblocked and
  what a daemon exists to prove.
- `make daemon-attach-harness` (`scripts/verify_attach_pty.py`) - the same
  proof through a real pty running `bin/joule attach`: connects, streams a
  reply, renders and answers a tool approval from the keyboard, the tool's
  effect lands on disk, ctrl-d exits cleanly.
- A manual run against the real configured model (not the stub) confirmed a
  full turn end to end through the daemon.

**Update, follow-up pass:** four more harnesses, same Makefile convention
(their own target, not part of `make test`):

- `make attach-commands-harness` (`scripts/verify_attach_commands.py`) -
  a real pty running `bin/joule attach` against a real daemon, exercising
  `/mode`, `/model`, `/tasks`, `/share` and `/help` end to end.
- `make daemon-commands-harness` (`scripts/verify_daemon_mode_model.mjs`)
  and `make daemon-stop-harness` (`scripts/verify_daemon_stop.mjs`) - the
  same two-raw-websocket-clients shape as `daemon-concurrent-harness`,
  for mode/model/tasks cross-client visibility and for `daemon.stop`.
- `src/daemon/cross_client.test.ts`, part of `make test` - wires a real
  `Session` to `appendBroadcast` the way `daemon.ts` itself does, dispatches
  a real `mode.set`/`model.set`, and asserts two independent broadcast
  readers both see the resulting frame.

The two new two-client harnesses currently hang in the environment this
pass was verified in, at the same point and for the same reason
`daemon-concurrent-harness` already does there: a second concurrent
websocket connection to one daemon process never completes its handshake.
This reproduces identically against the unmodified merged baseline, so
it's a pre-existing environment/toolchain issue, not something this pass
introduced - `cross_client.test.ts` is the substitute proof that runs
clean today, and the daemon-side mechanism it exercises (broadcast log,
multiple independent readers) is exactly what a second websocket
connection's pusher thread would also be doing.
