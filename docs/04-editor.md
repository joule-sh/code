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

## Where the view opens (#199)

**The session view is declared into the secondary side bar.**
`contributes.viewsContainers` takes three keys in the editor this client is
built against - `activitybar`, `panel` and `secondarySidebar` - and the third
registers the container at the auxiliary bar, the right-hand side bar whose
containers are the strip of icons across its top. So the placement is
declarable after all, and the change is one key in the manifest rather than a
window rearranging itself on first run. The container id is unchanged, and
the icon appears in whichever bar the container ends up in.

`secondarySidebar` is younger than the rest of the manifest: it arrived in
1.104 behind a proposed API and was final in 1.106, so `engines.vscode` moves
from `^1.85.0` to `^1.106.0`. That floor is the point rather than a side
effect. An older editor does not fall back to the old placement - it ignores
the key it does not know, no container is registered, and a view with no
container of its own is dropped into the Explorer beside the file tree.
Refusing to install is the better of the two failures.

**Someone who has already moved it keeps where they put it.** A container's
location is resolved as the stored customization first and the declared
default only when there is none: `views.customizations` in global storage
holds a `viewContainerLocations` entry for every container a person has
dragged, keyed by container id, and `workbench.view.extension.joule` does not
change here. An install where the view was dragged to the right is already
where this change points; one where it was dragged to the panel stays in the
panel. An install that never touched it has nothing stored and moves with the
default, which is the one case where an upgrade relocates the view, and is
the change the issue asks for.

**The icon is the console's mark, drawn for the size the strip uses.** That
strip renders a container's title by default and its icon when a person turns
`workbench.secondarySideBar.showLabels` off or moves the activity bar to the
top, and an icon there is masked at 16px against the bar's foreground colour,
against 24px in the activity bar - so it is one shape, tinted, at half the
size it used to be drawn for. The old outlined speech bubble was a poor thing
to be in that strip twice over: at 16px its 1px strokes and its inner line
silt up, and it sits directly beside the editor's own chat icon, which is
also a speech bubble. The J and its accent - `assets/mark.svg` in the console
- are the identity, are legible as a letter at 16, and are nobody else's
glyph. #154 still owns the designed interface; this is the icon catching up
with the bar it now lives in.

**The two alternatives are worse.** `panel` is declarable and needs no engine
floor, but the bottom panel is where output and terminals live: a
conversation there is a strip under the editor rather than a column beside
it, and it is not where comparable assistant extensions sit. Moving the
container from code on first activation is not something the API offers -
`vscode.moveViews` moves views into a container that already exists, and
nothing exposed to an extension moves a container to a location - and an
approximation built out of the workbench's own commands would be a window
rearranging a person's layout without being asked.

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

What it cannot reach is the webview. `chat_panel.js` and `chat.js` are only
syntax-checked there, so nothing proved that a frame the session accepted ever
becomes something a person can see or click.

`make editor-window-harness` closes that. It uses `@vscode/test-electron`, the
runner VS Code publishes for this: it downloads a real VS Code, opens a window
on a throwaway workspace under its own `HOME` and `TMPDIR`, and runs the suite
inside the extension host, where the `vscode` API is the real one. On Linux the
runner starts its own Xvfb when `DISPLAY` is unset and kills it on the way out.
The VS Code version is pinned, and the download is cached in
`~/.cache/joule-editor-window` - outside the checkout, because `actions/checkout`
cleans ignored files and a cold runner would otherwise pull 330MB every push.
`JOULE_VSCODE_CACHE` moves it.
Two windows run in sequence, each with its own workspace, `HOME`, daemon and
stub model, because the stub reuses one tool call id and a second turn in one
session would be answered from the first turn's memory rather than from a
click.

Every claim about what the panel shows is read back out of the webview's DOM,
never off the frame stream: the first window types into the composer, waits for
the streamed text to appear in `.text-body`, clicks `Allow` on the rendered
approval card and then reads `README.md` off disk and through
`vscode.workspace.fs`. A frame that arrives and never paints - #147's bug, one
layer up - fails it. The second window closes the panel with an approval
pending, reopens it, finds the same call id waiting, denies it from the webview
and asserts the file was left alone, then reaps the daemon and asserts nothing
is listening.

The DOM is reached through `media/probe.js`, which `chat_panel.js` adds to the
webview only when `context.extensionMode` is `Test`, and which `.vscodeignore`
keeps out of the packaged `.vsix`. It reads text and dispatches real clicks on
the real buttons; it does not stand in for the panel's own rendering.

What this still does not cover: a human's mouse and keyboard (clicks are
dispatched on the rendered nodes, not synthesised at the window), the panel's
modal dialogs - the Stop confirmation and the multi-folder quick pick, which
have no headless answer - Windows and macOS, and a real model, which stays out
of CI on purpose.

## One thing worth knowing before building this

The frame processing loop draws once per frame, not once per batch. #147 fixed
exactly that bug in the terminal, where fast replies landed in scrollback
unpainted. `Conversation.apply` takes one frame and emits one change.
