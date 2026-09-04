# Research: Switch Sessions In Place

**Feature**: [spec.md](spec.md) | **Date**: 2026-09-04

Everything below was read from the code on this branch. Line references are to
the files as they are today, before the split described in the plan.

## R1. Which terminal a user is actually in

**Finding**: A plain `joule` with an API key attaches to a daemon. `src/code.ts`
calls `runDaemonJoule` first (`src/terminal/attach.ts:76`), which runs
`ensureAttached` and, on success, the attached client loop `runClientLoop`. The
standalone `runTerminal` in `src/terminal/terminal.ts` runs only when
`runDaemonJoule` declines: no API key, or no daemon could be reached or
spawned. `docs/03-daemon.md` ("Why the split isn't ...") records that the
standalone is legacy and the attach-only terminal is the target.

**Decision**: The attached client loop is the primary site of the switch. The
standalone terminal switches by handing its session to a daemon and then
entering the attached client loop for the target, so from that point on it is
the same code path.

**Alternatives considered**: Teaching the standalone terminal to rebuild its
in-process `Session`/`Gate`/`LiveProvider` for another session. Rejected: it
cannot leave a turn running in the background, since `session.submit` is
synchronous (`src/terminal/relay_bridge.ts:15`), and the daemon already
solves exactly that. Doing it twice would be the rewrite `docs/03-daemon.md`
declined.

## R2. What a switch is, in daemon terms

