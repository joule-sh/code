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
npm i -g @joule-sh/code
```

or, with no Node on the machine:

```sh
curl -fsSL https://raw.githubusercontent.com/joule-sh/code/main/install.sh | sh
```

Both put the same two commands on your `PATH` at the same version, and both
run every binary before reporting success. npm pins and uninstalls cleanly;
the script needs nothing installed first. The npm package is a wrapper whose
binaries live in `@joule-sh/code-linux-x64`, `@joule-sh/code-darwin-x64` and
`@joule-sh/code-darwin-arm64`, installed as optional dependencies so npm takes
only the one that matches. There is no Windows package yet, because there is
no Windows binary yet ([#173](https://github.com/joule-sh/code/issues/173));
installing there says so and points at WSL.

Installs as `joule`, not `code` - `code` is already taken by VS Code's CLI on
most machines, and this project would silently shadow or lose to it depending
on `PATH` order. Prebuilt for x86_64 Linux, Apple Silicon macOS
(`aarch64-macos`) and Intel macOS (`x86_64-macos`); other platforms fail with a
clear message and point at building from source below.

Every archive carries the garbage collector it needs, so there is no library to
install alongside it. A macOS binary needs nothing beyond the system's own
libSystem. A Linux binary is linked statically against musl and needs nothing
at all - no libc version, no loader, no shared library - so it runs the same on
Ubuntu 22.04, on a decade-old enterprise release and on Alpine. The installer
runs each binary before it links anything onto your `PATH`, so an install that
reports success is one that runs, and an install that cannot says what stopped
it.

## Build from source

Requires the [Lumen](https://lumen-lang.org) toolchain (`lumen`, and `zig`
alongside it on `PATH`, as the release archive ships them). Lumen publishes
macOS builds too (`lumen-aarch64-macos.tar.gz`, `lumen-x86_64-macos.tar.gz`),
so this works natively on a Mac.

Lumen's allocator links the Boehm collector as a system library. Linux distros
ship it as `libgc` and a local build needs nothing extra. macOS has no system
copy, so a Mac build needs Homebrew's and has to point the compiler at it:

```sh
brew install bdw-gc
make build LUMEN_FLAGS="--link -L$(brew --prefix bdw-gc)/lib"
```

The `-L` is not optional on Intel Macs. Zig ignores `LIBRARY_PATH` on macOS and
only has Apple Silicon's `/opt/homebrew` in its built-in search paths, so an
Intel build fails without it.

The release archives link that library statically on both platforms, so an
installed release carries it. macOS uses Homebrew's `libgc.a`. Linux names a
target instead, which links musl and a collector the compiler builds for that
target, leaving a binary with nothing to resolve. To reproduce what a Linux
release ships:

```sh
make release LUMEN_TARGET=x86_64-linux-musl
scripts/check_linux_release.sh bin/joule bin/relay bin/joule-daemon
```

`LUMEN_TARGET` also compiles the vendored `tty_shim.o` for that target, so
switch it on a tree that was already built and `make clean` first.

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
