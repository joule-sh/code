# The editor client (#145)

A fourth client on the spec 001 frames, after `joule attach`, the paired
browser and the console. It owns no agent loop, no session store and no
approval model of its own, and it adds no frames to the protocol. It sends
`input`, `cancel`, `approval.reply` and `resume`, and it renders
`session.hello`, `turn.start`, `text.delta`, `tool.call`, `tool.result`,
`approval.request`, `approval.reply.result`, `turn.end` and `error`.

It lives in `editor/`: plain CommonJS JavaScript, no npm dependencies and no
build step, so nothing about the Lumen toolchain changes to have it.

## What could be reused, and what could not

The issue asked for the shared client rather than a third implementation of
the same conversation. That splits in two, and the two halves have different
answers.

**The conversation loop could not be reused.** `runClientLoop`
(`src/terminal/attach.ts`) is the shared client for the two terminal entry
points, and it is not reachable from an editor extension for two independent
reasons. It is Lumen, compiled into `bin/joule`; an extension is JavaScript
loaded into the editor's Node host, and there is no path from one to the
other short of running the binary, which is what a terminal already is. And
it is a TTY loop by construction: it calls `rawEnable(STDIN)`, blocks in
`readKeyTimeout`, writes alt-screen escapes, and calls `drawScreen` on a
`Scrollback` from the same function that decides what a frame means. There is
no seam between its transport, its state and its rendering to reuse even if
the language matched. Extracting one would be a rewrite of the terminal, not
a rider on this change, and `terminal.ts` and `attach.ts` are both already at
or near the 450-line cap.

**The frame vocabulary is reused, mechanically.** #148 made
`src/relay/web/page_js_frames.ts` the one JavaScript definition of the frame
names, decoders, encoders and the diff renderer, so clients do not each copy
them. `editor/src/frames.js` is **generated** from that file by
`scripts/gen_editor_frames.mjs` (`make editor-frames`), and
`make editor-check` fails if the two have drifted, so the editor cannot
quietly fork the vocabulary. The extension host and the webview load the same
generated file. That is the part worth not writing twice, and it is not
written twice.

**The daemon lifecycle is reused by shelling out, not by reimplementing.**
Working out which daemon belongs to a folder means knowing the info-file
path, the workspace-to-port hash and the spawn command. Reimplementing that
in JavaScript would be a second copy of a rule that must not disagree with
the first. Instead `bin/joule` grew one headless subcommand,
`joule daemon-ensure` (`src/daemon/ensure_cli.ts`), which runs the existing
`ensureAttached` and prints one line of JSON naming the port. The extension
runs it and reads the port. There is exactly one implementation of "which
daemon is this folder's", and both the terminal and the editor are on it.

**The transport is shared the other way round.** `editor/src/ws.js` is the
dependency-free WebSocket client, and `scripts/miniws.mjs`, which eight
harnesses already used, is now a two-line re-export of it.

## Workspace to daemon mapping

**One daemon per workspace folder**, keyed exactly as the CLI keys it. Because
the extension asks `joule daemon-ensure` rather than deriving the port
itself, an editor and a terminal in the same folder cannot disagree about
which daemon that folder has: whichever starts first, the other attaches.
`verify_editor_client.mjs` asserts this for two editor windows on one folder,
and that only one daemon record exists afterwards.

**Multi-root workspaces get one daemon per folder, chosen explicitly.** With
more than one root the extension asks which folder before attaching, and the
view is bound to that folder. It never starts a daemon for the
`.code-workspace` file or for some union of the roots, because `jail()`
clamps every tool call to a single `workspaceRoot`; a daemon spanning two
roots would either break that clamp or need a protocol change, and neither is
worth it for a case a folder picker answers.

**Attaching is always an explicit action.** `joule.attachOnStartup` is off by
default. The view opens on a panel that says whether a daemon is already
running for the folder, and the button reads "Attach to this session" or
"Start a session" accordingly. This is the half of the mapping question that
is not about ports: a person driving a session from a terminal must not find
the editor silently in it, so the editor says which of the two it is about to
do before it does it.

## Trust level

**The editor is a local client, at `joule attach`'s level, not a paired
browser's.** It connects to `127.0.0.1:<port>` on the daemon's attach socket,
the same socket and the same accepted frame set (`isAcceptedInboundType`) as
`joule attach`. It never dials the relay, never pairs, and never presents a
#97 credential. Being signed in to the console grants the editor nothing:
its authority comes from already having local access to the machine, which is
the same authority as typing `joule` in a terminal on it. Two-sided consent
is unchanged - the daemon still asks, and a human still answers in a client.

Recorded plainly rather than implied: the loopback attach socket has no
authentication of its own. Anything that can already open a local TCP
connection as this user can attach to the daemon. That is pre-existing and
true of `joule attach` today; the editor neither weakens it nor adds a
boundary that was not there.

