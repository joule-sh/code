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

**The session view is declared into the activity bar, and the right-hand
default is parked until it can come back without costing the icon (#233).**
`contributes.viewsContainers` takes three keys - `activitybar`, `panel` and
`secondarySidebar` - and the third registers a container at the auxiliary
bar, the right-hand side bar whose containers are the strip across its top.
So the placement is declarable rather than something a window rearranges on
first run. But `secondarySidebar` is younger than the rest of the manifest:
unknown before 1.104, behind a proposed API in 1.104 and 1.105, final from
1.106.

**Declaring only the new key is not a graceful degradation, it is a broken
install.** Driven in a real 1.105 window, an extension that contributes only
`secondarySidebar` registers no container at all - the proposal check throws
where the key is handled - and the view, having no container of its own,
lands in the Explorer under the file tree. Before 1.104 the key is simply
unknown and the same thing happens quietly. So the choice is not between a
right-hand default and a left-hand one; it is between shipping both
containers and refusing to install below 1.106.

**One container ships, the activity bar's, and nothing gates it.** The
manifest declares `joule` in `activitybar` holding `joule.chat` with no
`when` clause at all - the shape Continue, Cline and Roo all ship - so the
icon exists from the window's first paint, before and without the extension
activating. The two-container arrangement above is the design this section
argues for, and it is parked rather than abandoned: as shipped in 0.16.0 it
gated both views on a context key only activation could set, an unset key
evaluates false, and a container whose views are all hidden draws no icon -
so every window started icon-less, stayed that way wherever activation never
landed, and below 1.106 the orphaned right-hand view sat in the Explorer.
When the secondary container returns, its clauses have to fail toward an
icon; `scripts/verify_editor_placement.mjs` holds the ungated shape in the
meantime.

**Someone who has already moved it keeps where they put it, on the editors
where that has been possible.** A container's location is resolved as the
stored customization first and the declared default only when there is none:
`views.customizations` in global storage holds a `viewContainerLocations`
entry for every container a person has dragged, keyed by container id. The
container is `joule`, and it stays the activity bar's, so a person who has
dragged the view to the right-hand bar - the only way to reach it for now -
keeps that drag across restarts and across this change.

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
it, and it is not where comparable assistant extensions sit - the ones that
contribute a panel container use it for a log, not for the conversation.
Moving the container from code on first activation is not something the API
offers - `vscode.moveViews` moves views into a container that already exists,
and nothing exposed to an extension moves a container to a location - and an
approximation built out of the workbench's own commands would be a window
rearranging a person's layout without being asked.

**Beside your code is an editor tab, not a container, and that works
everywhere (#238).** `vscode.window.createWebviewPanel` opens a webview as an
editor in a `ViewColumn`, and it is not a `viewsContainers` contribution at
all, so the proposal check that rules out `secondarySidebar` below 1.106 has
nothing to say about it. The session opens in `ViewColumn.Beside` - a tab
with a close button in the tab row, beside the file it was asked from - and
it renders the same on 1.105.1 as on 1.134.0.
That is the placement people ask for when they ask for the panel next to
their code, and it is available on every version the extension installs on.

**The tab and the sidebar are two renderings of one client, not two
clients.** `ChatPanel` holds a set of surfaces rather than a single view, and
`post()` writes the same state to each; there is one `EditorSession`, one
connection id, one attach. So opening a tab while the sidebar is attached
cannot duplicate a transcript or let the two diverge, because there is no
second client to disagree with - the harness types a prompt into the tab,
finds it exactly once in the sidebar, and answers the approval that turn asks
for from the sidebar, which clears the ask in the tab. This is deliberately
not the #227 problem: nothing here is two clients of one session.

**A tab is destroyed when it is closed, so there is a way back.** Closing an
editor disposes its webview, unlike hiding a view, so the same command both
opens the tab and reveals the one already open - one command covers opening,
reopening and focusing. The editor's own restore brings it back across a
restart: `registerWebviewPanelSerializer` plus the
`onWebviewPanel:joule.session` activation event hand the panel back to
`adopt()`, which remounts it live rather than leaving the stale picture the
editor painted from its saved state. Shutdown must leave the panel alone for
any of that to happen - an extension that disposes its own panel on
`deactivate` has closed the tab before the workbench can save it, and nothing
comes back.

**The tab is an addition to the container, never a replacement.** It draws no
icon of its own, so #234's ungated activity bar container still carries
discoverability and still answers #233. Beyond the command palette, the
session view's own title bar carries the command.

**The tab is where a window opens the session, and `joule.openInEditorTab`
turns that off.** The setting ships on: a window that asks for nothing gets
the session beside its code, because that is the placement people describe
when they describe wanting it, and a sidebar a person has to find first is
not that. The cost is real and taken knowingly - an editor is destroyed when
it is closed rather than hidden, and it competes with files for the editor
area - which is why the icon and the title bar command below are load
bearing rather than decoration. Comparable assistant extensions default to
their sidebar and offer the tab as an alternate; this one is the other way
round on purpose.

**It opens on every window, and it opens quietly.** Per window rather than
per workspace, because a window is what has an editor area to put a tab in:
each one runs its own extension host with no shared state to elect a first
among them, `workspaceStorage` is per folder and two windows on one folder
would race for it, and a second window that silently had no session in it
would be the more surprising outcome now that the tab is the placement. What
is per window is the closing: a tab closed in one window stays closed in that
window until it is asked for again, and says nothing about the next one.
Quietly means two things the harness pins. The startup open passes
`preserveFocus: true`, so a window opened on a file - `joule` in a terminal,
or a `code src/thing.ts` - leaves the caret in that file and finds the
session beside it rather than in front of it; the command, which somebody
asked for, still takes focus. And `ViewColumn.Beside` splits the editor area,
which on a window with nothing open leaves a blank pane next to the tab, so
the startup open takes `ViewColumn.One` when there is no editor to sit beside
and `Beside` when there is. A window whose editor is already restoring a
session tab opens none at all - `restoring()` reads the editor's own tab list
and leaves the panel to the serializer, rather than creating a second one for
`adopt()` to dispose a moment later.

**The window harness asserts the icon, not just the view.** The placement
assertions check that opening the joule container shows the view - which
fails if the view has spilled into the Explorer - and then close each of the
three bars in turn, so only the bar that owns the view makes it disappear;
they run on the pinned 1.134.0 and on 1.105.1. And because a view a command
can open is not yet an icon a person can see, a `startup-icon` scenario runs
on both pinned versions without ever activating the extension or opening the
view: it screenshots the window's display and counts the marks in the
activity bar, and passes only when the joule icon has rendered on its own.
That scenario now also reads the editor's own tab list, so both pinned
versions prove the same window that painted the icon opened the session in a
tab, and that the icon count is unchanged with the tab open - the way back
from a closed tab is asserted on the same screenshot that proves the icon
exists at all.

An `editor-tab` scenario runs on both pinned versions too. No scenario's
workspace sets `joule.openInEditorTab` anywhere, so what opens a tab is the
shipped default and nothing else. It reads the editor's own tab list to see
that exactly one tab opened before anything asked for one, in a single editor
group rather than beside a blank pane, and that the folder gained no file, so
the Explorer shows what it showed before. Then it closes that tab, opens
README.md, drives the same `openOnStartup()` a window runs, and checks the
tab landed in a column beside the file with the caret still in README.md and
the tab not the active editor. Then it closes the tab again and proves the
command brings one back and takes focus this time, that asking twice reveals
rather than stacks, and that the activity bar held the same icons throughout.
It hands the extension a fresh panel through the `adopt()` the serializer
calls, drives the rest of the turn through that one, and calls
`openOnStartup()` against a tab that is already open to prove it opens
nothing.

The restart is proved outside the test host, because it cannot be proved
inside it: a window opened with `--extensionTestsPath` keeps its storage at
`:memory:`, so no editor state is ever written and nothing can survive a
restart by construction. `restart_check.mjs` installs a packaged vsix into a
fresh profile instead - an installed extension, not a source folder, since
installed extensions activate differently and that difference has hidden two
bugs already. It opens a window that configures the setting nowhere, quits it
gracefully, and reads the saved workspace state for the tab's editor input,
which is where the default is proved on a real installed build on both pinned
versions; then reopens the same profile with the setting off and finds the
tab still there, having been opened by nothing. A second profile that turns
the setting off opens no tab and saves no such input, so the mark
distinguishes a restored tab from a fresh one rather than matching anything
the manifest happens to contain, and the off switch is proved to still be an
off switch.

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

A third window is the panel with company (#227). A second client - a plain
websocket on the same daemon, the same thing a terminal is - sets the mode and
sends a prompt, and both have to paint in the panel: the status line taking the
mode, the transcript taking a prompt nobody typed here. It then closes the
panel, has that other client move the mode again while nothing of this window
is attached, reopens it, and asserts the panel paints the mode the session is
in rather than the one it was last told before it left. Finally it stops the
daemon, starts another in the same folder, and asserts the panel paints that
session's mode with none of the previous session's transcript replayed into it,
which is the half of #227 that was a daemon bug rather than a panel one.

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

## The files, and the checks over them

`editor/README.md` is the extension's marketplace listing page, not a place
for any of this. It is written for someone deciding whether to install, which
is why the layout below moved here when publishing was wired up (#175).

| file | what it is |
| --- | --- |
| `extension.js` | activation, commands |
| `src/chat_panel.js` | the webview host, folder picking |
| `src/session.js` | one folder's daemon session |
| `src/binary.js` | the preflight: is there a joule here, and can this build drive it |
| `src/daemon_link.js` | attach, resume, reconnect |
| `src/conversation.js` | frames to a chat view model, approval state |
| `src/setup.js` | what this machine is configured with, without reading a key |
| `src/onboard.js` | what each first-run route does in the editor |
| `src/modes.js` | the approval modes and what each one lets run |
| `src/frames.js` | generated from `src/relay/web/page_js_frames.ts`, never edited by hand |
| `src/ws.js` | the WebSocket client, shared with `scripts/` |
| `media/` | the webview: `chat.js` renders, `first_run.js`, `transcript.js` and `composer.js` are its three screens |
| `media/icon.png` | the marketplace tile, written by `make editor-icon` from the same J as `media/icon.svg` |

`extension.js`, `src/chat_panel.js` and `src/onboard.js` are the only files
that import `vscode`. Everything else is plain Node, which is how
`scripts/verify_editor_client.mjs` drives the real client against a real
daemon without an editor running.

`src/modes.js` is the panel's copy of a vocabulary the daemon owns, so
`scripts/verify_editor_modes.mjs` checks it against `src/approval/gate.ts` and
the sentences `src/terminal/welcome.ts` uses, and `make editor-check` fails if
the panel has started describing a mode differently from the terminal.

`scripts/verify_editor_setup.mjs`, in the same target, drives `src/setup.js`
over throwaway config files: what counts as configured, which server is
chosen, and - on every path - that neither a provider key nor an account
credential appears anywhere in the state the panel is sent.

```
make editor-frames   # regenerate src/frames.js after changing page_js_frames.ts
make editor-icon     # regenerate editor/media/icon.png
make editor-check    # fails if either has drifted, plus syntax checks
make editor-harness  # the end-to-end check, no browser automation
make editor-package  # build dist/joule-editor-<version>.vsix
```

Two environment variables help while working on the interface:

```
JOULE_EDITOR_SCENARIOS=first-run          # run one scenario instead of all three
JOULE_EDITOR_CAPTURE=/tmp/panel           # also write what the panel rendered, as HTML
```

## Packaging and the version

`make editor-package` writes `dist/joule-editor-<version>.vsix` through
`@vscode/vsce`, pinned by `scripts/package_editor.mjs` and fetched with `npx`
so nothing is vendored into the repository.

The version in `package.json` is `0.0.0` in the tree and is never edited by
hand, for the same reason `src/version.ts` says `dev`: the tag is the one
source of truth, and a number kept in a file is a number that drifts from the
binaries it is supposed to match. `scripts/package_editor.mjs` takes the
version from `--version` or from `GITHUB_REF_NAME`, writes it into the
manifest for the length of the packaging run, and restores the file
afterwards, so a local build never leaves the tree dirty. The release workflow
packages the extension in the same run as the binaries, from the same tag, and
attaches the `.vsix` to the same release.

Because the version is the tag, a tag that is not `major.minor.patch` fails
the packaging step rather than producing a `.vsix` the marketplace would
refuse. Publishing is downstream of that and is covered in
[05-publishing.md](05-publishing.md).
