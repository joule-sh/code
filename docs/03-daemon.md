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

## Lifecycle: what's decided, what's still open

Attach-if-running works: `src/daemon/lifecycle.ts`'s info file
(`~/.config/joule-code/daemon/<key>.json`, keyed the same way
`session/persistence.ts` already keys session files) round-trips, and
`joule attach` reads it before trying to spawn anything.

Spawn-if-absent works, through the same `/bin/sh -c 'nohup ... & disown'`
indirection the spike identified as necessary (Lumen's `child_process` still
cannot detach a spawned process from its parent - spec 450, lumen#6).

**Who owns shutdown is still an open question, same as the spike left it.**
A daemon started by `joule attach` currently outlives that attach session
indefinitely - there is no stop frame, no idle timeout, no `joule detach
--stop`. Given persistence already writes to disk on every turn regardless
of process, outliving one client is the right default; an explicit,
deliberate stop path is the gap. Left open rather than guessed at.

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