## Approvals, and #136

Approvals render natively - a card with the tool, the exact command or path,
a real diff for `write` and `edit` built from `approval.request.args`, and
three buttons - rather than as terminal text a person has to read escape
codes through. Spec 001 puts the full args on `approval.request` for exactly
this, so the editor shows what a write proposes before anyone decides.

#136's rule is unchanged and is enforced where it always was, in
`Gate.reply`: **first answer wins.** The losing side is told - it receives
`approval.reply.result` with `applied: false` naming the decision that won,
and the editor shows "answered elsewhere first (allow) - this window's deny
was not applied" on the card rather than letting a click do nothing.

The third part of #136, "the prompt should visibly resolve on both sides once
either answers", was only half true for a daemon session and this change
finishes it. An allowed call announced itself through the following
`tool.call`, so other clients could infer it; a **denied** call emitted no
frame at all, so a second client's prompt sat there until that person clicked
and lost. `src/daemon/dispatch.ts` now broadcasts `approval.reply.result`
with `applied: true` for the winning answer as well, so every attached client
clears the prompt on either outcome. This is not a new frame - it is the
existing one, whose `applied` field was already there, used in the case it
was named for. Rendering is unchanged everywhere else: the terminal renderer
and the browser page return nothing for the applied case, so no client prints
a line it did not print before.

Deliberately not changed: subagent approvals are intercepted by
`tryDispatchTaskApprovalReply` before this path and do not get the broadcast.
Foreground approvals are what a client shows a person, and widening that is
its own change.

## Tools run where the workspace is

`read`, `write`, `edit`, `run` and `spawn_agent` execute inside
`bin/joule-daemon`, clamped by `jail()` to the daemon's `workspaceRoot`. The
editor process runs no tool, ever - it sends `approval.reply` and watches
`tool.result` come back.

For remote development this is a real requirement rather than an observation,
so the manifest enforces it: `"extensionKind": ["workspace"]` makes VS Code
load the extension on the **remote** side of a Remote-SSH, WSL or dev
container session. The daemon is then started next to the files, the loopback
attach socket stays loopback, and no daemon traffic crosses the SSH boundary.
An extension running on the UI side would start a daemon on the laptop and
edit the wrong filesystem, which is why the value is pinned rather than left
to default.

## Lifecycle

**Closing the editor detaches; it does not stop anything.** The websocket
closes, the daemon's pusher thread for that connection ends with it, and the
daemon keeps owning the turn. A turn in flight finishes, background tasks and
subagents keep running, and reopening the window attaches again and replays
the transcript with `resume {since}`. That is the point of a daemon, and it
means "the editor closed mid-turn" has no orphan to clean up.
`verify_editor_client.mjs` closes the editor with an approval pending, has a
second client answer it, and asserts the tool still landed on disk.

**Stopping is explicit and is the CLI's path.** The Stop command shells out to
`joule --stop` rather than sending `daemon.stop`, which keeps the editor's
outbound set to the four frames above. It warns first, because other clients
attached to that daemon lose the session too.

**What is not promised.** The daemon's stop path has a grace window and cannot
kill an in-flight `run` child - lumen#6, open upstream. The editor does not
claim otherwise: the confirmation says a run already in flight is not killed,
and `joule --stop` prints the same caveat about background tasks it always
did.

## Reconnection, and #149

The link retries with exponential backoff from 250ms to 5s, sending
`resume {since}` with the highest `seq` it has seen, and buffers outbound
frames (bounded) while disconnected.

#149 - a refused browser tearing down can sweep a freshly-connected client for
the same session - is a **relay** race, on the pairing path. The editor never
connects to the relay: it attaches to the daemon's loopback socket, which has
no pairing step and so no refusal to race with. So the editor does not reach
#149 by reconnecting quickly. It is still open and still matters for the
browser and the console, and if the editor ever grows a remote attach mode
that goes through the relay, it inherits the race and this note stops being
true.

## Verifying it

`make editor-harness` builds, checks the generated vocabulary is in sync,
syntax-checks every extension file, and runs `scripts/verify_editor_client.mjs`,
which drives the **real extension modules** - `EditorSession`, `DaemonLink`,
`Conversation` - against a real `bin/joule-daemon` and a stub model, with no
editor and no browser automation involved. `extension.js` and `chat_panel.js`
are the only files that import `vscode`, which is what makes the rest
testable headlessly.

It covers a turn driven from the editor with the approval answered there and
the tool landing on the real filesystem; the editor and a second client on one
session seeing the same call id; the cross-client approval race in both
directions; closing the editor mid-turn; and two windows on one folder
sharing one daemon.

## One thing worth knowing before building this

The frame processing loop draws once per frame, not once per batch. #147 fixed
exactly that bug in the terminal, where fast replies landed in scrollback
unpainted. `Conversation.apply` takes one frame and emits one change.
