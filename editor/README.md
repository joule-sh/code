# joule for the editor

An editor client for a joule daemon. It starts or attaches to the daemon for
an open workspace folder and drives it over the spec 001 frames, with
approvals rendered as native cards instead of terminal text.

The design decisions - workspace-to-daemon mapping, trust level, where tools
run, lifecycle, and what is reused from the terminal client rather than
rewritten - are in
[docs/04-editor.md](https://github.com/joule-sh/code/blob/main/docs/04-editor.md).

## Where it opens

The session view opens in the **secondary side bar**, on the right, where the
other assistant extensions sit and next to the editor rather than in front of
the file tree. Its icon is in the strip along the top of that bar.

That placement needs an editor from **1.106** on, which is where the manifest
first took a secondary side bar container. On anything older the same view
opens in the activity bar on the left, exactly as it always has, and can be
dragged to the right by hand. Nothing about this asks a person to move
editors: `engines.vscode` is still `^1.85.0`, and the extension ships both
containers and picks between them when it starts.

Either way the editor remembers a person's own placement: drag the view where
you want it and that is where it opens, whatever the default says.

## What the panel shows

**Before anything is configured**, a first-run screen: what joule is in one
sentence, and the three ways it can reach a model, each as its own button
with its own description - a joule account, your own provider key, or a
self-hosted joule server. A missing or too-old `joule`, and a configuration
that exists but cannot start a session, land on the same screen instead of a
red error.

**An API key is never typed into the panel.** The provider-key route opens
`~/.config/joule-code/config.json` in the editor and says so; the extension
reads that file only to answer "is there a key here", never its value, and
writes nothing to it but a `server` address you asked it to remember.

**In a session**, the composer carries its own controls: a chip row at the
top of the box naming the file open beside the panel - what will be named at
the top of the message, dismissable with a click - then the input, then the
approval mode and the model as icon chips on a row with send at the end of
it, and a status line beneath saying where the tools will run and what the
current mode lets run without asking. Mode and model send the daemon's
`mode.set` and `model.set` frames - the same thing `/mode` and `/model` do in
a terminal - so a terminal driving the same session moves these controls too.

## What it needs

`joule` must be on `PATH`, or `joule.path` must point at it. The daemon is
started through that binary, so it has to be the same install a terminal
would use. Install it with the one-liner in
[the repository README](https://github.com/joule-sh/code#install).
Credentials are whatever `joule` already has - the extension never reads,
stores or forwards an API key.

The extension needs **joule 0.13.0 or newer**: 0.13.0 is the release that
first shipped `daemon-ensure` and the attach socket this client talks to.
Attaching runs `joule --version` first and refuses to go further when the
binary is missing, is not a joule, or is older than that, so a mismatch is
one sentence in the panel rather than a session that dies on the first frame
it does not recognise. A binary built from a checkout reports `dev` and is
taken at its word.

There is **no Windows build of `joule` yet**
([#173](https://github.com/joule-sh/code/issues/173)). The extension is
plain JavaScript and loads on Windows, but it has nothing to drive there, so
it says so instead of opening a panel that can never attach. Opening the
folder through WSL or Remote-SSH works today: `extensionKind` is
`workspace`, so the extension runs on the remote side, next to the `joule`
and the files.

## Installing

Every release attaches `joule-editor-<version>.vsix` to
[its GitHub release](https://github.com/joule-sh/code/releases), cut from the
same tag as the binaries. Install it with

```sh
code --install-extension joule-editor-<version>.vsix
```

or from the Extensions view, through _Install from VSIX_. It is not on the
Visual Studio Marketplace or Open VSX yet.

To work on the extension instead, open this repository in VS Code and run it
in an Extension Development Host, or symlink `editor/` into
`~/.vscode/extensions/`. There is no build step and no runtime dependencies;
packaging is the only thing that fetches a tool.

## Settings

| setting | default | what it does |
| --- | --- | --- |
| `joule.path` | `joule` | the binary the daemon is started and stopped through |
| `joule.attachOnStartup` | `false` | attach as soon as the window opens, instead of waiting for the button |
| `joule.resumeOnStart` | `false` | when this window starts the daemon, resume the folder's previous session |

`joule.attachOnStartup` is off by default on purpose: attaching can join a
session someone is already driving from a terminal, so it is a decision a
person makes rather than something a window does on open.

## Layout

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
| `src/frames.js` | **generated** - see below |
| `src/ws.js` | the WebSocket client, shared with `scripts/` |
| `media/` | the webview: `chat.js` renders, `first_run.js`, `transcript.js` and `composer.js` are its three screens |

`extension.js`, `src/chat_panel.js` and `src/onboard.js` are the only files
that import `vscode`. Everything else is plain Node, which is how
`scripts/verify_editor_client.mjs` drives the real client against a real
daemon without an editor running.

`src/modes.js` is the panel's copy of a vocabulary the daemon owns, so
`scripts/verify_editor_modes.mjs` checks it against `src/approval/gate.ts`
and the sentences `src/terminal/welcome.ts` uses, and `make editor-check`
fails if the panel has started describing a mode differently from the
terminal.

`scripts/verify_editor_setup.mjs`, in the same target, drives `src/setup.js`
over throwaway config files: what counts as configured, which server is
chosen, and - on every path - that neither a provider key nor an account
credential appears anywhere in the state the panel is sent.

## src/frames.js is generated

It is produced from `src/relay/web/page_js_frames.ts`, the one JavaScript
definition of the frame vocabulary that #148 introduced so clients would stop
copying it. Do not edit it by hand.

```
make editor-frames   # regenerate after changing page_js_frames.ts
make editor-check    # fails if it has drifted, plus syntax checks
make editor-harness  # the end-to-end check, no browser automation
make editor-package  # build dist/joule-editor-<version>.vsix
```

`make editor-window-harness` drives the panel in a real editor window and
asserts against the DOM it painted. Two environment variables help while
working on the interface:

```
JOULE_EDITOR_SCENARIOS=first-run          # run one scenario instead of all three
JOULE_EDITOR_CAPTURE=/tmp/panel           # also write what the panel rendered, as HTML
```

## Packaging and the version

`make editor-package` writes `dist/joule-editor-<version>.vsix` through
`@vscode/vsce`, pinned by `scripts/package_editor.mjs` and fetched with
`npx` so nothing is vendored into the repository.

The version in `package.json` is `0.0.0` in the tree and is never edited by
hand, for the same reason `src/version.ts` says `dev`: the tag is the one
source of truth, and a number kept in a file is a number that drifts from the
binaries it is supposed to match. `scripts/package_editor.mjs` takes the
version from `--version` or from `GITHUB_REF_NAME`, writes it into a copy of
the manifest for the length of the packaging run, and restores the file
afterwards, so a local build never leaves the tree dirty. The release
workflow packages the extension in the same run as the binaries, from the
same tag, and attaches the `.vsix` to the same release.
