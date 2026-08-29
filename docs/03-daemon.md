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
   thread-local read cursor and pushes new frames to its own peer. An inbox
   file lives exactly as long as its connection needs it: the connection
   thread appends a close marker as its last act, and the owning thread
   removes the file on a later tick, once it has drained everything above
   that marker and the file has not grown since. The ordering comes from the
   file itself, so a frame sent just before the socket dropped is still
   delivered, and a client that reattaches under the same id before the reap
   keeps its file and its place in it. A daemon also sweeps the directory as
   it starts, since anything already there predates it. This is
   the same mailbox idiom `src/tasks/mailbox.ts` and `src/relay/client_worker.ts`
   already use for exactly this kind of cross-thread handoff, applied to a
   second place it was needed.
3. **Client identity needs no server-side allocation.** A connecting client
   generates its own id (`crypto.randomUUID()`) and names it in the
   websocket path (`/attach/<id>/ws`), so the daemon never needs a shared
   counter or registry to hand out ids - one fewer thing that would have had
   to be a shared `Map`.
4. **The client side of the handoff is the same idiom, mirrored.** A client
   runs its own receive thread (`src/daemon/attach_worker.ts`), which appends
   frames and connection-state markers to `<tmpDir>/joule-attach-<id>.mailbox`
   while the owning thread drains it from a line cursor
   (`src/daemon/attach_mailbox.ts`). The owner opens that file at `connect()`
   and reaps it at `detach()` or `disconnect()`, the two places it has
   decided it is finished: after either, `attaching` is false, so
   `maybeReconnect()` will never come back to the file, and the next
   `connect()` mints a fresh id and a fresh path. A dropped socket is not one
   of those places - the file and the cursor both survive it, so a client
   that reconnects under the same id still reads its whole backlog. The
   receive thread appends only to a file that is already there, so a thread
   still winding down after the reap cannot recreate the file it is writing
   to; the owner creating the file at `connect()` is what makes that safe.

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

### Spawning on Windows

`nohup ... &` has no Windows spelling, and the substitution is not one
command for another - it is two nested `Start-Process` calls, and the nesting
is the whole point. `windowsDaemonSpawnCommand` in `lifecycle.ts` builds it,
PowerShell runs it (never `cmd.exe`, for the argument-passing reason #247
established), and `daemonSpawnArgs` picks the spelling by platform so
`ensureAttached` reads the same on both.

**Why two levels.** PowerShell's `Start-Process` takes
`-RedirectStandardOutput`, which is what replaces `>log 2>&1`. Naming a
redirect makes it start the child with handle inheritance on, and the child
then holds a copy of *every* inheritable handle the PowerShell process had -
including the pipes `joule`'s own `spawnSync` handed PowerShell for its
stdout and stderr. Those pipes never reach end-of-file while the daemon
lives, so `spawnSync` waits on a daemon that is supposed to outlive it and
`joule` never returns. This is the opposite of `nohup`, where redirection
replaces the descriptors and leaves no other copy behind.

So the outer `Start-Process` names no redirect at all. Without one PowerShell
starts the child through `ShellExecuteEx`, which inherits no handles, and the
outer PowerShell exits immediately - `spawnSync` returns in about half a
second. What it starts is a second, hidden PowerShell, and *that* one runs the
`Start-Process` carrying the redirects. Its own handles are its own, so the
daemon inheriting them costs nothing, and it exits as soon as it has started
the daemon: nothing lingers between `joule` and `joule-daemon.exe`.

The rest follows from that shape:

- **The environment** is set on the outer PowerShell (`$env:JOULE_DAEMON_PORT`,
  `$env:JOULE_DAEMON_RESUME`) and inherited down both levels, so the daemon
  reads the same two variables it reads on POSIX.
- **`-WindowStyle Hidden`** on both levels is what keeps a console window from
  appearing, and - because the daemon ends up with a console of its own rather
  than the client's - what keeps a ctrl-c or a closed window in the client's
  console from reaching it.
- **Two log files, not one.** `Start-Process` refuses to point both redirects
  at the same path, so stderr goes to `<key>.log.err` beside `<key>.log`.
- **Quoting** is `powershellQuoteSingle` at each level, applied twice for the
  inner command, which is what carries a workspace path containing a space or
  an apostrophe through both parsers intact.
- **Failure** reaches the caller as an exit status, which is all `spawnSync`
  reports: the script raises `$ErrorActionPreference` first so a
  `Start-Process` that cannot run is terminating rather than a warning
  PowerShell exits 0 after. A missing or unrunnable daemon binary is caught
  before any of this, by the `--version` probe in `daemonBinFailure`.

### Asking before connecting

`ensureAttached` finds out whether a daemon is there by polling its port, and
on Windows the runtime's own `net.connect` answers "nothing is listening" by
printing a diagnostic and a stack trace to stderr before recovering - the
NTSTATUS reaches Zig's `windows.unexpectedStatus` rather than being mapped to
`error.ConnectionRefused`. It is not a fault and the call returns what the
caller wanted, but the trace lands on the user's console, in a release build
as much as a debug one.

So the port is asked about first. `plat_port_open` in the platform shim asks
Winsock directly - 1 open, 0 closed, -1 the platform has no answer - and
`worthConnectingTo` is what `ensureAttached`, `runAttachStop` and
`DaemonClient.maybeReconnect` consult before connecting at all. POSIX answers
-1 to everything, so all three behave there exactly as they did: this is a
question POSIX declines rather than a POSIX branch. `ws2_32` is on the Windows
link line for it, because the backend links it for its own socket layer but
not where a shim object can resolve against it.

Filed upstream as lumen-lang-org/lumen#44. `win_daemon_harness.py` asserts
that a cold start writes no `NTSTATUS` line to stderr, so taking the shim out
again when a Lumen release carries the mapping is something CI notices.

### The runtime directory on Windows

