# Implementation Plan: Switch Sessions In Place

**Branch**: `004-session-switch-in-place` | **Date**: 2026-09-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-session-switch-in-place/spec.md`

## Summary

`/session <name>` and the `/session` picker currently end the program and tell
the user to run `joule --session <name>` themselves. This makes them move the
terminal into the target session instead.

The approach follows from one fact established in research: a plain `joule`
already runs the daemon-attached client, and attaching to a session is already
a self-contained operation that returns the whole transcript as a replay. So a
switch is an attach to the target, a detach from the source, and a repaint, in
that order. No new frame type, no daemon change, no protocol version bump.

The work is in the terminal. The attached client loop keeps its session-scoped
state in one value that a switch replaces, while screen-scoped state, the
scrollback, the input widget, mouse and colour, survives untouched. Unsent text
is the one thing that is neither: it stays with the session it was typed in,
held in a per-name map beside the screen state. The standalone terminal, which
is legacy and cannot leave a turn running, hands its session to a background
daemon exactly as "keep in background" already does, then enters the attached
loop for the target.

Both terminal files exceed the 450-line cap, so a behaviour-preserving split
lands first as its own commit.

## Technical Context

**Language/Version**: Lumen, toolchain pinned at `LUMEN_VERSION: v0.7.5` in
`.github/workflows/test.yml`

**Primary Dependencies**: Lumen stdlib and the vendored packages already under
`src/vendor`. No new dependency.

**Storage**: Existing session persistence, `~/.config/joule-code/sessions/<key>.json`
via `src/session/persistence.ts`. Unchanged by this feature.

**Testing**: `make test` for unit tests, plus pty harnesses driven by
`bin/stub_model`. This feature's harness is `make multi-session-harness`
(`scripts/verify_multi_session_pty.py`).

**Target Platform**: x86_64 Linux, Apple Silicon macOS, Intel macOS, x86_64
Windows. The switch is terminal logic and uses no platform-specific call the
attach path does not already make, so all four are in scope.

**Project Type**: CLI, a terminal application with a background daemon.

**Performance Goals**: A switch between two running sessions shows the target's
prompt within one second (SC-001). The dominant cost is `ensureAttached`'s
connect-and-hello wait, which is already on the path today.

**Constraints**: No `.ts` file over 450 lines and no comment lines in `src/`,
enforced by `.githooks/pre-commit`. The switch must not block on an in-flight
turn in the session being left (FR-004).

**Scale/Scope**: Two terminal loops, roughly a dozen source files, one existing
harness scenario rewritten and two added.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.0.0.

| Principle | Status | Evidence |
| --- | --- | --- |
| I. Lumen for everything | Pass | All production code is Lumen under `src/terminal` and `src/daemon`. Harnesses are Python under `scripts/`, which is the existing and accepted pattern for pty verification, not a second implementation language. No new dependency. |
| II. Code without comments, files under 450 lines | Pass, with work | `attach.ts` (595) and `terminal.ts` (582) are already over the cap, so the first commit splits them. New files are comment-free; explanation lives in this plan and the spec. |
| III. A harness for every behaviour | Pass | Each user story maps to a named scenario in `scripts/verify_multi_session_pty.py`, run by `make multi-session-harness` against `bin/stub_model`. |
| Constraint: four platforms build | Pass | No platform-specific code is added. |
| Constraint: features live in `specs/` | Pass | `specs/004-session-switch-in-place/`, indexed in `specs/README.md`. |

**Post-design re-check**: Still passing. The design adds five files, all well
under the cap and all comment-free by construction, and removes lines from the
two oversized ones. No principle needed a justification, so Complexity Tracking
is omitted.

## Project Structure

### Documentation (this feature)

```text
specs/004-session-switch-in-place/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── session-command.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Created by /speckit-tasks, not by this command
```

### Source Code (repository root)

```text
src/
├── code.ts                        # entry dispatch; owns the standalone-to-attached handoff
├── terminal/
│   ├── attach.ts                  # attached client loop; shrinks below 450, gains the switch
│   ├── attach_commands.ts         # new: the slash-command chain lifted out of attach.ts
│   ├── attach_frames.ts           # new: the frame-processing closure lifted out of attach.ts
│   ├── attached_session.ts        # new: session-scoped state, built from an AttachResult
│   ├── session_switch.ts          # picker and notes; the exit-time notes are replaced
│   ├── terminal.ts                # standalone loop; shrinks below 450, returns a switch target
│   ├── terminal_commands.ts       # new: the slash-command chain lifted out of terminal.ts
│   ├── quit_decision.ts           # detachToBackground, reused by the standalone switch
│   └── scrollback.ts              # gains a reset that keeps width and mouse state
├── daemon/
│   └── attach_lifecycle.ts        # ensureAttached, unchanged
└── session/
    └── persistence.ts             # unchanged

scripts/
└── verify_multi_session_pty.py    # switch scenarios replace the exit scenario
```

**Structure Decision**: The existing layout is kept. `src/terminal` holds the
two loops and their helpers, `src/daemon` the attach lifecycle they both call,
and `scripts/` the pty harnesses. Five new files under `src/terminal` carry
code lifted out of the two oversized loop files plus the new session-scoped
state; nothing moves between directories.

## Phases

### Phase A: Make room (no behaviour change)

Split `attach.ts` and `terminal.ts` below the cap by moving the slash-command
chains and the frame-processing closure into new files. Every existing harness
passes unchanged. This lands as its own commit so the switch's diff is only the
switch.

### Phase B: Session-scoped state

Introduce `AttachedSession`: the value built from an `AttachResult` that holds
everything a switch replaces (see [data-model.md](data-model.md)). Rewire the
attached loop to read from it. Still no behaviour change, still green.

### Phase C: The switch in the attached terminal

`/session <name>` and the picker set a switch target instead of ending the
loop. The loop attaches to the target, and only on success saves the draft,
detaches the source, clears the scrollback, replays the target's frames, loads
the target's draft and carries on. A failed attach prints why and changes
nothing. The session-count note of FR-014 is printed here, when the switch
started a session past the threshold. User Stories 1, 2 and 3 become true here
for anyone on the daemon path, which is everyone with an API key.

### Phase D: The switch in the standalone terminal

`runTerminal` returns the target instead of printing the shell command.
`src/code.ts` hands the session to a background daemon and enters the attached
loop for the target. User Story 4 is verified here: quit, rename and stop still
act on the current session.

### Phase E: Harnesses and docs

Rewrite the exit scenario, add the in-flight-turn and not-running-target
scenarios, and update `docs/03-daemon.md` with what a switch is, since it is
the file that describes the attach lifecycle.

## Risks

- **The replay is large.** A long-running target session replays its whole
  transcript on attach. This is existing behaviour for any attach, so a switch
  is no worse than starting `joule --session <name>` today, but it is the most
  likely cause of missing SC-001 on an old session. Measure before optimising.
- **Two daemons at once.** A switch has the source daemon and the target daemon
  both up, and now both clients connected while the target is joined, since
  joining comes before leaving. The existing harness already tolerates two
  daemons; the second client is short-lived and is not polled, so it cannot
  paint. Memory cost is the same as today's warm-up path.
- **Sessions accumulate.** Switching makes starting sessions cheap, so a
  workspace can end up with several daemons the user has forgotten. FR-014's
  note is the mitigation, deliberately advisory rather than a cap.
- **The split touches everything.** Phase A moves large blocks of code. The
  mitigation is that it is a separate commit with no behaviour change, so a
  bisect can tell a split bug from a switch bug.