**Finding**: Attaching is `ensureAttached(workspaceRoot, sessionName,
resumeFlag)` (`src/daemon/attach_lifecycle.ts:299`). It finds or spawns the
daemon for that name, connects a fresh `DaemonClient`, waits for
`session.hello`, and returns `AttachResult { client, spawned, pending, port,
notes }`. `pending` is the daemon's full replay: every frame of the session so
far, which is how a late-joining client sees the transcript
(`docs/03-daemon.md`, "A client joining is replayed the session it is
joining"). Detaching is `client.detach()`; the daemon keeps running and keeps
its in-flight turn (`docs/03-daemon.md`, attach lifecycle). Today's exit path
already calls `ensureAttached(target, true)` then `detach()` just to warm the
target (`src/terminal/session_switch.ts:115`).

**Decision**: A switch is: `ensureAttached(target, true)`, and only once that
returns a ready client, `client.detach()` on the source, then process the
target's `pending` as a replay into a cleared scrollback. No new frames, no
daemon change. `resumeFlag` stays `true` so a not-running target resumes its
saved history (FR-005), the same value the warm-up passes today.

The order is fixed by clarification: join the target before leaving the
current session (FR-006), so a failed switch is a no-op with an error line
rather than a state where the terminal has left one session without joining
another. Both clients are connected for the duration of the attach, which the
existing harness already tolerates, since today's warm-up path also holds two
daemons at once. The source client is not polled during that window, so it
cannot draw on the screen (FR-007).

**Alternatives considered**: Detach first, then attach, rejoining the source
if the target fails. Rejected by clarification: the rejoin can itself fail and
strand the user with no session. A daemon-side "transfer" frame moving a client
between sessions. Rejected: sessions run in separate daemon processes on
separate ports (`portFromWorkspace(workspaceRoot, sessionName, ...)`), so
there is no single daemon to ask. Keeping the source client connected after
arrival. Rejected: FR-007 says the source must not draw on the target's screen,
and the simplest way to guarantee that is not to be listening to it. The
optional one-line notice in FR-007 is deferred (see R6).

## R3. Which state belongs to the screen and which to the session

**Finding**: `runClientLoop` (`src/terminal/attach.ts:149`) builds everything
in one scope. Reading the constructors and their uses:

| Belongs to the screen (survives a switch) | Belongs to the session (rebuilt on a switch) |
| --- | --- |
| `Scrollback sb` (cleared, not replaced, so width and mouse state hold) | `DaemonClient client` |
| `InputLine input`, `InputHistory history` (the widget; its text is swapped, see below) | `ApprovalLog approvalLog` (mode) |
| `mouse` from `enterScreen`, colour accent | `ClientState state` (model, turnId, stopReason) |
| `SignIn signin` | `TurnWatchdog watchdog` (keyed by port) |
| `PendingUpdateOffer`, `PendingUpdateInstall`, `notifier` | `PendingApproval pendingApproval` |
| `PendingQuitDecision`, `PendingSessionPick` | `PendingPlanDecision planPending`, `PlanOfferTracker planTracker` |
| `serverBase`, `argv` | `TaggedTurns tagged`, `LocalPrompts echoes` |
| | `TurnStatusTracker rk` (turn status line) |
| | `sessionName`, `result` (port, notes) |

**Decision**: Group the right-hand column into one `AttachedSession` value
built by one function from an `AttachResult`, so the loop can replace it
whole. The left-hand column stays where it is. `sessionName` becomes a field
of `AttachedSession` rather than a parameter of the loop.

Unsent input is the one thing that straddles the line. The `InputLine` widget
is screen-scoped and stays, but the text in it belongs to the session
(FR-012). It cannot live in `AttachedSession`, which is discarded on the way
out; it has to outlive the session that produced it so switching back can
restore it. So a switch saves the widget's text into a `Drafts` map keyed by
session name, which sits with the screen-scoped state, then loads the target's
entry, empty for a session not visited yet. Nothing is written to disk; a
draft lives as long as the terminal does.

## R4. The 450-line cap

**Finding**: `src/terminal/attach.ts` is 595 lines and
`src/terminal/terminal.ts` is 582. The pre-commit hook checks the whole length
of every staged `.ts` file, so touching either file at all requires bringing it
under 450 first. The constitution (principle II) forbids bypassing the hook.

| File | Lines | Must shed |
| --- | --- | --- |
| `src/terminal/attach.ts` | 595 | at least 146 |
| `src/terminal/terminal.ts` | 582 | at least 133 |

Both files have the same shape: setup, a `processFrames` or frame-dispatch
closure, a key loop with prompt handling, then a long `if (cmd.kind == ...)`
chain of slash commands, then teardown. The command chain alone is about 150
lines in each.

**Decision**: A behaviour-preserving split lands first, as its own commit, with
every harness passing unchanged. From `attach.ts`, the slash-command chain
moves to `src/terminal/attach_commands.ts` and the frame handling closure to
`src/terminal/attach_frames.ts`. From `terminal.ts`, the slash-command chain
moves to `src/terminal/terminal_commands.ts`. Each new file is under 450 and
comment-free. The switch is then built on the split files.

**Alternatives considered**: Bypassing the hook for "just this change".
Rejected by the constitution. Writing the switch in a new file and leaving
`attach.ts` untouched. Rejected: the loop's `running = false` and teardown are
in `attach.ts` and must change (FR-001, FR-011); there is no way to switch
without editing it.

## R5. The standalone terminal's handoff

**Finding**: "Keep in background" on Ctrl-D already hands a standalone session
to a daemon: `detachToBackground` (`src/terminal/quit_decision.ts:54`)
flushes history with `persistTurnEnd`, then `ensureAttached(workspaceRoot,
sessionName, true)` spawns a daemon that resumes it. The standalone loop
cannot receive `/session` while a turn is running, because `session.submit`
blocks the key loop, so there is never an in-flight turn to lose at the moment
of a switch.

**Decision**: In the standalone terminal, `/session <target>` leaves the key
loop as today, restores the screen, and calls `detachToBackground` for its own
session. If that produced a live daemon, it then enters the attached client
loop for the target instead of exiting. If it did not, it prints the reason and
re-enters its own loop (FR-006). `runTerminal` returns the switch target to
`src/code.ts`, which owns the handoff, so `terminal.ts` does not import
`attach.ts`.

**Alternatives considered**: Not supporting the switch from the standalone.
Rejected by FR-010. Attaching to the target from inside the standalone loop.
Rejected: it would need the attached loop's state inside the standalone loop,
which is the merge R1 declined.

## R6. The optional background-attention notice

**Finding**: The spec allows, but does not require, a one-line notice when a
session left behind reaches an approval or ends a turn. Delivering it would
mean keeping a second `DaemonClient` polling the source daemon while attached
to the target, and deciding what to do with its frames.

**Decision**: Out of this feature. Recorded here so the next person does not
rediscover it. A follow-up can add a light "needs attention" poll once the
switch itself has shipped.

## R7. Harnesses

**Finding**: `scripts/verify_multi_session_pty.py`,
`run_session_command_scenario`, is the only harness that asserts the exit: it
waits for "keeps running", then `wait_exit`, then checks both daemons are
still up. `verify_attach_commands.py` and `verify_two_clients.py` do not
exercise `/session`.

**Decision**: That scenario is rewritten to assert the switch: after choosing
`review` the same pty shows the `review` banner and answers a prompt from
`review`, the process is still alive, and both daemons still hold their ports.
A new scenario covers the in-flight turn (User Story 2) and a new one covers
switching to a not-running name (User Story 3). They live in the same file,
under the existing `multi-session-harness` target, so no new Makefile target
is needed unless the file itself crosses a size the maintainers dislike.