It does not move. `~/.config/joule-code/daemon/<key>.json` and
`~/.config/joule-code/daemon/<key>/` are what the daemon writes on Windows
too, with `homeDir()` resolving `USERPROFILE` there (#247). `%LOCALAPPDATA%`
would be the idiomatic Windows home for it, but the daemon is not the only
thing under that root - credentials, config, memory and sessions are there
too - and moving only the daemon's half would put a daemon's record somewhere
its own credentials are not. Forward slashes in those paths are fine: Win32
accepts them, and `path.dirname` reads a backslash path correctly, which is
what lets `joule` find `joule-daemon.exe` beside itself (#187).

The attach mailboxes stay in `tempDir()`, which already resolves `TEMP` on
Windows.

**Nothing the daemon writes is protected by a mode word, on either platform.**
The record, the broadcast log, the inbox files and the attach mailboxes are
all written with whatever the platform's default is; `chmodPath` is called
only for the credentials file, which `joule` writes and the daemon only
reads. So there is no POSIX protection here for Windows to fail to match. It
is worth saying which way the difference actually runs: a POSIX `~/.config`
and `/tmp` leave those files world-readable, while the Windows profile and
per-user `%TEMP%` they land in do not.

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

## Making `joule` itself a daemon client, and retiring the zero-diff guarantee

The three PRs above deliberately held `terminal.ts` at a zero-line diff so
the shipped product could not break while the daemon was unproven. It is
proven now - two concurrent clients, cross-client approval, a real tool
landing on the real filesystem, a paired browser, command parity, a stop
path. The cost of leaving it there is two permanent implementations of the
same terminal: `joule` running the loop in-process, `joule attach` talking
to the daemon. This pass collapses that: **`joule` (no arguments) is now a
daemon client too.** `joule attach` becomes a thin, explicit alias for the
exact same code path, kept for anyone who still types it and for the two
harnesses (`daemon-attach-harness`, `attach-commands-harness`) that name it.

### The converged client

`src/terminal/attach.ts` is the one implementation now, not two. `runAttach`
and the new `runDaemonJoule` both resolve to the same `runClientLoop`; the
only behavioral difference is `announceDaemon` (`attach` still prints
"connected to a daemon at ...", matching what `daemon-attach-harness` and
`attach-commands-harness` already assert byte-for-byte; plain `joule` does
not, because the whole point is that a user typing `joule` should not need
to know a daemon exists). Everything else - the welcome box, the status
bar, approvals, resume, plan mode, tagged task/subagent output, the update
notifier, completion, history recall, `ctrl-o` collapse, page/wheel scroll,
backtab mode-cycling - is one code path exercised by both entry points.

`terminal.ts` itself is untouched, and stays that way for a real reason,
not just caution: it is now the fallback (below), and a fallback that had
drifted from what `joule` actually does before the daemon existed would be
worse than no fallback. Nothing about converging the two clients required
touching it - `terminal.ts` only ever needed `plan_mode.ts`'s constant to
move to `src/approval/plan_briefing.ts` so the daemon side (`dispatch_mode.ts`,
which cannot import a file that imports `Gate` bundled with `Scrollback`/
`InputLine`/etc. any more than `attach.ts` itself can, per the lumen#29-class
issue below) could inject the same briefing text without duplicating it.

Three new client-side files exist for the same reason `attach_approval.ts`
already avoided importing `Gate`: `attach_slots.ts` (mode-name constants and
`nextMode`, duplicated from `slots.ts` rather than imported, because
`slots.ts` imports `Gate`), `attach_keys.ts` (completion/history/`ctrl-o`/
scroll/backtab, none of it Gate-dependent, factored out to keep `attach.ts`
under the 450-line cap), and `attach_plan.ts` (plan-mode offer/accept/reject
as pure client-side state plus two frame sends - `mode.set` back to the
prior mode, then `input` with the approved-plan text - rather than the
direct `Gate`/`Session` mutation `terminal.ts`'s `plan_mode.ts` uses, because
the client does not have a `Gate` or `Session` object to mutate). Entering
plan mode - injecting the plan briefing as system context - moved
server-side, into `dispatch_mode.ts`, since that is the one place that
already holds both `Session` and `Gate` for every client, attached or not.

### The fallback decision

**If a daemon cannot be reached and cannot be started, `joule` runs
in-process instead of failing.** `runDaemonJoule` returns `false` rather
than exiting, `code.ts` calls `runTerminal(argv)` when it does, and the
user sees a clear one-line diagnostic ("could not reach or start a daemon
for `<workspace>` - running in-process instead") before the fallback runs.
This is deliberately asymmetric with `joule attach`, which still fails loud
(prints an error, exits 1) on the same condition: `attach` is an explicit
request to talk to a daemon, so failing loud when it cannot is the
unsurprising outcome; plain `joule` carries no such request, so silently
having a working terminal matters more than surfacing daemon internals.
`terminal.ts` is the right fallback specifically because it is unmodified,
proven code, not a hastily-written safety net - falling back to it is
exercised deliberately (a workspace whose `bin/joule-daemon` cannot be
found) and produces a normal, working turn end to end.

The daemon-absent path (spawn, wait, connect) is exercised on every fresh
`joule` invocation already; nothing about it is new to this pass.

### Lifecycle: what happens to the daemon when you quit

**A daemon a client spawned outlives that client by default, unchanged from
what this doc already decided for `joule attach`.** Quitting `joule`
(`ctrl-d`, or `ctrl-c` at an idle prompt, matching `terminal.ts`'s own
quit-when-idle behavior exactly) detaches the client; the daemon keeps
running, keeps its session warm, and a second `joule` in the same workspace
attaches to it rather than starting a competing loop - verified directly (a
fresh `joule`, then a second `joule` in the same workspace while the first
is still up: one `joule-daemon` process throughout, not two). Background
tasks and subagents a turn started are not silently killed by quitting the
terminal that happened to be attached when they were spawned; that was
already the design's point. `joule --stop` (equivalent to the existing
`joule attach --stop`) is how anyone asks a workspace's daemon to actually
stop, and now works from the default entry point too, not just `attach`.

**`ctrl-c` at an idle prompt now asks rather than assumes.** The default
above - quit here, keep running there - is exactly the thing nobody could
see, so a `ctrl-c` on an empty input line opens a three-answer prompt:
keep it running in the background (detach, and say on the way out which
port it is on and that `joule --stop` ends it), quit and end the session
(publish `daemon.stop` and wait for the `daemon.stopping` that answers it,
the same handshake `joule --stop` does, so quitting really does stop the
daemon), or stay here. A second `ctrl-c` is a fast quit. `ctrl-d` and
`/exit` are unchanged: they detach and leave the daemon running, which is
what someone who typed them already expected. The standalone terminal -
the path taken when no daemon could be reached - answers the same prompt
by flushing its history and handing itself to a daemon it spawns with
`JOULE_DAEMON_RESUME=1`, so "keep it running" means the same thing on
both paths.

### `--continue`, across a daemon's lifetime

`--continue` still means "load this workspace's saved session" - but a
daemon spawned earlier in the same workspace already has that session live
in memory, so there is nothing on disk more current than what it already
holds. `runDaemonJoule`/`runAttach` only pass the resume flag through to a
*freshly spawned* daemon (`JOULE_DAEMON_RESUME=1`, gating the
`loadWorkspaceSession` call `daemon.ts` used to make unconditionally on
every spawn - a real, if narrow, pre-existing bug: a daemon spawned without
`--continue` was silently resuming anyway); attaching to an already-running
daemon with `--continue` prints a short note that continuing only applies
when starting a new daemon, rather than re-showing stale disk content next
to the live session's real, continuous history. The resumed-session banner
itself is rendered client-side from the same `resolveResume` `terminal.ts`
already uses (disk I/O, no daemon involved) when this client did the
spawning; when attaching to a session already carrying history, the banner
is shorter (no message count - the client has not read the daemon's live
history, only observed that a replay is about to happen) but still says
"resumed previous session" so `--continue`'s user-visible contract does not
depend on which of the two cases fired.

### Bugs this pass found and fixed, not introduced by it

Converging onto the daemon path for the very first invocation - not just
the second, already-attached one `joule attach`'s existing harnesses cover
- put real load on code that had only ever been exercised lightly, and
turned up four genuine, pre-existing bugs:

- **`session.hello`'s `mode` field was always the literal string `"agent"`**
  (`session.mode`, the session-kind marker `new Session(root, "agent", ...)`
  sets, not the actual approval mode) in both `daemon.ts` and `terminal.ts`'s
  own relay-attach path. Nothing before this pass displayed that field
  anywhere prominent enough to notice; the new welcome box and status bar
  do, immediately, on every attach. Fixed in `daemon.ts` to report
  `gate.mode`, the field that is actually true.
- **A client-caused disconnect crashed the Lumen runtime.** `DaemonClient.detach()`
  closed the websocket from the main thread while the background
  `attachReceiveLoop` worker thread could still be blocked reading the same
  socket - a classic cross-thread close-under-a-blocked-read race, and the
  syscall wrapper treats the resulting `EBADF` as a fatal "programmer bug"
  rather than a recoverable read error. It only ever fired probabilistically
  (whether the crash's own stderr got flushed before the process finished
  exiting), which is exactly the shape of the "zero raw 0x0A bytes"
  flake `terminal_structural_harness.py` caught intermittently. Fixed by no
  longer closing the socket from `detach()` at all - every caller detaches
  right before the process exits anyway, so the OS reclaiming the fd on
  exit is sufficient, and it removes the race instead of narrowing it.
- **Frames that arrived while `ensureAttached` was still polling for
  readiness were silently dropped.** `waitForReady` called
  `client.pollInbound()` in a loop just to check `socketReady`, and
  `pollInbound()` drains and clears the inbound queue as a side effect - so
  a daemon's full backlog replay (which starts as soon as the socket is up,
  i.e. exactly during this window) was read and thrown away before the main
  loop ever got to look at it. This is why a second client attaching to a
  workspace with real history rendered nothing: the replay happened, and
  was discarded. Fixed by having `waitForReady` return what it drained
  (`ReadyOutcome`), threading it through `AttachResult.pending`, and
  processing it once before the main loop starts (rendering replayed
  `turn.start` prompts as `"> " + prompt`, which live typing already
  echoes locally and replay otherwise never would).
- **The daemon spawn command referenced its own binary by a path relative
  to the *workspace*** (`nohup bin/joule-daemon ...`), which only resolves
  when `joule` happens to be run from the repository root. `joule attach`'s
  existing harnesses never caught this because they always pre-spawn the
  daemon themselves rather than exercising `joule`'s own spawn path.
  `defaultDaemonBinPath()` now resolves the daemon binary as a sibling of
  the currently-running `joule` executable (`detectRunningExePath()`,
  already used by the update installer for the same kind of self-location),
  which is correct both in this dev tree and in an installed layout. A
  second, smaller gap in the same code path - the spawned daemon's log file
  redirect (`>logPath`) failing because its parent directory did not exist
  yet - is fixed alongside it (`fs.mkdirSync(daemonInfoDir(), true)` before
  spawning).

None of these are daemon-architecture problems; all four are in code this
pass's predecessors wrote but never had a reason to exercise the way a
first-ever `joule` invocation now does on every run.

### Tasks and subagents (#77), now actually answerable remotely

A gap, not a regression: a subagent's own tool-call approvals were never
routable to any remote client, daemon or not. `TaskBoard.answerActiveApproval`
writes straight to the subagent's own IPC mailbox file, bypassing `Gate`
entirely - and the only thing that ever called it was `terminal.ts`'s local
keyboard loop, wired directly to the in-process `TaskManager`. `joule attach`
already rendered a subagent's `approval.request` (tagged `agent:N`) as an
ordinary-looking prompt - and already let a remote client reply to it with
an ordinary `approval.reply` - but the daemon had nothing to route that
reply *to*: `dispatch.ts` only ever forwarded `approval.reply` to `gate.reply()`,
which does not know about task-board approvals and reports them as
foreign/unapplied. `dispatch_task_approval.ts` closes that gap: an
`approval.reply` whose `callId` matches `tasks.activeApprovalCallId()` is
routed to `tasks.answerActiveApproval()` instead of falling through to the
gate. No new frame type, no client change beyond what `joule attach` already
did - the daemon just finishes wiring a path that was half-built.

### The enumerated check

Everything #85, #118, #77, #117, #106, #136 and #126 named, checked against
this pass rather than assumed:

- **#85 session resume** - see `--continue`, above. Live-verified against
  the real configured model, not just the stub: a turn, `ctrl-d`, a second
  `joule --continue` in the same workspace showing the resumed banner and
  the prior turn's prompt and reply.
- **#118 memory** - `/memory` is client-local (`memory_ui.ts`), touches no
  daemon-owned state, already worked unchanged through `joule attach` and
  works unchanged through the converged path for the same reason.
- **#77 tasks/subagents** - text streaming already worked through the
  daemon (`TaskBoard.poll` emits ordinary tagged frames); the approval gap
  above is now closed. `/tasks` list/cancel is daemon round-trip request/
  response, unchanged, covered by `daemon-commands-harness`.
- **#117 plan mode** - briefing injection moved server-side
  (`dispatch_mode.ts`), offer/accept/reject is client-side frame sends
  (`attach_plan.ts`), covered by `dispatch_mode.test.ts`'s new tests
  asserting the briefing is injected exactly once, on the transition into
  plan mode.
- **#106 safe-auto** - a mode string like any other to `dispatch_mode.ts`'s
  validation and to the welcome box's `modeDisplay`; no daemon-path-specific
  handling exists for it to have broken.
- **#136 approval race** - `ApprovalLog`'s reply-bookkeeping (`attach_approval.ts`)
  is unchanged, still the client-local mirror of `Gate.reply()`/`findReply()`
  attach.ts has always needed since it cannot import `Gate`; `share-bridge-harness`
  re-verifies the race end to end (a paired browser and an attach-shaped
  client both racing the same approval) as part of this pass's own
  verification, not just the reshape's.
- **#126 update path** - `/update`'s install flow (`update_offer.ts`) was
  already wired into `joule attach`; the *notifier* (`startUpdateNotifier`/
  `pollUpdateNotice`, the background "a new version is available" prompt)
  was not, and now is, one more piece of client-local state
  (`PendingUpdateOffer`) threaded through the same `processFrames`/
  `drawScreen` loop as everything else.

### Verification

- `make clean && make build && make test` - zero `FAIL`.
- `node scripts/verify_renderer.mjs`, `make terminal-harness`
  (`terminal_structural_harness.py`, 174 checks against the now-daemon-backed
  default `joule` path), `make onboarding-harness`, `make e2e`,
  `daemon-attach-harness`, `daemon-concurrent-harness`, `attach-commands-harness`,
  `share-bridge-harness` - all pass, unmodified, repeatedly (the
  `terminal-harness` and `daemon-attach`/`concurrent`/`commands` runs were
  each repeated after the detach-crash fix specifically to confirm the flake
  it explains is gone, not just quieter).
- **`make layout-harness` (`verify_layout.py`) was a confirmed regression,
  now fixed and re-verified.** A fresh clone of unmodified `main` passes all
  169 assertions the script logs (its real total; an earlier draft of this
  doc wrongly said "127") every time. This branch, before the fix below,
  failed the same two checks deterministically, three runs straight - at
  80x10 and 45x12, the third and fourth case in the script's own
  size-variant sequence, never the first two, never as an isolated single
  case: a tool-call reply to a follow-up message never appeared in the
  captured output within the 10s budget `wait_for` enforces.

  The investigation's first two theories were both wrong, and are recorded
  here because ruling them out is what actually found the real bug. Timing
  the connection layer directly (raw CTRL:CONNECTED/CTRL:DISCONNECTED
  events from the client's own mailbox file, not text visible in the pty
  stream) showed exactly one connect-retry cycle per session, always at
  startup, identical whether zero, one, or several background daemons were
  alive - what had looked like "the connection drops and reconnects
  mid-session" in the raw pty transcript was the *same* one startup retry,
  simply not yet painted to the screen by the time later content arrived,
  because of the real bug below. Spawning genuinely idle background daemons
  (never given a client, ever) didn't reproduce anything at all; spawning
  daemons that had each briefly served a client and then been detached from
  reproduced instead - the discriminator wasn't identity or a connection
  drop, it was CPU scheduling.

  **Root cause:** `attach.ts`'s frame-processing closure drew the screen
  once *after* an entire batch of frames from one `pollInbound()` call, not
  once per frame. `terminal.ts` never had this problem because its
  `session.subscribe` callback calls `drawScreen` for every single frame,
  synchronously, with no batching possible. The stub model (and the daemon
  relaying it) replies fast enough that a whole exchange - text, a
  `tool.call`, its `tool.result`, more text, an `approval.request` - often
  arrives within one 100ms client poll tick. Confirmed directly: the
  daemon's broadcast log and the client's own mailbox both had the full,
  correct 7-frame sequence including the `read` tool call, timestamped
  within 6 milliseconds of each other - the frame the harness was waiting
  for genuinely reached the client. It was appended to the scrollback and
  then never painted, because the single end-of-batch redraw already
  showed a tail that had scrolled past it on an 80x10 or 45x12 terminal.
  Background daemon load matters only because a client process getting
  less CPU time polls less precisely, which makes *larger* batches more
  likely, not because of anything about the daemons themselves - matching
  the idle-vs-serving discriminator result above exactly. Not a Lumen
  runtime limit; nothing to file upstream. A real, if narrow, latent bug
  in `attach.ts` from the start of this pass, just very unlikely to
  surface without a fast-replying model, a short terminal, and enough
  competing load to make the client's own polling coarser.

  **Fix:** `processFrames` now calls `drawScreen` once per frame (and the
  diagnostics loop once per diagnostic) instead of once per batch,
  matching `terminal.ts`'s per-frame behavior exactly. Re-verified: 5/5
  clean `verify_layout.py` runs (169/169, matching `main`) after the fix,
  plus `make test`, `terminal-harness` (174/174, 3x), `onboarding-harness`,
  `make e2e`, `daemon-attach-harness`, `attach-commands-harness`,
  `daemon-concurrent-harness`, `daemon-commands-harness`,
  `daemon-stop-harness` and `share-bridge-harness` all still pass
  unmodified after the change.
- A live pty session against the real configured model (not the stub):
  welcome box, a real turn, streamed reply, `ctrl-d` exits in under a
  second, a second invocation in the same workspace attaches (one
  `joule-daemon` process throughout, confirmed by process count, not just
  by behavior), `--continue` resumes with the banner and the prior turn's
  content, and a daemon-start failure (binary temporarily moved aside)
  falls back to a working in-process terminal with the diagnostic line
  described above.

## The mailbox append that only worked on Linux (#197)

Every frame the daemon and its clients exchange goes through a mailbox
file. A client's frame is appended to `inbox/<connId>.in`, which the
session loop drains; the session's own frames are appended to
`broadcast.log`, which each connection's pusher tails and writes to its
websocket. `appendMailbox` in `src/tasks/mailbox.ts` is the one function
that writes to either of them.

It used to open the file with `fs.openSync(path, "a")` and write. In the
toolchain this project pins, that call seats the file offset at
end-of-file with an `lseek` that is compiled in **only on Linux**.
Everywhere else the descriptor starts at offset 0, so every "append"
writes over the front of the file instead. Measured directly on an
Apple Silicon runner, three appends of a 13-byte line leave a 13-byte
file holding only the third line; the same three through
`fs.appendFileSync` leave 39 bytes holding all three.

That is the whole of #197. On macOS the daemon came up, accepted the
websocket, and received the client's `input` frame - the inbox file was
created fresh by that first write, so it landed correctly, and the turn
really ran. Its answer did not come back. `session.hello` was the first
line written to `broadcast.log`, and the pusher read it, which is why a
client reported itself attached and an editor panel showed the model and
mode. Every frame after it - `turn.start`, the text deltas, the tool
call, the approval request - was written over the top of that first
line. The file never grew past the offset the pusher had already reached,
`MailboxReader.readForward()` returned nothing on every poll for the rest
of the process's life, and not one frame was ever sent. A daemon
transcript taken from the macOS runner shows a 273-byte `broadcast.log`
holding exactly one line: the seventh frame of the turn, `approval.request`.

The fix is one line of behaviour: `appendMailbox` now uses
`fs.appendFileSync`, which opens with a real `O_APPEND` on every
platform, so the kernel repositions to end-of-file on each write. That is
also strictly better than the `lseek` it replaces, because `O_APPEND`
places each write atomically - two processes appending to the same
mailbox can no longer land a write between another writer's seek and its
write.

### Why nothing caught it

`mailbox.test.ts` already asserted the property that broke ("appending
only ever grows the mailbox file"), and `broadcast.test.ts` already
asserted that a late reader sees every frame. Both of them would have
failed on macOS the first time they ran there. They never ran there: every
job in `test.yml` was on a Linux runner. `test.yml` now has a `macos` job
that builds and runs the suite plus the daemon harnesses on `macos-14`,
which is the only reason this can be called fixed rather than believed
fixed. Two tests in `mailbox.test.ts` read `/proc/self/io` and
`/proc/self/fd` to measure read amplification and descriptor leaks; they
are Linux-only by nature and now guard on `process.platform()`. Four test
files elsewhere in the tree do not pass on macOS for reasons of their own -
the permission bits a credential file is written with, and how the update
path recognises and smoke-tests a managed install - and are named in
`MACOS_SKIP_TS` in the Makefile, a list meant to shrink.

### Silence is its own defect

Two changes exist because the failure was invisible, not because they
fix it.

The daemon logged its startup line and then nothing for the rest of its
life, so a daemon that had received a request was indistinguishable from
one that had not. It now logs each frame it receives on a connection,
each replay it starts, each frame it dispatches to the session, and every
client that goes away. It also refuses to start at all if the first write
to its own broadcast log does not land, since a daemon that cannot
broadcast can never answer anyone. Inbound frames are human-paced, so
this is a few lines per turn.

The client had no way to notice that an accepted request produced
nothing. `TurnWatchdog` (`src/terminal/attach_watchdog.ts`) starts on
each request sent to the daemon and clears on the first frame that comes
back. If ten seconds pass with neither, the client says so in the
transcript, names the port, and names `joule --stop` as the way out,
rather than sitting at a healthy-looking prompt indefinitely.

### A failed spawn is no longer waited out (#198)

`ensureAttached` discarded the result of the `spawnSync` that starts the
daemon, then waited `SPAWN_WAIT_TICKS` plus `HELLO_WAIT_TICKS` - eight
seconds - for a process that in some cases had already failed in
milliseconds. Checking the shell's own status is not enough, because the
spawn command backgrounds the daemon and the shell exits 0 whatever
happens to it. So the binary is now run once, synchronously, before it is
backgrounded: a missing file, or one the kernel kills on exec (which is
what macOS did with the invalid signature in #196), fails that probe in
milliseconds and the client falls back immediately with the reason in one
line, including whatever the failed run put on stderr. The shell's status
is checked too.

## Two clients on one session that did not agree (#227)

A terminal and the editor panel on the same daemon diverged twice over: a
prompt typed in the panel never appeared in the terminal, and the two
disagreed about the mode - the terminal's status line said `full-auto`
while the panel said it had not been told what may run. They are one root
cause and one straightforward omission, and it is worth separating them.

### A client joining is replayed the session it is joining, and no other

The daemon writes every frame the session emits to `broadcast.log` in the
workspace's runtime directory, and a joining client is replayed all of it
from `session.hello` on. `seq` is assigned by the process that emits the
frame and starts again at 1 with each one; the log was created once and
appended to forever. So the second daemon ever started in a workspace
wrote frames numbered from 1 underneath a log that already ran to some
higher number, and the pusher - which forwards a frame only when its
`seq` is above the watermark it has reached - walked up through the old
numbers on the replay and then dropped every live frame beneath them.

What a client saw was a previous session's transcript, followed by
silence, followed eventually by the live session once its counter climbed
past the stale one. `session.hello` is frame 1 of a session, so it was
always among the casualties: the panel had never been told the mode
because the frame that carries it had been filtered out as already seen,
and a `mode.changed` from early in the session went the same way. This is
also why the two clients could disagree rather than both being wrong -
they attached at different points, so they lost different frames.

The log now belongs to the process that writes it: `startBroadcastLog`
truncates it before the first `session.hello`, and a daemon that cannot
refuses to start, for the same reason it already refuses when the first
broadcast write does not land. A joining client is replayed one session,
beginning with the hello that says what the mode and the model are, and
`seq` means what the spec says it means again.

One thing in the replay path did change, because the same hazard reaches
it from the other side. A client that reconnects sends `resume{since}`
carrying the last `seq` it saw, and nothing stopped that number from
belonging to a session that is over - a client whose daemon died and
whose workspace has a new one resumes from where the old session got to,
which is above everything the new one has emitted, and it is sent nothing
at all. The pusher now compares `since` against the highest `seq` the log
holds on its first read: within a session that is never above it, so a
real resume is untouched, and a `since` from a session this daemon never
ran replays the current one in full instead of silently sending nothing.

### The prompt the terminal would not draw

`turn.start` carries the prompt, and the daemon broadcasts it to every
client, so the frame was always arriving - the terminal simply did not
draw it. Each client echoed its own input locally the moment it was
typed, and the terminal drew a `turn.start` prompt only while replaying
a backlog, which is exactly the case where no local echo had happened.
A prompt from a second client arrived live and painted nothing, which is
why the terminal showed answers to questions it never showed.

The terminal now draws every `turn.start` prompt except the one it echoed
itself. `LocalPrompts` (`src/terminal/attach_echo.ts`) holds the prompts
this client sent, in order, and a `turn.start` whose prompt is at the
head of that queue is the client's own echo coming back and is skipped;
anything else is another client's and is drawn. Keeping the local echo
matters: the round trip through the daemon is a poll tick, and a person
who has just pressed enter should not watch their line disappear while
they wait for it.

The in-process terminal - the one that runs when no daemon could be
started - has the same two sources of prompt, itself and a browser paired
over the relay. There the session's frames come back synchronously, so it
does not echo locally at all any more: `turn.start` is what draws a
prompt, whoever sent it. The relay page never echoed and never drew one
either, so a browser watching a session saw replies to prompts it could
not see; it draws them now too.

### What a joining terminal shows before its first frame

The welcome box is painted before the replay is processed, from the
mode the client guessed and the model in local configuration. A terminal
attaching to a session already in `full-auto` therefore opened saying
`may run auto-edit` and only corrected itself in the status line once
the replay arrived. `attachedMode` and `attachedModel` fold the replayed
`session.hello`, `mode.changed` and `model.changed` into what the box is
built from, so the first thing the terminal paints is what the session
says rather than what the client assumed.

### Verification

`scripts/verify_two_clients.py` drives three real terminals on one
daemon over real ptys and asserts on the rows of the latest redraw, not
on frames received - #147 was a bug where the frames arrived and nothing
painted, and a frames-received test would have passed it. It covers a
mode set in one terminal appearing in another's status line, a terminal
attaching after that change opening with the right mode in its welcome
box, a prompt from either terminal appearing in both transcripts, and
each terminal drawing its own prompt exactly once.

The `second-client` scenario in the editor window harness does the panel
half in a real editor window against a real daemon, asserting against
the webview's DOM: a second client's mode change and prompt painting in
the panel, the panel learning the mode a second client set while it was
detached, and - after the daemon in that folder is stopped and another
started - the panel painting the mode of the session it just joined with
none of the previous session's transcript replayed into it.

`verify_daemon_concurrent_clients.mjs` covers the daemon end of that last
one: a client joining a restarted daemon gets that session's hello first
and nothing from the session before it, and a `mode.set` it sends is
broadcast back rather than being shadowed by the old numbering.

## A client refuses a daemon of another build (#195)

A daemon outlives the client that started it, by design, so updating
`joule` leaves the old daemon running and the new binary talking to it.
Nothing on the wire said so: `PROTOCOL_VERSION` is `1` and has been since
the first frame was written, so two builds that share a frame set and
agree on nothing else considered each other compatible. What a person saw
was a fresh session that echoed the prompt, reported itself connected and
never replied, with a status line reading 206h 29m - the turn was marked
live without ever starting, and the elapsed reading collapsed to raw
monotonic time.

`session.hello` now carries `build`, which is the emitting binary's
`VERSION`, and `ensureAttached` compares it against the client's own once
a daemon has answered for this workspace. A daemon of a different build,
or one too old to say which build it is, is refused with three lines: the
two builds and the port, then why, then `joule --stop` as the remedy. The
short lines are deliberate. A banner in the scrollback is clipped to the
terminal's width rather than wrapped, and the first draft said the useful
half of it past column 80, where an 80-column terminal cut it off - the
refusal was driven through a real pty before it was believed. The same
check runs on a daemon this client just spawned, where a mismatch means
something else: the client and the daemon binary beside it came from
different installs, so that refusal names the path it started.

### Read off the wire, not decoded

`JSON.parse<T>` in Lumen is exact. A payload missing a field the type
declares does not parse, and neither does one carrying a field the type
does not have. So adding `build` to `SessionHelloFrame` makes an older
daemon's hello undecodable in a newer client, and the frame this check
needs is the one frame it can no longer read.

`helloWorkspace` and `helloBuild` therefore read `workspace` and `build`
straight out of the frame text, with the same raw field reader
`frameType` has always used, and only `attachedMode` and `attachedModel`
still decode - they run after a build has matched. Without that, an older
daemon read as "no hello at all", which the attach path already tolerates
for a workspace whose daemon is recorded, and the client would have
attached to precisely the daemon it is meant to refuse.

### Refusing rather than reaping

The client does not stop the stale daemon itself, though it knows how -
`runAttachStop` already sends `daemon.stop` and waits for the
acknowledgement. A mismatch does not say which of the two is stale. The
same check fires when an older client meets a newer daemon, which is what
a rollback or a second binary still on `PATH` produces, and there the
daemon is the current one; stopping it would end a session nobody asked
to end, along with whatever turn it is running for whichever client is
attached to it. Refusing costs the person one command. Reaping the wrong
daemon costs them a session, and it would do it automatically.

### A turn marked live with no start time

Independently of any of this, `TurnStatusTracker.elapsedMs` returned
`time.monotonic() - startedAt` whenever `inTurn` was set, and `startedAt`
is `0` until a `turn.start` arrives. The state that should be impossible
printed the machine's uptime into the status line rather than reading as
wrong. A live turn with no start time now reports `NO_TURN`, which the
status line already draws as no elapsed reading at all.

### Verification

`make test` covers the wire and the decision: an older hello that no
longer decodes still yields its workspace and an empty build, a hello
from another build reads back as that build, and the refusal names both
builds and `joule --stop` inside the width a terminal will show.

That is not what proves it. Four binaries were built from this tree with
different versions stamped into `src/version.ts`, one of them from the
commit before this change so that its hello has no `build` at all, and
run against each other in throwaway workspaces:

- a `0.22.0` client meeting the pre-change daemon refuses it, naming a
  build too old to say which one, and exits non-zero;
- a `0.22.0` client meeting a `0.21.0` daemon refuses it by name;
- a `0.21.0` client meeting a `0.22.0` daemon refuses it too - the check
  is a mismatch, not a floor;
- a `0.22.0` client meeting a `0.22.0` daemon attaches, as before.

In every refusal the daemon was left running and listening, and
`joule --stop` from the mismatched client still stopped it - the remedy
the message names has to work across builds, and `daemon.stop` carries no
field either side reads differently. Running the client again then
started a daemon of its own and attached to it. The same run under a real
pty shows the three lines under the welcome box, which is where a person
actually meets them. The pre-change client, pointed at the `0.22.0`
daemon, attached to it and said nothing at all.

## Naming a session, so one path can hold more than one conversation (#331)

A workspace path was the *only* key a daemon ever had. `sessionKeyFor(workspaceRoot)`
hashed the path into a port, and that hash reached everything downstream
of it - the daemon's info file, its runtime dir (inbox and broadcast
log), its log file, and the persisted history file. One path meant one
hash meant one daemon meant one conversation: every `joule` run from the
same directory attached to whatever was already live there, `--continue`
or not.

`--session <name>` adds a second key alongside the path. `sessionKeyFor`
now takes a name and salts its hash with it (`""` reproduces the old hash
byte for byte, so upgrading orphans nothing already on disk); every
function built on top - `portFromWorkspace`, `daemonInfoPath`,
`daemonRuntimeDir`, `daemonLogPath`, `sessionFilePath` - took the name as
a second argument and the rest followed with no other path construction
to touch. `joule --session review` and a plain `joule` on the identical
path now land on different ports, write different info files, and never
see each other's turns.

The handshake needed the same widening. `SESSION_HELLO` already carried
a `sessionId` field, but that is the daemon's own identity
(`"daemon-" + port`) and, on the relay share path, the relay's pairing
id - a different concept wearing a similar name. A new `session` field
carries the workspace session name instead, read the same raw,
never-strict way `workspace` and `build` already are
(`helloFrameSession`), so `ensureAttached`'s mismatch check - "is this the
daemon I am looking for" - now asks about both: `identityMatches` requires
the workspace *and* the session to agree, with the same leniency the old
check had for a daemon we already trust from our own info file but whose
hello has not arrived yet.

`joule --stop` moved the same way - `runAttachStop` and
`reapDaemonForUpdate` take a session name now, and every note that used
to say "the daemon for `<workspace>`" says "the daemon for `<workspace>`
(session `<name>`)" for a named session and exactly what it always said
for the default one (`describeSessionSuffix("")` is `""`).

### Verification

`make multi-session-harness` runs two real `joule` processes against the
same workspace - a plain one and `joule --session review` - and checks
what the product's own files say: two daemons recorded under the same
`HOME`, on different ports, both still up after both terminals detach
with `ctrl-d` (detaching was never supposed to stop anything). Then
`joule --stop --session review` is asked for by name, and the check reads
the daemon info directory again to confirm exactly one entry is gone -
the named one - before the plain `joule --stop` that follows takes the
other.

## A scratch directory, so throwaway files have somewhere sanctioned to go (#336)

An agent working a task regularly needs somewhere to put a file that
is not the deliverable itself - a debug script, an intermediate
transform's output, a draft it wants to look at before committing to
it as a real edit. With nowhere sanctioned, that either lands in the
workspace (and then has to be remembered and removed before it looks
like part of the change) or in a shared system temp directory, which
is genuinely unsafe to reuse: a leftover script from an unrelated
earlier session can shadow a same-named module for anything run from
that directory later.

`ensureScratchDir(workspaceRoot, sessionName)` (`src/session/scratch.ts`)
creates `.joule/scratch/<sessionKeyFor(workspaceRoot, sessionName)>`
inside the workspace itself, reusing the same per-(workspace, session)
key `--session` (#331) already keys the daemon runtime dir with, so two
sessions on one workspace never collide. Living inside the workspace
root rather than under the daemon's home-config directory is the whole
design: every tool that is already jailed to the workspace root
(read, write, edit, list, grep) can reach it with no change to
`jail.ts`, and every `run` shell command can already reach it as a
plain relative path with no env var to plumb through the three places
a command gets built (`run.ts`, `run_foreground.ts`,
`background_run.ts`), because all of them already start from the
workspace root. The only new work is keeping git blind to it - a line
appended to `.git/info/exclude` (never the user's own `.gitignore`,
and skipped entirely for a directory that is not a git repo) - and
telling the agent it exists, one line of system context injected at
startup the same way `/memory`'s `startupMemoryText()` already is,
naming the exact relative path rather than an env var so there is
nothing to remember beyond it.

Nothing prunes these directories on its own, matching how the rest of
a session's runtime state already behaves - the inbox and broadcast
log under the daemon runtime dir do not get cleaned up on `--stop`
either. `joule --clean-scratch` is the bulk escape hatch: it removes
`.joule/scratch` for the current workspace outright, covering every
session that has ever used one on it, rather than trying to guess
which ones are still wanted.

## Coming up headless: the mode, the first task, and where the runtime dir goes (#348)

Everything the daemon needed to be told, it was told by a frame from an
attached client. That is fine for a daemon a person attaches to, and wrong
for one started inside an environment nobody is watching: the daemon came up
in `safe-auto` because `daemon.ts` hardcoded it, so the first gated tool call
broadcast an `approval.request` that nothing would ever answer and sat there
for the full `APPROVAL_TIMEOUT_MS` - two minutes per call - before being
denied. The mode had to be answerable before the first frame, not after.

`joule-daemon --mode full-auto` is that answer, and it is the terminal's flag,
not a second one. `daemonStartup(argv)` (`src/daemon/startup.ts`) calls
`modeFlagResult(argv)` and `promptFlag(argv)` from
`src/terminal/startup_flags.ts` unchanged, so `joule` and `joule-daemon`
accept the same spellings, refuse the same input, and print the same words
when they refuse it - including `--mode plan`, which both still turn down
because entering plan mode for real runs `enterPlanMode`'s ceremony that a
bare assignment at startup does not. A refusal exits non-zero before anything
is written, so a mistyped mode never truncates the broadcast log of the
daemon that was already there. **No flag still means `safe-auto`**: a daemon
nobody passes anything to behaves exactly as it did.

`--prompt` comes along for the same reason and by the same route. It is read
off the same argv, and it runs through `SessionWorker.runInitialPrompt`, which
is `RelayInputBridge.runNow` - the identical path an `input` frame takes, so
anything arriving while that first task runs queues behind it rather than
interleaving with it. What it buys is a daemon that does one piece of work
with no client ever connecting to it.

### `JOULE_DAEMON_RUNTIME_DIR`

The daemon's frame plumbing is file-backed: inbound frames are lines in
`<runtimeDir>/inbox/<connId>.in`, and every outbound frame is a line in
`<runtimeDir>/broadcast.log`. The websocket is a shim over those two files.
That is what makes a daemon drivable from outside its own machine - a program
holding a `docker exec` into the container can append an input line and tail
the log with no port published and no network at all.

To do that it has to name the directory, and the directory was
`homeDir() + "/.config/joule-code/daemon/" + sessionKeyFor(workspaceRoot,
sessionName)` - a SHA-1 over the workspace path with the session name folded
in. Reimplementing that hash in the caller means the same derivation in two
languages in two repositories, and the first time one of them changes, the
writer and the reader disagree silently: an inbox nobody drains looks exactly
like a daemon with nothing to say. So the caller is told the directory
instead. `JOULE_DAEMON_RUNTIME_DIR`, when set and non-empty, is used verbatim;
unset or whitespace, the derived path is used and nothing about it changes.

Three decisions worth stating:

- **A relative path is refused**, not resolved. The whole point of the
  variable is that two processes name one directory, and two processes with
  different working directories resolve one relative path to two - the failure
  mode being silence, which is the worst kind. It exits non-zero saying so.
- **A path that does not exist is created**, along with its `inbox/`, the same
  as the derived one always has been. If it cannot be created the daemon says
  which directory it could not create and exits, rather than starting and
  leaving `startBroadcastLog` to report that it could not clear a file in a
  directory that was never there.
- **It moves the runtime directory, not the daemon's record.** The
  `<key>.json` beside it is how `joule attach` finds a daemon by workspace,
  and a client discovering a daemon has no reason to know where that daemon
  keeps its inbox, so the record stays in the derived location.

This resolves the first open question on #348 in favour of the option that
leaves one implementation of `sessionKeyFor` in the world.

### Verification

`make daemon-mode-flag-harness` (`scripts/verify_daemon_mode_flag.mjs`) drives
real daemons against the stub model and asserts against `broadcast.log`
rather than a websocket client, because the log is the only surface something
driving an unattended daemon has. It covers: `--mode full-auto` writing a
`session.hello` with `"mode":"full-auto"` and then running the scripted `run`
tool with no `approval.request` at all; no flag still writing `"safe-auto"`
and still parking that same tool in an approval; `--prompt` producing a
`turn.start` and a `turn.end` with nothing ever attached; `--mode plan`,
`--mode yolo` and a relative `JOULE_DAEMON_RUNTIME_DIR` each exiting non-zero
with a message that says why; and, with the variable set, `broadcast.log` and
`inbox/` appearing there and not under `HOME`.

Unit coverage is `src/daemon/startup.test.ts` (the flag and directory
decisions, without a daemon) and two cases in
`src/daemon/session_worker.test.ts` for `runInitialPrompt`.
