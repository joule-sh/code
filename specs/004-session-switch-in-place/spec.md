# Feature Specification: Switch Sessions In Place

**Feature Branch**: `004-session-switch-in-place`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "Session management: switching to another session from inside the running application must not quit the application. Today, changing session exits the program; the user should be able to switch between sessions and keep the terminal running."

## What is true today

A workspace can run several named sessions at once. `joule --session review`
starts or attaches to the one called `review`; a plain `joule` is the unnamed
one, shown as `default`. `/session` with no argument lists the running sessions
in a picker, and `/session <name>` picks one.

Picking a different session ends the program. The terminal restores the screen,
warms the target session up in the background, prints "run `joule --session
<name>` here to enter it", and exits to the shell. The user then types that
command by hand. The session they left keeps running in the background, which
is correct; the exit is the problem. This was a deliberate first cut, recorded
in `src/terminal/session_switch.ts`: there was no verified way to hand a live
terminal from one session to another, so printing the command was the honest
option. This feature is that handoff.

Both terminals this codebase has behave this way: the standalone one, which
owns its own history, and the daemon-attached one, which talks to a daemon that
owns the history.

## Clarifications

### Session 2026-09-04

- Q: When you switch sessions with half-typed text in the input line, what happens to that text? → A: It is kept for the session you left and restored when you switch back; the target starts with its own draft, or empty.
- Q: If joining the target fails, what should happen? → A: Join the target first and only leave the current session once the join succeeded, so a failed switch never leaves the user without a session.
- Q: How much of a long transcript should a switch repaint? → A: All of it, exactly as starting `joule --session <name>` shows today. No cap.
- Q: Should the number of sessions running at once be limited? → A: No limit. Print a one-line note when a switch starts a session beyond a threshold, and proceed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick a running session and land in it (Priority: P1)

A developer has two sessions running on a workspace, say `default` and
`review`. From inside `default` they run `/session review` or choose `review`
in the `/session` picker. The screen changes to the `review` session: its
transcript so far, its mode, its model, its prompt. The program never exits.
They type a request and it goes to `review`.

**Why this priority**: This is the whole feature. Everything else is a
refinement of it.

**Independent Test**: Start two sessions on one workspace, switch from one to
the other with `/session`, confirm the process is the same one and the prompt
now belongs to the target session. Delivers the ability to move between
sessions without leaving the program.

**Acceptance Scenarios**:

1. **Given** sessions `default` and `review` are both running on the workspace
   and the user is in `default`, **When** they run `/session review`, **Then**
   the same process now shows `review`'s transcript and prompt, and the shell
   does not get control back.
2. **Given** the user is in `default` with the `/session` picker open showing
   `default (current)` and `review`, **When** they move to `review` and press
   Enter, **Then** the outcome is the same as scenario 1.
3. **Given** the user has just switched into `review`, **When** they type a
   request, **Then** the request is answered in `review` and `default`'s
   transcript is untouched.
4. **Given** the user is in `default`, **When** they run `/session default` or
   press Enter on the current entry in the picker, **Then** they stay where
   they are and see a note saying so, as today.

---

### User Story 2 - The session left behind keeps running (Priority: P1)

While `default` is answering a request, the developer switches to `review`.
`default` finishes its turn in the background. When they switch back, the
transcript shows the completed answer.

**Why this priority**: The reason to have several sessions is to let one work
while you look at another. A switch that stalled or lost the in-flight turn
would make the feature worse than the exit it replaces.

**Independent Test**: Start a long-running turn in `default`, switch to
`review` before it ends, switch back, confirm the turn completed and its text
is in `default`'s transcript.

**Acceptance Scenarios**:

1. **Given** `default` has a turn in flight, **When** the user switches to
   `review`, **Then** the switch completes without waiting for the turn, and
   the turn continues in the background.
2. **Given** the user switched away from `default` mid-turn, **When** they
   switch back after it finished, **Then** the transcript shows the full
   answer, including any tool calls it made while unwatched.
3. **Given** `default` asked for an approval and the user switched away before
   answering, **When** they switch back, **Then** the approval is still
   waiting and can be answered.
4. **Given** the user is in `review`, **When** `default` in the background
   reaches an approval prompt or ends a turn, **Then** `review`'s screen is not
   interrupted by it. A one-line notice that `default` needs attention is
   acceptable; taking over the screen is not.

---

### User Story 3 - Switch to a session that is not running yet (Priority: P2)

The developer runs `/session planning` and no session by that name is running.
The session starts, resuming its saved history if it has one, and the terminal
lands in it, still in the same process.

**Why this priority**: Today `/session <name>` with an unknown name already
warms that session up before exiting, so users expect it to work. It matters
less than P1 because the picker only offers running sessions and a new session
can also be started from the shell.

**Independent Test**: With only `default` running, run `/session planning`,
confirm a session called `planning` now exists, is running, and the terminal is
in it.

**Acceptance Scenarios**:

1. **Given** no session named `planning` exists, **When** the user runs
   `/session planning`, **Then** a new empty session by that name starts and
   the terminal lands in it.
2. **Given** a session named `planning` has saved history but is not running,
   **When** the user runs `/session planning`, **Then** it starts with that
   history resumed, and the terminal lands in it.
3. **Given** the target session cannot be started, **When** the user runs
   `/session planning`, **Then** the terminal stays in the current session and
   prints why, and nothing has exited.

---

### User Story 4 - Leaving still works the way it does now (Priority: P3)

Switching is a new path, not a replacement for leaving. Ctrl-D and `/exit`
still ask what should happen to the session, keeping it in the background or
ending it, exactly as today. `/rename` still renames the current session.

**Why this priority**: These already work. The story exists so the switch does
not break them and so a reviewer checks it.

**Independent Test**: Run the existing quit and rename flows before and after
a switch and confirm nothing changed.

**Acceptance Scenarios**:

1. **Given** the user has switched from `default` to `review`, **When** they
   press Ctrl-D and choose "keep in background", **Then** `review` keeps
   running, `default` keeps running, and the program exits with the same notes
   it prints today for `review`.
2. **Given** the user has switched into `review`, **When** they press Ctrl-D
   and choose "end the session", **Then** `review` stops and `default` is left
   alone.

---

### Edge Cases

- The target session is the one the user is already in. Stay, print the
  staying note, as today.
- The target session stops on its own, or is stopped by another client, while
  the switch is in progress. The terminal reports it and stays in the session
  it came from.
- The target session is being driven by another attached terminal or a browser
  at the same time. Both see the same transcript, the same as two attached
  clients do today; a switch is another attach.
- The session left behind stops while the user is elsewhere. Switching back
  reports that it stopped, offers its saved history, and does not crash.
- The picker was opened, then a session it lists stopped before Enter. Picking
  it is the same as a not-running name: start it or report why not.
- Terminal state that belongs to the screen and not the session, such as mouse
  reporting and colour, carries over the switch. State that belongs to the
  session, such as mode, model, pending approval, transcript and unsent input,
  comes from the target.
- The switch is refused by the target while the current session is still joined.
  Nothing is lost: the user is told why and is still in the session they were
  in, with their unsent text intact.
- Several switches in a row, or a switch back and forth, leave each session's
  unsent text with its own session rather than accumulating on one of them.
- A switch requested while an approval prompt or the quit prompt is open. The
  open prompt is answered or dismissed first; a switch is not a way to skip it.
- `--continue` was given at startup. It applies to the session the program
  started in, never to a session switched into later.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `/session <name>` and picking an entry in the `/session` picker
  MUST move the terminal into that session without the process exiting.
- **FR-002**: After a switch the screen MUST show the target session's
  transcript, current mode, current model and any approval it is waiting on,
  and the prompt MUST send input to the target session.
- **FR-003**: The session switched away from MUST keep running: any turn in
  flight finishes, any pending approval stays pending, and its transcript is
  preserved for the next switch back.
- **FR-004**: A switch MUST NOT wait for the session being left to finish a
  turn. It completes while that turn continues in the background.
- **FR-005**: Switching to a name that is not running MUST start that session,
  resuming its saved history when there is one, and then land in it.
- **FR-006**: A switch MUST join the target before leaving the current session.
  When the target cannot be joined, the terminal MUST still be in the current
  session, having never left it, and MUST print the reason and continue
  accepting input.
- **FR-007**: The session left behind MUST NOT draw on, or take over, the
  screen of the session the user is now in. At most it may cause a one-line
  notice.
- **FR-008**: The current session's name MUST be visible after a switch, in the
  same place it is shown today, so the user always knows which session they
  are in.
- **FR-009**: The quit prompt, `/exit`, `/rename` and `/stop-daemon` MUST keep
  their existing behaviour and MUST act on the session the user is currently
  in, which after a switch is the target.
- **FR-010**: Switching MUST work in both terminals: the standalone one started
  by `joule` and the daemon-attached one started by `joule attach`.
- **FR-011**: The prompts and notes printed on a switch MUST no longer tell the
  user to run a command in the shell to get there, since they are already
  there.
- **FR-012**: Text typed but not sent MUST stay with the session it was typed
  in. Switching away preserves it, switching back restores it, and the target
  session shows its own unsent text or an empty line. Unsent text MUST NOT
  follow the user into another session.

  Implementation note, added after building it: in the attached terminal this
  is currently satisfied vacuously, because the input line is always empty at
  the moment of a switch. `/session <name>` consumes the line when it is
  submitted, and the picker swallows every key that is not an arrow or Enter,
  so a draft and a switch cannot coexist there today. The per-session store is
  still in place and unit-tested, because it is what guarantees the second half
  of the rule: the target's input line is loaded from its own draft, so it can
  never inherit the previous session's text. The rule becomes observable the
  moment any path allows a switch with a non-empty line, which the standalone
  terminal and a future picker that accepts typing would both create.
- **FR-013**: A switch MUST show the target session's transcript in full, the
  same content that starting that session directly shows today. No part of it
  is trimmed on the grounds that the user arrived by switching.
- **FR-014**: Starting a session by switching MUST NOT be blocked by how many
  sessions are already running. When the switch would take the workspace past a
  threshold of running sessions, the terminal MUST print one line saying how
  many are running and how to end one, then continue.

### Key Entities

- **Session**: a named conversation on a workspace with its own transcript,
  mode, model and pending approval. `default` is the unnamed one. A session is
  either running or has saved history only.
- **Terminal**: the interactive program the user is typing in. Before this
  feature a terminal belongs to exactly one session for its whole life; after
  it, a terminal has a current session that can change.
- **Switch**: the act of changing a terminal's current session. It has a source
  session, a target session, and either succeeds or leaves the terminal where
  it was.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A switch between two running sessions on the same machine shows
  the target's prompt within one second of pressing Enter.
- **SC-002**: The shell never regains control during a switch: the process id
  of the terminal is the same before and after, in 100% of harness runs.
- **SC-003**: A turn in flight in the session left behind completes, and its
  full output is present on switching back, in 100% of harness runs.
- **SC-004**: Users who switch sessions no longer have to type a command in the
  shell to enter the target. The "run `joule --session` here" note disappears
  from the switch path entirely.
- **SC-005**: Every existing harness that exercises `/session`, quit, rename,
  multi-session and two-client behaviour passes unchanged, except the one that
  asserted the exit-and-print behaviour, which is updated to assert the switch.
- **SC-006**: A failed switch leaves the user in the session they started in,
  with their unsent text intact, in 100% of harness runs. There is no state in
  which a switch has left one session without having joined another.
- **SC-007**: The input line after a switch holds the target session's own
  unsent text, never the text of the session just left. Covered by unit tests
  on the per-session store; see the implementation note under FR-012 for why
  the attached terminal cannot yet reach a non-empty case end to end.

## Assumptions

- Several sessions on one workspace already run side by side and survive a
  terminal leaving them. This feature relies on that and does not change it.
- Switching is a new attach to the target followed by a detach from the source,
  in that order, not a merge of two sessions. The target's transcript is
  whatever it already holds; nothing from the source is copied into it. Both
  are briefly connected at once, which the workspace already tolerates today
  when a switch warms the target before exiting.
- Unsent text is per session and lives only as long as the terminal does. It is
  not written to disk and does not survive quitting.
- The threshold in FR-014 is a number the implementation picks, expected to be
  around five running sessions. It only ever produces a note, never a refusal,
  so the exact value is not load-bearing.
- The picker keeps listing only running sessions. Starting a not-running one is
  done by typing its name.
- The standalone terminal may satisfy this by moving its session under the
  same background ownership it already uses for "keep in background" and then
  attaching to the target, so both terminals switch the same way. That is a
  planning decision, not a requirement; the requirement is that both switch.
- Switching to a session on a different workspace is out of scope. `/session`
  stays scoped to the workspace the terminal was started in.
- Remote sessions reached through the relay are out of scope. A switch is
  between sessions on this machine.
- The one-line notice in FR-007 for a background session that needs attention
  is optional in this feature. Not showing it is acceptable; taking over the
  screen is not.
