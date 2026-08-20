# code

An agentic coding terminal you can also drive from a web page.

You run it in a repo on your own machine. It prints a short pairing code. You
open the page, enter the code, and from then on the browser and the terminal are
the same session — you start work at the desk and keep steering it from a laptop
or a phone.

The agent reads and edits files, runs commands and makes commits **on your
machine**. The browser is a remote control, never an executor.

## Status

v0 is not built yet. What exists is the design and the work breakdown:

- [docs/00-plan.md](docs/00-plan.md) — architecture, the decisions and what
  forced them, and the order the work goes in.
- [specs/](specs/) — one directory per decided piece, in the same numbered form
  the Lumen repo uses.
- [The v0 milestone](https://github.com/joule-sh/code/milestone/1) — fifteen
  tickets. [#15](https://github.com/joule-sh/code/issues/15) is the plan,
  [#1](https://github.com/joule-sh/code/issues/1) is where the code starts.

## The one invariant

**The terminal is authoritative.** It holds the workspace, the history and the
tool loop. The relay pairs a browser to a terminal, forwards frames both ways,
and keeps a bounded replay buffer — nothing more. It never runs a tool, never
holds a checkout, and stores nothing durable. If the relay dies the terminal
keeps working; you lose the web view, not the work.

Every design question in v0 is answered by pushing state toward the terminal.

## Built in Lumen

CLI, relay and the page the relay serves. Two binaries, one language.

The transport is HTTP with SSE downstream and POSTs upstream, in both
directions, because that is what the toolchain is good at — `http.stream` exists
for token streams and there is no WebSocket. The reasoning is in the plan.
