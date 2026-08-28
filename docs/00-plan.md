# v0: plan and architecture

`code` is an agentic coding terminal, you run it in a repo, you tell it what you
want, it reads and edits files and runs commands to get there. What it does that
Codex and Kimi Code do not: **the session it is running can be driven from a web
page**. You start it on the workstation, you keep steering it from a laptop or a
phone.

## The one invariant

**The terminal is authoritative.** It holds the workspace, the history and the
tool loop. The relay is a pipe with a short memory: it pairs a browser to a
terminal, forwards frames both ways, and keeps a bounded replay buffer so a
browser that joins late sees the transcript. The relay never runs a tool, never
holds a checkout, and stores nothing durable. If the relay dies, the terminal
keeps working; you lose the web view, not the work.

## Shape

```
  your machine                        joule.sh                          browser
  ┌───────────────────┐          ┌───────────────────────┐          ┌──────────┐
  │ code (Lumen bin)  │  POST    │ console proxy         │          │ web      │
  │   turn loop       │ ───────▶ │   readSession→x-user  │          │ session  │
  │   tools           │ ◀─ SSE ─ │ relay (Lumen http)    │ ◀─ SSE ─ │          │
  │   approval gate   │          │   pair, forward, ring │ ─ POST ▶ │          │
  └───────────────────┘          └───────────────────────┘          └──────────┘
        │
        ├── fs + spawn, jailed to the workspace root
        └── SSE to the model (joule engine, or any OpenAI-compatible endpoint)
```

## Decisions, and what forced them

**Lumen for the whole thing**, CLI, relay and the page the relay serves. One
language, one binary per side, and it dogfoods the toolchain.

What the stdlib already gives us: `process.spawn` with `ChildProcess.readLine`,
sync and async `fs`, `path`, `crypto.randomUUID` and `randomBytes`, `JSON`,
`Promise`, `http.createServer` and `http.request`, `zlib`, `Worker`. Nothing in
v0 needs a capability the compiler lacks, with the two exceptions named below.


**WebSocket between the three, SSE to the model.** std-contrib ships
`packages/websocket`: framing, handshake, session, client and server, with tests
and a check against a real browser, and `packages/socketio` on top of it
completes a handshake with the unmodified socket.io client. So the terminal and
the browser each hold one bidirectional connection to the relay, rather than a
stream one way and a POST for every piece of intent the other.

The model link stays SSE over `http.stream` (spec 452), which was written for
token streams and is what providers speak.

The cost is that `receive()` blocks, and says so: *"a caller that needs
otherwise wants a thread rather than a flag here."* During a turn the terminal
is already draining the model stream and may have a child process running, so
the relay connection is owned by a `Worker`. That is what #14 has to prove
before #10 is written. Full reasoning in [spec 003](../specs/003-transport/spec.md).

**#9 shipped as two listeners plus a discovered third, and a vendored
websocket package.** `http.createServer` (the pairing endpoints) and
`serveWebSocket` (the frame relay) are both blocking accept loops and
cannot share a call stack, exactly as #14 was expected to answer for the
terminal side -- the same mechanism works here: `Worker.run` hosts one
accept loop on a background thread (a genuinely zero-capture top-level
function, the safe case spec 059 describes) while the other runs on the
main thread, keeping the process alive. This is the same answer #14 has to
independently prove for the terminal's `receive()` loop, not a different
one -- worth confirming when #14 lands.

