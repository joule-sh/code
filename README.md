# code

An agentic coding terminal you can also drive from a web page.

You run it in a repo on your own machine. It prints a short pairing code. You
open the page, enter the code, and from then on the browser and the terminal are
the same session. You start work at the desk and keep steering it from a laptop
or a phone.

The agent reads and edits files, runs commands and makes commits **on your
machine**. The browser is a remote control, never an executor.

## Status

v0 is in progress. Landed: the repo skeleton and CI
([#1](https://github.com/joule-sh/code/issues/1)), the shared frame protocol
([#2](https://github.com/joule-sh/code/issues/2)), the release pipeline
([#13](https://github.com/joule-sh/code/issues/13), install mechanics only).
Not yet: the turn loop, a model provider, the file and run tools, approval,
the terminal front end, the relay, and the web page. There is no working demo
until those land, the install below gets you the v0 skeleton, not a usable
tool.

- [docs/00-plan.md](docs/00-plan.md): architecture, the decisions and what
  forced them, and the order the work goes in.
- [specs/](specs/): one directory per decided piece, in the same numbered form
  the Lumen repo uses.
- [The v0 milestone](https://github.com/joule-sh/code/milestone/1) holds the
  tickets. [#15](https://github.com/joule-sh/code/issues/15) is the plan,
  [#1](https://github.com/joule-sh/code/issues/1) is where the code starts.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/joule-sh/code/main/install.sh | sh
```

Installs as `joule`, not `code` - `code` is already taken by VS Code's CLI on
most machines, and this project would silently shadow or lose to it depending
on `PATH` order. Prebuilt for x86_64 Linux, Apple Silicon macOS
(`aarch64-macos`) and Intel macOS (`x86_64-macos`); other platforms fail with a
clear message and point at building from source below.

## Build from source

Requires the [Lumen](https://lumen-lang.org) toolchain (`lumen`, and `zig`
alongside it on `PATH`, as the release archive ships them). Lumen publishes
macOS builds too (`lumen-aarch64-macos.tar.gz`, `lumen-x86_64-macos.tar.gz`),
so this works natively on a Mac.

Lumen's allocator links the Boehm collector as a system library. Linux distros
ship it as `libgc` and nothing extra is needed. macOS has no system copy, so a
Mac build needs Homebrew's and has to point the compiler at it:

```sh
brew install bdw-gc
make build LUMEN_FLAGS="--link -L$(brew --prefix bdw-gc)/lib"
```

The `-L` is not optional on Intel Macs. Zig ignores `LIBRARY_PATH` on macOS and
only has Apple Silicon's `/opt/homebrew` in its built-in search paths, so an
Intel build fails without it.

The macOS release archives link that library statically, so an installed
release depends on nothing but the system's own libSystem and needs no
Homebrew.

```sh
git clone https://github.com/joule-sh/code.git
cd code
make build
./bin/joule --version
```

`make test` runs the test suite, `make release` builds the `--release-fast`
binaries the release workflow packages.

## The one invariant

**The terminal is authoritative.** It holds the workspace, the history and the
tool loop. The relay pairs a browser to a terminal, forwards frames both ways,
and keeps a bounded replay buffer. Nothing more. It never runs a tool, never
holds a checkout, and stores nothing durable. If the relay dies the terminal
keeps working; you lose the web view, not the work.

Every design question in v0 is answered by pushing state toward the terminal.

## Built in Lumen

CLI, relay and the page the relay serves. Two binaries, one language.

The terminal and the browser each hold one WebSocket to the relay, using the
`websocket` package from std-contrib. The model is read over SSE with
`http.stream`, because that is what providers speak. The reasoning, including
the concurrency problem a blocking `receive()` creates for the terminal, is in
[spec 003](specs/003-transport/spec.md).

## Honest limits (v0)

No hosted sandbox, the agent only ever runs on your own machine. No multi-agent,
no subagents, no MCP. See [docs/00-plan.md](docs/00-plan.md) for the reasoning
behind each.

Conversation history is saved per workspace as you go and picked back up with
`joule --continue`, which resumes the most recent session for the current
directory. Model, mode and workspace are not part of what gets saved - they
are re-resolved fresh from the normal config chain on every launch. There is
no picker for older sessions yet, only the most recent one.

The terminal enables mouse reporting so the wheel can scroll the transcript.
That hands mouse events to joule, which is why click-drag no longer selects
text on its own - the terminal emulator is no longer the one handling the
click. Hold Shift while dragging to select natively; this bypasses mouse
reporting in GNOME Terminal and Windows Terminal. iTerm2 uses Option instead
of Shift for this. Terminal.app has no modifier-key bypass at all - turn off
View > Allow Mouse Reporting (Cmd-R), select and copy, then turn it back on.
Copying from a collapsed tool-output group only copies what is visible; the
rows hidden by the collapse are not part of the selection.
