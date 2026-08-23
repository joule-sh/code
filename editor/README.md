# joule for the editor

An editor client for a joule daemon. It starts or attaches to the daemon for
an open workspace folder and drives it over the spec 001 frames, with
approvals rendered as native cards instead of terminal text.

The design decisions - workspace-to-daemon mapping, trust level, where tools
run, lifecycle, and what is reused from the terminal client rather than
rewritten - are in [`../docs/04-editor.md`](../docs/04-editor.md).

## Running it

There is no build step and no dependencies. Open this repository in VS Code
and run the extension in an Extension Development Host, or symlink `editor/`
into `~/.vscode/extensions/`.

`joule` must be on `PATH`, or `joule.path` must point at it. The daemon is
started through that binary, so it has to be the same install a terminal
would use. Credentials are whatever `joule` already has - the extension never
reads, stores or forwards an API key.

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
| `src/daemon_link.js` | attach, resume, reconnect |
| `src/conversation.js` | frames to a chat view model, approval state |
| `src/frames.js` | **generated** - see below |
| `src/ws.js` | the WebSocket client, shared with `scripts/` |
| `media/` | the webview |

`extension.js` and `src/chat_panel.js` are the only files that import
`vscode`. Everything else is plain Node, which is how
`scripts/verify_editor_client.mjs` drives the real client against a real
daemon without an editor running.

## src/frames.js is generated

It is produced from `src/relay/web/page_js_frames.ts`, the one JavaScript
definition of the frame vocabulary that #148 introduced so clients would stop
copying it. Do not edit it by hand.

```
make editor-frames   # regenerate after changing page_js_frames.ts
make editor-check    # fails if it has drifted, plus syntax checks
make editor-harness  # the end-to-end check, no browser automation
```