What #14's own framing did not anticipate: `net.createServer` (which
`serveWebSocket` is built on) turned out to accept **one connection at a
time, process-wide** -- its accept loop only calls `accept()` again after
the previous handler returns, and a WebSocket handler never returns while
the connection is open. A `Worker`-hosted accept loop doesn't fix this,
since the socket is closed unconditionally the instant the handler
returns, so a handler can't hand the connection off and let the loop
continue. Filed upstream as
[lumen#11](https://github.com/lumen-lang-org/lumen/issues/11). The
workaround actually shipped: a third listener, so the terminal and the
browser each get their own accept loop and their own port
(`JOULE_RELAY_WS_PORT` for the terminal, `JOULE_RELAY_WS_BROWSER_PORT` for
the browser, alongside `JOULE_RELAY_HTTP_PORT` for pairing) -- sufficient
for v0's one-terminal-one-browser-per-session scope, not a fix for a relay
serving many sessions' connections concurrently on one port, which needs
the upstream fix.

**Since fixed upstream, and the ceiling is gone.** lumen#11 was fixed in
[lumen@4053a5a](https://github.com/lumen-lang-org/lumen/commit/4053a5a) and
first shipped in `v0.6.3`; `net.createServer` now hands each accepted
connection to an `xev.ThreadPool` worker, the same treatment
`http.createServer` got, so `accept()` loops back immediately while earlier
connections are still being served. The serial loop survives only on
`wasm32-wasi`, which has no OS threads and is not a target we build. CI has
pinned `v0.7.1` since before any of this was in doubt. Verified directly
against `bin/relay`: three terminals and three browsers, on the two
WebSocket ports, all handshake in single-digit milliseconds and carry
frames in both directions simultaneously, and the identical tree built with
the pre-fix compiler fails on the second connection to either port
([#161](https://github.com/joule-sh/code/issues/161)). The three-port split
still ships - one listener per role is a clean enough shape on its own
terms - but it is no longer load-bearing, and nothing about serving many
sessions on shared ports is blocked by the runtime. What is still real, and
is the constraint worth designing against, is that `PeerRegistry` and
`SessionStore` are shaped for exactly one terminal peer and one browser
peer per session.

Anything built on `net.createServer` now also gets the trade-off that comes
with a thread pool: a handler genuinely runs on several OS threads at once,
so shared mutable state in a handler is a real data race rather than a
theoretical one.

Separately, `packages/websocket`'s handshake parses every header off the
upgrade request and then keeps only five of them -- fine for a package with
no caller needing the rest, wrong for a relay that trusts a proxy-set
`x-user` header and carries a bearer secret over the handshake rather than
the frames. Vendored locally under `src/vendor/websocket/` (the same
reason `tty` is vendored, files rather than a URL import, though here
because the package needed a local change rather than a native shim) with
an added `headers: Map<string,string>` on `Upgrade` and `Peer`, built the
same way spec 459 built it for `HttpRequest`.

**The terminal is a full TUI, via a std-contrib shim, not a compiler feature.**
Lumen has no `setRawMode`, no `isatty`, no termios, and its FFI only marshals
scalars and strings across the C boundary (specs 009/023) -- a `struct termios*`
cannot cross it directly. std-contrib's `tty` package hides that struct
entirely inside a small C shim and exposes raw-mode enable/disable and a
byte-at-a-time read as plain scalar functions; terminal size comes the same
way, two scalar-returning functions rather than one call with out-params, since
`Ref<T>` is disallowed on FFI parameters (spec 024). Cursor movement, the alternate
screen, and redraw are ANSI escape sequences, plain strings, no FFI needed for
those at all. zig-spoon was considered and dropped: GPLv3, and every other
native terminal library here (SQLite, QuickJS) is permissively licensed. The
terminal renders a persistent input region with scrollback above it, same
shape as this session's own CLI, and a running turn can be interrupted from
the keyboard, not just from the web session's POST.

Ctrl-C cancellation is cooperative polling, not a background thread: a
`Worker` can only carry scalars across its boundary (spec 059), so the main
thread instead checks stdin between streamed model chunks and on the
approval gate's ~100ms poll tick, which means a turn keeps running for that
last stretch of a network wait with no chunks flowing before a cancel lands
- the same kind of best-effort gap the run tool's own timeout already has.

That same silent stretch is why the Quanta loading indicator (#67) only shows
a static "thinking" state rather than an animated one. `Session.submit()`
blocks synchronously inside `provider.ask()` until the first delta arrives,
and curl against the real provider during that ticket confirmed the
connection is genuinely quiet in between - no SSE comment or keep-alive
lines, `readLine()` just sits on the socket. Nothing periodic exists to
advance a frame on, so the indicator is drawn once, synchronously, the
moment `turn.start` fires and before the blocking call begins, then left
alone until the next real frame overwrites it.

**Auth is the console's job, not the relay's.** The console already turns a
cookie into a user (`readSession`) and mints the `x-user` document the engine
consumes (`xUserDocument`). The relay sits behind that proxy and trusts `x-user`,
exactly as the engine does. No cookie parsing, no user table, no second auth
implementation to keep correct.

**Pairing binds an account to a session:**

1. CLI `POST /sessions` → `{sessionId, secret, code, expiresAt}`. Session unowned.
2. CLI prints the code and the URL, holds its SSE downstream authenticated by
   `secret`.
3. Browser (already logged in; proxy attaches `x-user`) `POST /pair {code}` →
   relay binds the session to that uuid. The code is single-use, short, and
   expires in ten minutes.
4. Afterwards the relay serves that session's frames only to requests carrying
   the same uuid. A leaked code past expiry is worth nothing; a leaked code
   inside the window still needs a joule.sh login.

**The model is behind an interface.** v0 ships an OpenAI-compatible SSE adapter,
which covers both the joule engine and the llama.cpp server on the 4070, the
same one the staging benchmark settled on.

## What v0 is

Run `code` in a repo. It prints a pairing code. Open the page, enter the code,
type "add a health endpoint and a test for it". Watch it read files, propose an
edit, tap approve, watch the edit land on the workstation and the test run. That
whole path, tested end to end in CI.

## What v0 is not

No hosted sandbox, the agent runs on your machine only. No multi-agent, no
subagents, no MCP. No session persistence across restarts. Each of these is a
follow-up, not a gap we forgot.

Since written: subagents landed with #77, and session persistence with
`joule --continue`. No hosted sandbox and no MCP still hold.

## Code organization

No file over 450 lines, enforced the same way the no-comments rule is: the
pre-commit hook refuses a commit that leaves a `.ts` or `.c` file past the cap.
A file that wants to grow past it is telling you it holds more than one
concern - split it into a module, in a folder named for the concern, rather
than letting one file keep absorbing everything nearby.

One folder per concern, not a flat pile in `src/`: `protocol/` for the frames,
`relay/` for the service, `demo/` for the terminal spike, and the same going
forward - `session/` for #3, `providers/` for #4, `tools/` for #5 and #6,
`approval/` for #7, `terminal/` for #8. A concern that needs one file gets one
file in its folder; a concern that needs three gets three, still findable by
where they live rather than by scrolling a folder of forty flat files.

## Order

```
#1 skeleton+CI ──┬── #2 protocol ──┬── #3 turn loop ──┬── #4 provider
                 │                 │                  ├── #5 file tools
                 │                 │                  ├── #6 run tool
                 │                 │                  ├── #7 approval
                 │                 │                  └── #8 terminal
                 │                 ├── #9 relay ──┬── #10 attach
                 │                 │              ├── #11 web page
                 │                 │              └── console: proxy
                 └─────────────────────────────── #12 e2e ── #13 release
```

Lanes that can run in parallel once #2 and #3 land: the tools (#5, #6), the relay
(#9), and the web page (#11).

**#14 is a spike and it runs first in the relay lane.** Whether one process can
hold two `http.stream` handles and a spawned child at once decides whether #10
is a live downstream or a poll. Answer it before #10 is written, not after.

## #10 landing notes

`src/vendor/websocket/client.ts` is now vendored (std-contrib's `client.ts`,
`connectWebSocket`/`sendText`/`receive`/`closeConnection`), alongside a small,
attributed extension: `upgradeRequest` (`handshake.ts`) takes a 5th
`extraHeaders: Map<string, string>` argument so the terminal can send
`x-relay-secret` on the upgrade request, the same header shape #9 already
taught the server side to read.

The terminal's relay connection follows #14's proven shape exactly: a
zero-capture top-level `receiveLoop` (`src/relay/client_worker.ts`), spawned
via `Worker.run`, blocks in `receive()` and appends each inbound frame to a
single-writer/single-reader mailbox file; the main thread drains it on the
same poll ticks the approval gate's `onPoll` and a new `readKeyTimeout`
(`vendor/tty/tty.ts`, a polling sibling of `readKey`) already provide, so no
new blocking-vs-polling structure was invented. Outbound frames write
directly to the connection's socket from the main thread via a small
module-level box the worker populates on connect - the same
shared-object-across-`Worker.run`-threads pattern `relay.ts` itself already
uses for `store`/`registry`, not a new hazard.

`server.ts`'s `handleConnection` gained an `onClose(peer, graceful)` callback,
fired on all three paths that end a connection (a bare hangup, a real WS
close frame, and a protocol failure) - `graceful` distinguishes a real close
frame from the other two. `store.ts` gained `detachTerminal`. `ws.ts` only
calls it for a *graceful* close on a terminal peer: an unexpected drop must
not delete the session, or reconnect+resume would have nothing to resume
into.

**A severe pre-existing bug, found while verifying this ticket end to end,
filed as
[lumen-lang-org/lumen#12](https://github.com/lumen-lang-org/lumen/issues/12):**
a `Map` (or any object holding one) shared between an `http.createServer`
handler and anything else segfaults inside the hashmap's own `eql` the first
time a request lands on a different thread-pool worker than whichever one
last touched it. Reproduces with a bare `Map<string, int>` and a
`http.createServer` handler, no relay or WebSocket code involved at all.
This is `SessionStore`'s exact shape (`sessions`, `rings`, and
`RateLimiter.attempts` are all plain `Map`s touched from the HTTP handler,
the terminal-WS listener, and the browser-WS listener). Attach and detach,
each of which only crosses the HTTP thread and the terminal's own WS thread,
verified live and repeatedly clean; a live browser sending a frame that
reaches `store.appendFrame` crosses a third thread and reproduces the crash
reliably. Out of scope for #10 to fix - it is #9's `SessionStore` design
running into a Lumen runtime bug, not anything this ticket's own code
touches - but it blocks a real multi-session relay today and deserves a
dedicated ticket.

**lumen#12 fixed for the pairing endpoints by dropping `http.createServer`
entirely.** The bug needs `http.createServer`'s own thread pool to
reproduce - it does not occur with `net.createServer`, which only ever
runs one connection at a time. `runHttpListener` now parses HTTP/1.1
itself on top of `net.createServer` (`src/relay/http_transport.ts`), the
same technique `src/vendor/websocket/handshake.ts` already used to read an
upgrade request off a raw socket, extended to also read a body sized by
`content-length`. `makeHttpHandler` in `http.ts` is untouched - it is
still the pure `(HttpRequest) -> HttpResponse` function the tests exercise
directly, only what calls it changed. Same trade-off already accepted for
the WS ports: single-connection-at-a-time in exchange for never letting
two threads touch `SessionStore`'s `Map`s at once, which is what the crash
actually needed.

## #11 landing notes

Ticket #11's own text says `EventSource` with `?since=`. That is stale, the
same pattern earlier tickets in this project had - the real transport, already
built for #9/#10 and recorded in [spec 003](../specs/003-transport/spec.md),
is WebSocket with a `resume {since}` frame. The page speaks that, not SSE.

**Served as `GET /` off the relay's existing HTTP transport.** `http.ts`
gained one more route alongside `/sessions` and `/pair`, returning a
self-contained HTML document assembled at request time by
`src/relay/web/web_page.ts` from four Lumen string constants under
`src/relay/web/`: `page_css.ts`, `page_html.ts`, `page_js_frames.ts` (the
frame vocabulary and the hand-ported renderer, below), `page_js_client.ts`
(pairing, the websocket client, reconnect, the DOM). Each stays under the
450-line file cap on its own; the page these constants render does not have
one, the cap is on the `.ts` file, not on the string it holds. The one
runtime-configured piece - which port the browser's WebSocket should dial,
`JOULE_RELAY_WS_BROWSER_PORT` - is injected as a small inline
`window.__JOULE_CONFIG__` script at render time rather than hardcoded, so the
same served bytes are correct regardless of how the relay was configured.

**No comments anywhere in the page's own HTML/CSS/JS, not only in the
surrounding `.ts`.** `.githooks/pre-commit` greps every added line of a
`.ts` file for `//` or `/*`, after stripping `scheme://` URLs - it does not
distinguish Lumen source from a string literal's contents, so a `//` typed
into the embedded JS (a URL scheme, a comment, even two adjacent slashes in
an unrelated string) trips the same check as a real comment. The
WebSocket URL builder and a `sessionIdFromPath` test both needed a literal
`//`; both now build it from two single-slash string pieces so the check
never sees two consecutive slashes in the source text, rather than carrying
an actual comment or an exception to the rule.

**The browser can't set a header on a WebSocket handshake - this is a
real, permanent platform limit, not a Lumen gap.** `POST /pair` still
authenticates with a real `x-user` header (a plain `fetch()` can set one),
but the browser's WebSocket connection to `/w/:id/ws` cannot carry one.
`src/relay/ws.ts`'s `handleBrowserMessage` now falls back to an `x-user`
query parameter when the header is empty, via a new `src/relay/query.ts`
(`splitPathAndQuery`, `queryParam`, both plain string scanning, no library -
none existed anywhere reusable in this codebase). `roleForPath` and
`sessionIdFromPath` now operate on the path with the query string already
stripped, since `Peer.path` carries it verbatim from the request line and
the old suffix match (`endsWith("/ws")`) would otherwise never match a URL
with a query string on it at all.

**This is a placeholder identity, not authentication, and that is
deliberate for v0.** The page generates a `crypto.randomUUID()` on first
load (a manual random-hex fallback for a browser without it), persists it
in `localStorage`, and sends it as `x-user` on both `POST /pair` and the
WebSocket query string. Anyone who can reach the relay directly could
self-assert any `x-user` this way - acceptable only because spec 002 rule 4
already restricts the relay to loopback or the tailnet, never a public
interface, and the real identity is meant to come from `joule-sh/console`'s
proxy (console#7), which is out of scope here and does not exist yet. A
relay exposed without that proxy in front of it has no real auth model; this
is not one on its own.

**The web renderer is a deliberate, hand-ported duplicate of
`src/terminal/renderer.ts` and `src/terminal/fixture.ts`, not an
oversight.** There is no cross-language import from Lumen into browser JS,
so `page_js_frames.ts` carries its own `fixtureScript()` and
`renderFrameText()`, same seq numbers, same field names, same output
strings, tracing the same `protocol/frames.ts` vocabulary both sides already
agree on. `scripts/verify_renderer.mjs` extracts the embedded JS from
`page_js_frames.ts`, runs it under Node's `vm` module, and asserts the exact
same substrings `src/terminal/renderer.test.ts` asserts against the exact
same fixture sequence - proof the two renderers describe one session the
same way, which is the point of the requirement, not a reimplementation of
it. It is not wired into `make test` or CI: this repo's CI is a separate
self-hosted runner and Node's presence there was not established, so the
honest thing was a script run by hand rather than a silent assumption. It
passed. `scripts/syntax_check.mjs` similarly parses `page_js_client.ts`
under `vm.Script` as a cheap guard against a syntax error in code no `lumen
test` run ever touches.

**Approval requests get cards and buttons; tool calls get a bordered card
too.** This is the ticket's own UX line, "tool cards, approval buttons",
not a departure from renderer parity - `renderFrameText()` (the parity-tested
function) still renders `approval.request` as the same `(y/n/a)` text the
terminal does, because the #8 fixture script contains no approval frame to
diverge on. The DOM-building code in `page_js_client.ts` is the second,
separate layer on top of the same decoded frame that turns that into
allow/deny/always buttons for a real session, exactly where the ticket asks
for the deviation from the terminal's keypress.

**End to end, against a real relay and a real terminal.** `bin/relay` and
`bin/joule --share` (in a `tmux` pane, since `joule` refuses to run without
a real tty) were run on staging; the terminal printed a real pairing code.
A small scripted Node client (`scripts/e2e_relay_check.mjs`, a hand-rolled
minimal WebSocket client in `scripts/miniws.mjs` since the sandbox has no
`ws` package and browsers/Node's own `WebSocket` can't set the header a
scripted *terminal* connection needs) paired against that code with an
`x-user` header, then opened the browser WebSocket with **no header at
all**, query string only, and received the real `session.hello` the live
`joule` process published. A second run of the same script created its own
session directly, pushed the full fixture sequence through as a scripted
terminal, and confirmed a scripted browser - again header-less, query-param
only - received all seven frames in order and that an `approval.reply` sent
back was forwarded to the terminal side. Phone usability was checked in a
real Chromium context resized to 375x812: no horizontal scroll on either
screen, and the allow/deny/always buttons render at roughly 106x49px each,
above the usual 44px touch-target minimum.

## #12 landing notes: the v0-closing end-to-end test

`src/e2e/` (`stub_script.ts`, `stub_http.ts`, `stub_model.ts`) plus
`scripts/e2e_full_stack.mjs` prove the whole path once, in CI: a scripted
browser pairs against a real `bin/relay`, a real `bin/joule --share` reads a
file, proposes a change, and the change lands on disk (or does not) depending
on an `approval.reply` the browser sent - the same claim `docs/00-plan.md`'s
"What v0 is" section has made since the first day of this project.

**Standalone Node script, not a `lumen test` file, and this was forced, not
preferred.** `child_process.spawn`'s `ChildProcess` has no `kill()`, no
timeout, and `close()` blocks in `wait()` until the child exits (spec 450,
also [lumen#6](https://github.com/lumen-lang-org/lumen/issues/6)) - a real
blocker for a harness that has to tear down a relay and a terminal that
otherwise run forever. `joule` also refuses to start without a real tty
(`isatty(STDIN)`), and Lumen has no pty allocation for a child it spawns.
Node's `child_process` has neither problem: `spawn(..., {detached:true})`
plus `process.kill(-pid, "SIGTERM")` kills a whole process group cleanly, and
`script -qec "<cmd>" logfile` (util-linux, already on the runner) allocates a
real pty for `joule` even when the harness's own stdin is closed - confirmed
directly before relying on it. The "browser" is a hand-rolled WebSocket
client because `websockets` isn't installed for Python and `ws` isn't
installed for Node on this box (checked, not assumed, matching the ticket's
own instruction) - `scripts/e2e_full_stack.mjs` imports `connect` straight
from `scripts/miniws.mjs`, the same hand-rolled client #9's own verification
script already used, rather than writing a second one.

**The stub model is a real Lumen program**, `net.createServer` plus a
hand-rolled HTTP/1.1 parser and chunked-transfer response writer
(`src/e2e/stub_http.ts`), the same shape `relay/http_transport.ts` uses and
for the same reason - `http.createServer`'s thread pool is what
lumen#12 needed to reproduce, and at the time `net.createServer` held one
connection at a time (lumen#11, since fixed) and so sidestepped it entirely
rather than risking it in new code. `src/e2e/stub_script.ts` builds
three fixed, scripted SSE response bodies (read the file, propose a fix via
the `run` tool, close out) keyed purely by a request counter - no history
parsing needed, since each scenario is one turn against a freshly started
server.

**The ticket's own text needed two corrections against what's actually
shipped, both confirmed by reading the real code before writing the harness,
not assumed:**

1. "The browser side is SSE and POSTs" is stale, same as several earlier
   tickets - it's WebSocket (spec 003, #9/#11), and the harness drives it as
   one.
2. The demo gates a `run` tool call, not `edit`/`write`. `approval/gate.ts`'s
   `needsAsking` only asks for `edit`/`write` when the mode is not `auto-edit`
   (`safe-auto` is the terminal's startup default now, and it auto-approves
   edits the same way) - in `auto-edit` mode, an edit or a
   write is auto-approved by design, and only `run` ever reaches the gate.
   The scripted model proposes a `run` command that appends to the seeded
   file, which is the one call in this codebase that can actually produce an
   `approval.request` today.

**A real gap this test surfaced and fixed: no `approval.request` frame was
ever put on the wire.** `Gate.check()` already called its `onRequest`
callback at exactly the right moment, and `renderFrame`/`styleFrame` already
knew how to render an `APPROVAL_REQUEST` frame if one arrived - but
`terminal.ts`'s `onRequest` only appended text to the local scrollback, never
called `session.emit`. A browser had no way to ever see or act on an
approval, in any version of this codebase before this ticket, which is
exactly the flow "What v0 is" describes as the point of the whole project.
Fixed in `src/terminal/terminal.ts`: `onApprovalRequest` now builds a real
`ApprovalRequestFrame` and calls `session.emit`, reusing `live.sessionSlot`
(already populated after `live.setSession(session)`) the same
box-indirection way `gateBox`/`relayBox` already work around `session` being
declared after the closures that need it. One frame now flows through the
same subscriber pipeline every other frame type already used, so local
scrollback rendering and relay publishing both come from the one path
instead of two.

**A genuine Lumen compiler bug, minimal repro filed as
[lumen#13](https://github.com/lumen-lang-org/lumen/issues/13):** a
`void`-returning function passed to `net.createServer` **by its bare name**
fails native codegen with `expected type 'void', found
'error{LumenThrow}!void'` if and only if that function's body calls
`fs.appendFileSync` (likely any throwing stdlib call). Wrapping the same
reference in an inline arrow - `net.createServer(port, (s: Socket) => {
handleConnection(s); })` - compiles cleanly regardless of what the handler
does. `src/e2e/stub_model.ts` ships with the arrow form.

**Timing and reliability.** Both cases together run in 1.4-5.9 seconds
locally (no artificial delays anywhere - the stub model answers instantly,
every wait in the harness is a polled condition with its own deadline, never
a fixed sleep assumed to be long enough), comfortably inside the ticket's
one-minute budget. Run 14 times in a row during development: 13 clean passes
and one real flake (a log-file read that ran once before the stub model's
`fs.appendFileSync` for the final request was visible to the harness's own
read), fixed by polling the log content with a deadline instead of a single
read after a fixed sleep - the same pattern already used for every other
wait in the script. Zero flakes in the 10 runs after that fix.

**CI**: a new `e2e` job in `.github/workflows/test.yml`, `runs-on:
[self-hosted, diff]` (the same runner label the existing `test` job already
uses), separate from it, `make e2e` (which depends on `build` plus a new
`bin/stub_model` target).

## #77 landing notes: background run tasks and subagents

Both pieces from the spike (`docs/02-background-task-spike.md`) are real,
shipped features now, built on the exact `Worker.run` + mailbox mechanism
#14 proved, generalized in two directions the spike itself flagged as
unproven: a streaming variant of the `run` tool, and a genuinely
bidirectional mailbox for a subagent's own approval requests.

**Background `run` tool call.** `run`'s schema gained a `background: bool`
field; approval still happens synchronously on the main thread, through the
exact same `Gate.check()` as any other `run` call, before a background
worker is ever spawned - only the execution after approval moves off-thread.
`src/tasks/background_run.ts` streams stdout line by line via
`child_process.spawn`, appending an exit-code marker line the caller strips
back out (`spawnSync`'s own status field has no streaming equivalent per
spec 450). A `TaskManager`/`TaskBoard` pair (`src/tasks/manager.ts`,
`task_board.ts` - split specifically so the pure state-tracking logic stays
`lumen test`-able even though the thin `manager.ts` wrapper that calls
`Worker.run` cannot be, see below) polls each task's mailbox on the same
`RELAY_POLL_MS` tick the relay already used, and renders output tagged
`[task <id>]` in the scrollback via the existing frame vocabulary,
namespaced by `turnId` (`bg:<id>`) rather than a new frame type - see
`specs/001-frames/spec.md`'s new section on this. Completion is
UI-only, not fed back into `Session.history` automatically: the ticket's own
framing ("keep working, check back on it") reads as a human checking in
later, not an automatic re-injection, and a background shell command has no
natural moment to interrupt an unrelated ongoing conversation the way a
delegated sub-task does. Cancellation is real, but is honestly a *detach*,
not a kill - `lumen-lang-org/lumen#6` (open, unrelated to this ticket) still
means no spawned process can be forcibly stopped; `/tasks cancel <id>` on a
background task just stops rendering/tracking it, told to the user in the
same message.

**Subagents.** A `spawn_agent` tool (task string only, kept minimal for v1)
spawns a worker-hosted, reduced reimplementation of `Session.submit()`'s
loop (`src/tasks/subagent_worker.ts`) against the real `streamChat` and the
real per-tool free functions (`src/tools/dispatch.ts`, extracted from
`ToolsRegistry` specifically so both the foreground session and a
worker-hosted subagent call the identical implementation, not a duplicated
one). The genuinely new piece: a subagent's own tool calls go through
approval too, via a second, reversed-direction mailbox file (subagent writes
an approval request and blocks polling for the reply; the main thread writes
the reply after the user answers) - proven with a direct, isolated round-trip
test before it was ever wired into the real feature (a worker blocking in a
read loop on a file the main thread writes *after* the worker was already
running), then proven again for real against a live model and a live
approval card rendered in the terminal (see PR body for the actual
transcript). Subagent approval mirrors `Gate`'s own mode rules exactly
(read tools always auto, `read-only` denies outright, `auto-edit` only
asks for `run`, `full-auto` never asks, `always` remembered for the rest of
that subagent's own run) but is its own worker-local reimplementation, not a
shared `Gate` instance, for the same scalar-only `Worker.run` reason #14
already established. Cancellation checks a flag file between steps and
inside `streamChat`'s own `shouldStop` callback (finer than the ticket
asked for - stream-boundary, not just step-boundary), the same polling
shape `CancelWatch` already uses on the main thread. A subagent's result
*is* fed back into `Session.history` automatically, unlike a background run
task - a `spawn_agent` call is a clearly delegated sub-task the calling turn
is waiting to incorporate, not a fire-and-forget job - but as a synthetic
`user`-role note (`"[subagent <id> report - task: ...]\n<result>"`), not a
literal paired tool-response, since the completion can and does arrive many
turns after the original call, and appending a second `tool`-role message
against an already-satisfied `tool_calls` entry risks violating the strict
tool-call/tool-response pairing several OpenAI-compatible APIs enforce.

**Two genuine new Lumen compiler bugs, both with confirmed workarounds,
filed as
[lumen#14](https://github.com/lumen-lang-org/lumen/issues/14) and
[lumen#15](https://github.com/lumen-lang-org/lumen/issues/15).** #14: the
exact same `net.createServer`-plus-throwing-handler shape #13 already
documented, but for `Worker.run` inside an `async` caller - same inline-arrow
workaround (`Worker.run(() => { return theRealFn(); })`), applied to every
worker-spawning call site. #15: `arr[idx].field = value` fails to parse as
an assignment target (`arr[idx].field` reads and `arr[idx].method()` calls
both work); worked around by binding the element to a local first
(`let x = arr[idx]; x.field = value;`).

**A third, harder-to-isolate false-positive type error, filed as
[lumen#16](https://github.com/lumen-lang-org/lumen/issues/16).** Comparing a
decoded `T | null` to `null` type-checked fine in every reduced repro tried
(a standalone program, `lumen test` on the module in isolation, `lumen
compile` on the module or its direct parent as the entry point) but failed
with a false-positive `E_TYPE_MISMATCH` only once reached through
`terminal.ts`'s full ~20-import compilation unit - moving the exact same
code to a different file didn't help, only changing the return shape did.
Worked around by replacing every `T | null` return in
`src/tasks/subagent_protocol.ts` with a `{ found: bool, value: T }` struct,
confirmed clean across the real `terminal.ts` build and the full test suite.

**A fourth bug, genuinely dangerous because it fails silently, filed as
[lumen#17](https://github.com/lumen-lang-org/lumen/issues/17).** Pushing
onto an array received as a plain function parameter does not mutate the
caller's array - no error, unlike the same mistake through a closure
capture, which the compiler correctly rejects
(`E_CAPTURED_MUTATION`). Caught by a unit test, not by the compiler: a
subagent's "always allow" memory was passed into a helper function that
pushed the newly-approved tool onto it, silently never actually growing the
caller's list, so "always" behaved like a one-time "allow" instead of being
remembered for the rest of that subagent's run. Fixed by returning an
outcome value instead and pushing from the array's own owning scope - the
same pattern every other `.push()` call in this codebase already used
(`this.field.push(...)` from inside the owning class's own method, or a
`let` array pushed directly within the function that declared it), now
confirmed to be load-bearing, not just a style preference.

**A serious runtime stability bug, not a compiler bug, found during live
verification against the real DeepSeek API and filed as
[lumen#18](https://github.com/lumen-lang-org/lumen/issues/18), stated
plainly because it changes what can honestly be claimed about this
feature's readiness.** A real `joule` process running a subagent for
roughly 15-20+ seconds - streaming a live model response, dispatching one
real tool call, all through the exact proven `Worker.run` + mailbox pattern
- reliably crashes the whole process with `SIGABRT`, printing `Signals
delivery fails constantly at GC #<n>` before dying. This traces to Lumen's
native runtime using a conservative GC (`libgc`, confirmed via `gc: bool =
true` in `lumen_emit.zig`) whose Linux thread-stop-the-world mechanism uses
signals - a mechanism that does not appear to survive a `Worker.run` thread
staying alive and active for a sustained period, which is exactly the
scenario `Worker.run`'s own spec (059) anticipates supporting. This is not
about the mailbox mechanism itself, which round-tripped correctly, repeatedly,
against a live model before the crash. It reproduces with zero rapid input
too - a completely quiet wait after spawning a subagent still crashes at
roughly the same elapsed time - so the trigger is sustained worker-thread
runtime, not command frequency. `LUMEN_NO_GC=1` (the compiler's own escape
hatch, per the comment above `gc: bool = true`) could not be tested as a
mitigation - it fails to link (`undefined symbol: isatty`/`tcgetattr` from
the vendored `tty_shim.o`) - so no workaround is known today. **The honest
read: the bidirectional-approval mailbox mechanism this ticket most needed
proven is proven, genuinely, against a live model, with a real reply
unblocking a real waiting worker thread - but a subagent that runs for more
than roughly 15-20 seconds risks taking the whole terminal down with it,
which is a real, currently-open limitation of the Lumen runtime this
feature is built on, not of the feature's own design.**
