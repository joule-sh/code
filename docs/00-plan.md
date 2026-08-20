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
