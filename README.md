# Joule Code: Always-on agents

An AI coding agent that runs in your terminal and can be driven from a browser.

Pre-1.0.

## Install

```sh
npm i -g @joule-sh/code
```

That covers all four platforms, Windows included. On Linux and macOS a script
does the same and needs no Node:

```sh
curl -fsSL https://raw.githubusercontent.com/joule-sh/code/main/install.sh | sh
```

Both install `joule` and `relay` at the same version, and run every binary
before reporting success. Runs as `joule`, not `code`. Either one offers to
update itself; there is no update command.

Prebuilt for x86_64 Linux, Apple Silicon macOS, Intel macOS and x86_64 Windows,
and every release carries the plain archives too, including
`code-x86_64-windows.zip`. Other platforms need
[building from source](docs/07-building.md).

## Start it

Run `joule` in a directory you want to work in. It reads and edits files, runs
commands and makes commits there, on your machine.

`/help` lists the commands. `joule --continue` reopens the most recent session
for that directory.

## Several sessions at once

One directory can run more than one conversation. `joule --session review`
starts or reopens the one called `review`; a plain `joule` is the unnamed one.

`/session` lists the ones running and moves you to another without leaving
joule: the session you pick takes the screen, and the one you left keeps
running in the background, finishing whatever it was doing. `/session <name>`
goes straight there, and starts that session if it is not running yet.
`joule --stop --session <name>` ends one.

## Connect a model

- A joule.sh account - run `/login`
- Your own provider key - `baseUrl` and `apiKey` in
  `~/.config/joule-code/config.json`
- Your own server - `--server` or `JOULE_CODE_SERVER`

## The editor extension

A panel in VS Code. Install
[`joule-sh.joule-editor`](https://marketplace.visualstudio.com/items?itemName=joule-sh.joule-editor)
from the marketplace, or the `.vsix` a release attaches. Not on Open VSX.
Install `joule` first; [editor/README.md](editor/README.md) has the settings.

## Share it to a browser

`/share` prints a URL and a six-character code. The session appears in the
console as a conversation you can read and reply in from any browser. Nothing
runs in the browser. A console signed in to the account that shared it needs no
code.

## Docs

- [docs/00-plan.md](docs/00-plan.md): architecture, the decisions and what
  forced them.
- [docs/06-selection.md](docs/06-selection.md): mouse selection and copy.
- [docs/07-building.md](docs/07-building.md): building from source.
- [docs/08-daemon-frame-protocol.md](docs/08-daemon-frame-protocol.md): the
  daemon websocket frames, for a client that is not joule.
- [specs/](specs/): one directory per decided piece.
