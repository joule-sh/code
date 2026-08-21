# 02: background task and subagent spike (#77)

## Answer

Both are buildable today on the exact mechanism #14 proved (`Worker.run(fn)`
hosting a zero-capture top-level function, a single-writer/single-reader
mailbox file, drained by the main thread after every blocking call returns).
Neither needs a new Lumen capability. The catch is not "can a second thing
run concurrently" -- #14 already answered that -- it is "how much of the real
`Session`/tool machinery can that second thing actually use." The answer,
proven below rather than assumed: none of the `Session` class itself, all of
the free functions underneath it (`streamChat`, `run`, `readFile`, ...), as
long as every cross-thread handoff stays inside the mailbox-file shape and no
Lumen object is shared or captured across the boundary.

- **Background `run` tool call: buildable now**, with a real limitation
  (no exit status while streaming, and it inherits lumen#6's un-killable
  child either way).
- **Subagent (independent turn loop): buildable now for a reduced,
  auto-approved loop** -- not the `Session` class, a worker-local
  reimplementation of its shape built from the same free functions. Full
  parity (approval gating, cancellation) is not proven here and would need
  its own short spike before being trusted.

## What was built

`src/spike/` (new files, throwaway, not wired into `make build`/`make test`,
`src/spike/main.ts`/`fake_relay.ts`/`slow_http.ts` from #14 untouched):

- `mailbox.ts` -- the single-writer/single-reader mailbox primitive #14
  proved, generalized: `appendMailbox(path, tag, payload)` (worker side,
  timestamps every write) and a `MailboxReader` class (main-thread side
  only, never touched by a worker) that drains new lines and logs
  `recv_at`/`observed_at`/`latency_ms`, the same fields #14's `main.ts`
  logged by hand.
- `bg_worker.ts` -- two zero-parameter, zero-capture top-level functions,
  the only shape `Worker.run` verifies safe (spec 059):
  - `backgroundRunLoop()`: `child_process.spawn`s a shell command and
    relays each stdout line to a mailbox as it arrives, instead of
    blocking the caller until the command exits (`spawnSync`, what
    `src/tools/run.ts` uses today).
  - `subagentLoop()`: a reduced turn loop, built from scratch, that calls
    the *real* `streamChat` (`src/providers/openai.ts`, the same function
    `LiveProvider.ask` calls in production) against a fake but
    protocol-real OpenAI-compatible SSE endpoint, dispatches any tool call
    through the *real* `run()` (`src/tools/run.ts`), and relays deltas,
    tool calls, tool results, and the final answer to a mailbox. Structure
    mirrors `Session.submit()`'s loop (`src/session/session.ts:59-134`)
    closely enough to be a fair stand-in for it, with the approval gate and
    frame-subscriber machinery deliberately left out (see Limitations).
  - Configuration reaches both functions the same way `src/relay/client_worker.ts`'s
    `receiveLoop` already gets its host/port/session id: module-level `let`
    globals, set by `configureBackgroundRun`/`configureSubagent` on the main
    thread *before* `Worker.run` is called. `std.Thread.spawn` (spec 059's
    own implementation section) is a real memory-visibility barrier -- every
    write before the spawn call is guaranteed visible to the new thread --
    so this is not a new hazard, it is the same happens-before argument
    spec 059 already leans on for the arena allocator, applied to plain
    globals instead of captures. Unlike `client_worker.ts`'s own
    `g_socket`, nothing here is written back into a global by the worker;
    every result leaves the worker only through the mailbox file, so this
    spike introduces no version of the one cross-thread read/write pattern
    already sitting in shipped code.
- `fake_openai.ts` -- an `http.createServer` two-parameter streaming
  handler standing in for a real provider, on `:8478`. Two fixed response
  scripts (`/t1/v1/chat/completions` streams a fragmented tool-call SSE
  response byte-for-byte in the shape `src/providers/openai.test.ts`
  already tests against `consumeStream`; `/t2/...` streams a final-answer
  response), selected by request path rather than by any server-side
  counter or `Map`. That is a deliberate design constraint, not a style
  choice: lumen-lang-org/lumen#12, filed earlier this session, is a
  confirmed segfault the moment an `http.createServer` handler touches a
  module-level `Map` from two different thread-pool worker threads. This
  spike needed a stateful-looking fake server and got one without going
  near that crash by keeping all per-request state either in the request
  path or freshly allocated inside the handler call.
- `bg_main.ts` -- the orchestrator. Phase A starts `backgroundRunLoop` in
  a worker, then runs two sequential foreground child-process turns of its
  own (standing in for "the user's own blocking turn, and then a second
  one"), draining the run-mailbox after each foreground blocking read
  returns, then awaits the worker's promise. Phase B starts `subagentLoop`
  in a worker, runs a third foreground turn concurrently, drains the
  agent-mailbox the same way, then awaits.

Run by hand (matching #14's own verification approach exactly):

```
lumen compile src/spike/fake_openai.ts
lumen compile src/spike/bg_main.ts
./fake_openai &
./bg_main
```

## Evidence

Two independent runs. Full output, unedited.

### Run 1

```
main: t=1787285262977 spawning background run worker (a 6-tick, 6s shell loop)
main: t=1787285262977 starting foreground turn 1 while the background run is (hopefully) in flight
main: foreground turn 1 observed at 1787285262979 blocked_ms=0 line=[fg-turn1-tick-1
]
main: observed [LINE] bg-run-tick-1 during [foreground turn 1] recv_at=1787285262979 observed_at=1787285262980 latency_ms=1
main: foreground turn 1 observed at 1787285263981 blocked_ms=1001 line=[fg-turn1-tick-2
]
main: t=1787285264983 foreground turn 1 done, starting foreground turn 2
main: foreground turn 2 observed at 1787285264985 blocked_ms=0 line=[fg-turn2-tick-1
]
main: observed [LINE] bg-run-tick-2 during [foreground turn 2] recv_at=1787285263981 observed_at=1787285264985 latency_ms=1004
main: observed [LINE] bg-run-tick-3 during [foreground turn 2] recv_at=1787285264983 observed_at=1787285264985 latency_ms=2
main: foreground turn 2 observed at 1787285265986 blocked_ms=1001 line=[fg-turn2-tick-2
]
main: observed [LINE] bg-run-tick-4 during [foreground turn 2] recv_at=1787285265985 observed_at=1787285265986 latency_ms=1
main: observed [LINE] bg-run-tick-5 during [final drain, phase A] recv_at=1787285266986 observed_at=1787285268991 latency_ms=2005
main: observed [LINE] bg-run-tick-6 during [final drain, phase A] recv_at=1787285267988 observed_at=1787285268991 latency_ms=1003
main: observed [DONE] lines=6 during [final drain, phase A] recv_at=1787285268990 observed_at=1787285268991 latency_ms=1
main: t=1787285268991 background run worker finished, lines=6
main: t=1787285268991 spawning background subagent worker
main: t=1787285268991 starting foreground turn 3 while the subagent is (hopefully) streaming
main: foreground turn 3 observed at 1787285268994 blocked_ms=0 line=[fg-turn3-tick-1
]
main: foreground turn 3 observed at 1787285269994 blocked_ms=1000 line=[fg-turn3-tick-2
]
main: foreground turn 3 observed at 1787285270996 blocked_ms=1002 line=[fg-turn3-tick-3
]
main: observed [TOOLCALL] run {"command":"echo subagent-tool-ran"} during [foreground turn 3] recv_at=1787285270198 observed_at=1787285270996 latency_ms=798
main: observed [TOOLRESULT] exit 0 subagent-tool-ran during [foreground turn 3] recv_at=1787285270200 observed_at=1787285270996 latency_ms=796
main: observed [DELTA] Background subagent finished: the run tool executed and reported success. during [foreground turn 3] recv_at=1787285270547 observed_at=1787285270996 latency_ms=449
main: observed [FINAL] Background subagent finished: the run tool executed and reported success. during [foreground turn 3] recv_at=1787285270847 observed_at=1787285270996 latency_ms=149
main: t=1787285271999 background subagent finished, steps=1
```

### Run 2, run independently a few minutes later

```
main: t=1787285284577 spawning background run worker (a 6-tick, 6s shell loop)
main: t=1787285284578 starting foreground turn 1 while the background run is (hopefully) in flight
main: foreground turn 1 observed at 1787285284580 blocked_ms=0 line=[fg-turn1-tick-1
]
main: observed [LINE] bg-run-tick-1 during [foreground turn 1] recv_at=1787285284580 observed_at=1787285284581 latency_ms=1
main: foreground turn 1 observed at 1787285285582 blocked_ms=1001 line=[fg-turn1-tick-2
]
main: observed [LINE] bg-run-tick-2 during [foreground turn 1] recv_at=1787285285582 observed_at=1787285285582 latency_ms=0
main: t=1787285286584 foreground turn 1 done, starting foreground turn 2
main: foreground turn 2 observed at 1787285286585 blocked_ms=0 line=[fg-turn2-tick-1
]
main: observed [LINE] bg-run-tick-3 during [foreground turn 2] recv_at=1787285286584 observed_at=1787285286585 latency_ms=1
main: foreground turn 2 observed at 1787285287587 blocked_ms=1002 line=[fg-turn2-tick-2
]
main: observed [LINE] bg-run-tick-4 during [foreground turn 2] recv_at=1787285287586 observed_at=1787285287587 latency_ms=1
main: observed [LINE] bg-run-tick-5 during [final drain, phase A] recv_at=1787285288589 observed_at=1787285290593 latency_ms=2004
main: observed [LINE] bg-run-tick-6 during [final drain, phase A] recv_at=1787285289591 observed_at=1787285290593 latency_ms=1002
main: observed [DONE] lines=6 during [final drain, phase A] recv_at=1787285290592 observed_at=1787285290593 latency_ms=1
main: t=1787285290593 background run worker finished, lines=6
main: t=1787285290593 spawning background subagent worker
main: t=1787285290593 starting foreground turn 3 while the subagent is (hopefully) streaming
main: foreground turn 3 observed at 1787285290599 blocked_ms=0 line=[fg-turn3-tick-1
]
main: foreground turn 3 observed at 1787285291598 blocked_ms=999 line=[fg-turn3-tick-2
]
main: foreground turn 3 observed at 1787285292601 blocked_ms=1003 line=[fg-turn3-tick-3
]
main: observed [TOOLCALL] run {"command":"echo subagent-tool-ran"} during [final drain, phase B] recv_at=1787285291800 observed_at=1787285294588 latency_ms=2788
main: observed [TOOLRESULT] exit 0 subagent-tool-ran during [final drain, phase B] recv_at=1787285291803 observed_at=1787285294588 latency_ms=2785
main: observed [DELTA] Background subagent finished: the run tool executed and reported success. during [final drain, phase B] recv_at=1787285293931 observed_at=1787285294588 latency_ms=657
main: observed [FINAL] Background subagent finished: the run tool executed and reported success. during [final drain, phase B] recv_at=1787285294533 observed_at=1787285294588 latency_ms=55
main: t=1787285294588 background subagent finished, steps=1
```

## What the numbers show

- **Phase A (background `run` tool call).** `bg-run-tick-1` through
  `bg-run-tick-4` are observed *during* foreground turns 1 and 2 in both
  runs -- the six-second background shell loop was genuinely running while
  two separate foreground child processes were each spawned, read to
  completion, and closed, one after the other. That is the concrete case
  the ticket asked about: "the main terminal loop keeps accepting
  keystrokes and even starting a second foreground turn" while a `run`
  call is in flight. `bg-run-tick-5`/`-6` land in the final drain only
  because the two foreground turns (4 ticks, ~4s total) finished before
  the background loop's 6th second did -- a timing artifact of the demo's
  chosen durations, not a mechanism limit; `await runPromise` blocks only
  as long as it takes the background loop to finish emitting its own last
  two ticks (about 2s in both runs), never longer.
- **Phase B (subagent).** `TOOLCALL`/`TOOLRESULT`/`DELTA`/`FINAL` all
  arrive correctly and in the right order in both runs, produced by a real
  call into `streamChat` and a real call into `run()` running entirely
  inside the worker thread, with the main thread meanwhile blocked in its
  own unrelated three-tick foreground child process. Run 1 shows the
  frames interleaved mid-poll (observed during "foreground turn 3" itself,
  latency 149-798ms); run 2 shows them all landing in the final drain
  instead (latency up to 2788ms) -- both are the same proven behavior, the
  fake provider's fixed ~1.5s of scripted `process.sleep` calls landed
  slightly later relative to the foreground turn's own three one-second
  ticks the second time. Either way `steps=1` both runs: the loop ran
  exactly once through the tool-call branch and once through the
  final-answer branch, matching the two-turn script, with no corruption,
  no hang, no crash.
- Both runs exit 0. No new Lumen crash, hang, or miscompile was hit by
  either experiment.

## Experiment order, and what was ruled out first

The ticket asked to check the simplest thing first: whether `child_process`
already has something beyond `spawnSync` that is genuinely non-blocking, so
a background `run` tool would not need `Worker` at all. It does not.
`specs/450-persistent-subprocess/spec.md` (`child_process.spawn` /
`ChildProcess`, checked directly on the lumen checkout) states this in its
own "Out of scope" section: "No async/await integration: `readLine` is a
blocking read." #14's own `main.ts` already demonstrated this by
measurement (`cp.readLine()` blocking ~1000ms per line on a spawned
`sleep`-based dripper); this spike did not need to re-measure it, only
confirm the spec's text rules it out on paper too. So step 1 of the
question is answered directly: no free non-blocking spawn exists; the
`Worker` + mailbox mechanism is required, not optional, for a background
`run` tool call, exactly the shape built above.

## Limitations, stated plainly

**Background `run` tool call:**

- `backgroundRunLoop` uses `child_process.spawn` for incremental
  line-by-line relay, but spec 450's `ChildProcess` has no exit-status
  accessor -- only `close()`, which blocks until the child exits and
  returns nothing. `src/tools/run.ts`'s existing `run()` gets `r.status`
  from `spawnSync` instead, which cannot stream. A real background `run`
  tool has to choose: stream output with no exit code available until the
  caller separately re-checks (e.g. a trailing `echo $?` line the caller
  parses out of the stream itself), or drop streaming and poll a
  `spawnSync`-based worker's own single Promise result instead, losing the
  live-progress case this ticket cares about. Not a blocker, a real
  trade-off a future ticket needs to pick.
- Inherits lumen#6 (open, filed before this session started fresh work):
  no `kill`, no `pid`, no timeout on a spawned child either way. A
  background task the user wants to cancel still cannot actually be
  stopped once started -- the mailbox mechanism proven here reports
  progress out, it does not add a way to signal cancellation in. The best
  available today is what `src/tools/run.ts` already does for the
  synchronous case: measure elapsed time and flag `killed: true` after the
  fact, never actually interrupting anything.

**Subagent:**

- `subagentLoop` is a worker-local reimplementation of `Session.submit()`'s
  shape, not `Session.submit()` itself, and it is missing two pieces of
  what `Session` actually does, on purpose, because neither is proven safe
  here:
  - **Approval.** `Session.submit()` calls `this.approval.check(...)`
    synchronously per tool call and can be denied or (in the interactive
    terminal) block on a user's answer. This spike's `subagentLoop` never
    asks -- it dispatches its one scripted tool call unconditionally. A
    real subagent that needs interactive approval would need a second,
    independent mailbox handshake (worker writes an approval request,
    polls a second mailbox file for the main thread's answer) layered on
    top of the same proven primitive -- plausible given everything proven
    here, but not itself proven; it needs its own short follow-up check
    before being trusted, particularly around what a worker thread should
    do while polling-waiting on user input mid-turn.
  - **Cancellation.** `Session.cancel(turnId)` sets a field the running
    turn checks between provider chunks (`this.cancelledTurnId`,
    `LiveProvider`'s `watch.tripped()`). This spike's `subagentLoop` cannot
    be stopped early once `Worker.run` has started it -- spec 059 lists
    worker cancellation as explicitly "not planned" this pass ("no
    cancellation hook exists to wire up"), and this spike does not
    contradict that: every global it reads is written once, before the
    `Worker.run` call, never afterward. A cancel flag written *after*
    spawn and polled by the worker mid-loop is a different, unverified
    claim -- it would very likely work, by the same happens-before
    argument as `client_worker.ts`'s already-shipped `g_socket` write, but
    that is exactly the one pattern in this codebase's existing worker
    code that is a real, undocumented hazard rather than a proven-safe
    one, and this spike deliberately did not add a second instance of it
    without first proving it in isolation.
  - Frame delivery (`Subscriber`/`emit`) is not reused either -- the
    mailbox's flat tagged-line protocol stands in for it, same as #14's
    frames-via-mailbox already established for the relay.
- `ToolsRegistry.dispatch` (the class the real `Session` calls into) is not
  used directly -- its methods need `this.root`, a class instance, which
  cannot cross the `Worker` boundary. This spike calls the free function
  underneath one tool (`run()` from `src/tools/run.ts`) directly instead.
  That generalizes cleanly: `readFile`/`writeFile`/`editFile`/`listDir`/
  `grep` in `src/tools/files.ts` are already plain `(root, ...) -> Result`
  functions with no class dependency, so a worker-hosted subagent tool
  loop could dispatch any of them the same way, given the same root string
  passed in as a global at spawn time. Confirmed by reading `files.ts`
  directly, not assumed.

## What this does not change

Nothing about #14's own conclusion, spec 003, or the relay's design. This
spike adds one thing to the record: the mailbox-file handoff generalizes
past frame strings (what #14 proved) to arbitrary tagged progress lines
from a genuinely useful worker payload -- a streamed shell command and a
real provider-call-plus-tool-loop -- and a `Session`-shaped background loop
is buildable without it ever being a `Session` instance. No new upstream
Lumen issues were filed by this spike; both experiments used only
primitives already proven or already documented (`Worker.run`,
`child_process.spawn`, `http.createServer`'s two-parameter streaming
handler, `fs.appendFileSync`/`readFileSync`), and the one relevant gap this
spike deliberately worked around rather than hit (lumen#12's `Map`-across-
threads segfault) is already filed.

## Sketch for a follow-up ticket, concrete enough to build from

**Background `run` tool call (v1, buildable next):**

1. Add a `background: bool` field to the `run` tool's args schema
   (`src/tools/schemas.ts`'s `RUN_SCHEMA`).
2. When set, `ToolsRegistry.runRun` calls `configureBackgroundRun(command,
   mailboxPath)` (this spike's own functions, promoted out of `src/spike/`)
   with a fresh per-call mailbox path (e.g. `/tmp/joule-run-<callId>.log`,
   one file per call, sidestepping lumen#12 the same way this spike did by
   never sharing one mailbox or one `Map` across calls) and calls
   `Worker.run(backgroundRunLoop)`, returning a `ToolResult` immediately
   (`{ ok: true, output: "started in background, task id <callId>" }`)
   instead of waiting on the child.
3. `Session` (or whatever owns the main loop's poll points -- the same
   points #14 identified: after every blocking read returns) gains a small
   main-thread-only registry (`Map<string, { mailboxPath, reader,
   startedAt, done }>`, safe because it is only ever touched by the main
   thread) and drains every open background task's mailbox at each of
   those points, same as this spike's `MailboxReader.drain` calls.
4. A `/tasks` command surfaces the registry's current state. A finished
   task's `DONE` mailbox line flips its entry and can emit a frame the next
   time the terminal is idle enough to show it.
5. Ship it with the two limitations above stated in the tool's own
   description, the same honesty `RUN_SCHEMA`'s current text already
   applies to the synchronous budget-not-kill case.

**Subagent (v1, narrower than the ticket's full ask, buildable next):**

1. A `subagent` tool call (new schema: `task: string`, no interactivity)
   that calls `configureSubagent(...)` and `Worker.run(subagentSubLoop)`,
   `subagentSubLoop` being this spike's `subagentLoop` promoted out of
   `src/spike/`, generalized to dispatch any of the five free tool
   functions (not just `run()`) by tool name, and pointed at the real
   provider's base URL/model/API key instead of the fake one.
2. No approval gate in v1 -- state plainly that a subagent tool call
   auto-approves every tool it uses inside its own scope, the same
   "narrow, honestly-labeled v1" pattern this stdlib already uses
   elsewhere (zlib's one format, Buffer's three encodings, `Worker.run`'s
   own scalar-only v1).
3. No cancellation in v1, for the reason above -- a subagent runs to
   completion or the whole process exits with it, and the tool's own
   description says so.
4. Approval and cancellation are both real v2 candidates, and both need
   their own short, isolated spike first (an approval handshake over a
   second mailbox; a post-spawn global flag polled mid-loop) before either
   is trusted enough to ship -- not because either looks unlikely to work,
   but because neither is proven by anything built this session, and
   claiming otherwise would be exactly the kind of unverified extension
   spec 059 itself declined to make for closures.
