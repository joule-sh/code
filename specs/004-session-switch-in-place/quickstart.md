# Quickstart: validating the session switch

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-04

How to prove the feature works, by hand and in the harness.

## Prerequisites

The Lumen toolchain at the version `.github/workflows/test.yml` pins, and the
Boehm collector a host build links against. `docs/07-building.md` has the
platform detail.

```sh
make build
```

## The fast loop while developing

```sh
make test                     # unit tests, including the terminal's
make multi-session-harness    # the pty harness this feature lives in
```

The harness drives the real binary through a pty against `bin/stub_model`, so
it needs no API key and no network. Run both before every push, per the
constitution's merge gate.

## By hand

Two terminals in the same workspace, then a switch between them.

```sh
cd /some/repo
joule --session review        # terminal A: start a named session, leave it running
```

In a second terminal:

```sh
cd /some/repo
joule                         # terminal B: the default session
```

In terminal B:

```text
/session                      # the picker lists default (current) and review
```

Arrow down to `review`, press Enter.

**Expect**: terminal B now shows the `review` session, its transcript and its
prompt. The shell prompt never comes back. No line says to run
`joule --session review`. Typing a request answers in `review`.

Then:

```text
/session default              # back the other way, same process
```

**Expect**: the `default` transcript returns, including anything that finished
while you were away.

## The scenarios the harness asserts

Each maps to a user story in the spec. All live in
`scripts/verify_multi_session_pty.py` under the `multi-session-harness` target.

| Scenario | Story | Asserts |
| --- | --- | --- |
| switch between two running sessions | 1 | the picker opens, choosing another entry shows the target's banner, the pty is still alive, both daemons still hold their ports |
| a turn survives the switch | 2 | a turn started in the source finishes while the user is in the target, and its output is present on switching back |
| switch to a name not running | 3 | a session by that name starts, saved history is resumed, the terminal lands in it |
| leaving still works | 4 | after a switch, Ctrl-D "keep in background" leaves both sessions running, and "end the session" stops only the current one |
| unsent text stays with its session | FR-012 | type without sending, switch away, switch back, the text is there; the other session's input line never showed it |
| a failed switch changes nothing | FR-006 | switching to an unreachable target prints the reason, the pty is alive, the prompt still answers the original session |

## Checking the success criteria

- **SC-001, under a second**: time from Enter to the target's prompt. The
  harness's `wait_for` timeout is the crude version; measure by hand on a
  session with real history if it looks slow.
- **SC-002, the process survives**: the harness holds the same pty across the
  switch and asserts the child has not exited. A `wait_exit` that returns true
  is a failure now, the opposite of today's assertion.
- **SC-003, the in-flight turn completes**: scenario 2 above.
- **SC-004, no shell command printed**: grep the switch path's output for
  `--session` and expect nothing.
- **SC-005, existing harnesses unchanged**: `make test` plus every harness
  target that touches sessions, quit, rename or two clients, all green without
  edits, except the one exit assertion that this feature deliberately inverts.
- **SC-006, a failed switch is a no-op**: the failed-switch scenario above.
  Point the switch at a name whose daemon cannot start.
- **SC-007, drafts stay put**: the unsent-text scenario above, across at least
  three switches.

## What to look at when it fails

- **The target's transcript is empty.** The replay was not processed, or was
  processed into a scrollback that was cleared afterwards. Order matters:
  clear, then replay.
- **The prompt answers the wrong session.** The loop is still holding the old
  client. The switch replaces the whole session-scoped value; a missed field is
  the usual cause. See [data-model.md](data-model.md).
- **The switch hangs.** `ensureAttached` is waiting for a hello from a daemon
  that is not coming. It has its own timeouts; if they elapse the switch must
  fail and return the user to the session they came from, not hang.
- **The pre-commit hook rejects the commit.** A file crossed 450 lines or a
  comment was added. Split the file; move the explanation into this spec
  directory or `docs/`.
