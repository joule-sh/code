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
([#2](https://github.com/joule-sh/code/issues/2)). Not yet: the turn loop, a
model provider, the file and run tools, approval, the terminal front end, the
relay, and the web page. There is no working demo until those land.

- [docs/00-plan.md](docs/00-plan.md): architecture, the decisions and what
  forced them, and the order the work goes in.
- [specs/](specs/): one directory per decided piece, in the same numbered form
  the Lumen repo uses.
- [The v0 milestone](https://github.com/joule-sh/code/milestone/1) holds the
  tickets. [#15](https://github.com/joule-sh/code/issues/15) is the plan,
  [#1](https://github.com/joule-sh/code/issues/1) is where the code starts.

## Install

Once a release is tagged, the released binaries install with:

```sh
curl -fsSL https://raw.githubusercontent.com/joule-sh/code/main/install.sh | sh
```

x86_64 Linux only for now, matching the one self-hosted CI runner this project
builds on. No release has been tagged yet: the command above has nothing to
fetch until one is. Build from source until then.

## Build from source

Requires the [Lumen](https://lumen-lang.org) toolchain (`lumen`, and `zig`
alongside it on `PATH`, as the release archive ships them).

```sh
git clone https://github.com/joule-sh/code.git
cd code
make build
./bin/code --version
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

No hosted sandbox, the agent only ever runs on your own machine. No session
persistence across restarts. No multi-agent, no subagents, no MCP. See
[docs/00-plan.md](docs/00-plan.md) for the reasoning behind each.
