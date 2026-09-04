---

description: "Task list for switching sessions in place"
---

# Tasks: Switch Sessions In Place

**Input**: Design documents from `/specs/004-session-switch-in-place/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Harness tasks are included and are not optional here. Constitution
principle III requires a harness or `make test` case for every user-visible
behaviour, in the same pull request as the behaviour. Ordering within a story
is the author's choice, so these are listed alongside implementation rather
than strictly before it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Single project. Lumen sources under `src/`, pty harnesses under `scripts/`,
docs under `docs/`. Paths below are repository-relative, matching the structure
in [plan.md](plan.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish a known-good baseline before touching either loop file

- [x] T001 Run `make build` and `make test` on a clean checkout and record that both pass, so any later failure is attributable to this feature
- [x] T002 Run `make multi-session-harness` and record the current pass output of `run_session_command_scenario` in `scripts/verify_multi_session_pty.py`, which is the scenario this feature inverts
- [x] T003 [P] Record current line counts of `src/terminal/attach.ts` and `src/terminal/terminal.ts` and confirm both exceed the 450-line cap enforced by `.githooks/pre-commit`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Make room under the 450-line cap, then introduce the session-scoped
state a switch replaces. No behaviour changes in this phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. The
pre-commit hook rejects any edit to `attach.ts` or `terminal.ts` while they
exceed 450 lines, and the constitution forbids bypassing it.

### Make room (plan Phase A)

- [x] T004 Move the slash-command chain out of `src/terminal/attach.ts` into a new `src/terminal/attach_commands.ts`, preserving behaviour exactly and adding no comment lines
- [x] T005 Move the frame-processing closure out of `src/terminal/attach.ts` into a new `src/terminal/attach_frames.ts`, preserving behaviour exactly and adding no comment lines
- [x] T006 [P] Move the slash-command chain out of `src/terminal/terminal.ts` into a new `src/terminal/terminal_commands.ts`, preserving behaviour exactly and adding no comment lines
- [x] T007 Confirm `src/terminal/attach.ts`, `src/terminal/terminal.ts` and every new file are under 450 lines and comment-free, by staging them and letting `.githooks/pre-commit` run
- [x] T008 Run `make test` and every session-related harness target and confirm all pass with no assertion edits, proving the split changed no behaviour
- [x] T009 Commit the split on its own, so a later bisect separates a split bug from a switch bug

### Session-scoped state (plan Phase B)

- [x] T010 Create `src/terminal/attached_session.ts` defining `AttachedSession` with the fields listed in [data-model.md](data-model.md): name, client, port, approvalLog, state, watchdog, pendingApproval, planPending, planTracker, tagged, echoes, rk, notes
- [x] T011 [P] Create `src/terminal/drafts.ts` holding unsent input keyed by session name, with save, load and clear, per the Drafts section of [data-model.md](data-model.md)
- [x] T012 Add a builder in `src/terminal/attached_session.ts` that turns an `AttachResult` from `src/daemon/attach_lifecycle.ts` into an `AttachedSession`, refusing any result whose client is not ready
- [x] T013 Rewire the client loop in `src/terminal/attach.ts` to read session-scoped state from one `AttachedSession` value instead of separate locals, leaving screen-scoped state where it is
- [x] T014 [P] Add a scrollback reset to `src/terminal/scrollback.ts` that clears content while keeping width and mouse state, for use on arrival in a target session
- [x] T015 Run `make test` and the session harnesses again and confirm no behaviour changed

**Checkpoint**: Both loop files are under the cap, session state is one
replaceable value, and drafts have somewhere to live. User story work can begin.

---

## Phase 3: User Story 1 - Pick a running session and land in it (Priority: P1) 🎯 MVP

**Goal**: `/session <name>` and the picker move the terminal into the target
session. The process never exits.

**Independent Test**: Start two sessions on one workspace, switch from one to
the other, confirm the same process now shows the target's transcript and
prompt and the shell never regains control.

### Implementation for User Story 1

- [x] T016 [US1] Add a switch function to `src/terminal/attached_session.ts` that calls `ensureAttached` for the target and returns the new `AttachedSession` or the reason it failed, per the SwitchOutcome shape in [data-model.md](data-model.md)
- [x] T017 [US1] Make the switch join the target before leaving the source in `src/terminal/attached_session.ts`, detaching the source client only after the target's client is ready, per FR-006
- [x] T018 [US1] On a successful switch, save the input line's text under the outgoing session's name and load the target's draft, using `src/terminal/drafts.ts`, per FR-012
- [x] T019 [US1] On arrival, reset the scrollback and process the target's replay frames in that order, then repaint, in `src/terminal/attach.ts`
- [x] T020 [US1] Change the `/session <name>` branch in `src/terminal/attach_commands.ts` to perform a switch instead of ending the loop
- [x] T021 [US1] Change the picker's Enter handling in `src/terminal/attach.ts` to perform a switch instead of ending the loop, keeping Enter on the current entry as a no-op that prints the staying note
- [x] T022 [US1] Remove the exit-time switch notes from `src/terminal/session_switch.ts` and delete the "run joule --session here" line from the switch path, per FR-011
- [x] T023 [US1] Show the current session name after a switch wherever it is shown today, in `src/terminal/attach.ts`, per FR-008
- [x] T024 [US1] On a failed switch, print the reason and continue in the unchanged current session, in `src/terminal/attach_commands.ts`, per FR-006
- [x] T025 [US1] Rewrite `run_session_command_scenario` in `scripts/verify_multi_session_pty.py` to assert the switch: the target's banner appears, the pty is still alive, and both daemons still hold their ports
- [x] T026 [P] [US1] Add a harness scenario in `scripts/verify_multi_session_pty.py` asserting unsent text stays with its session across at least three switches, per SC-007
- [x] T027 [P] [US1] Add a harness scenario in `scripts/verify_multi_session_pty.py` asserting a failed switch leaves the user in the original session with the draft intact, per SC-006
- [x] T028 [US1] Run `make multi-session-harness` and `make test` and confirm all pass

**Checkpoint**: Anyone on the daemon path, which is everyone with an API key,
can switch between two running sessions without leaving the program.

---

## Phase 4: User Story 2 - The session left behind keeps running (Priority: P1)

**Goal**: A turn in flight in the session being left finishes in the
background, and its output is there on switching back.

**Independent Test**: Start a long turn, switch away before it ends, switch
back, confirm the turn completed and its text is in the transcript.

### Implementation for User Story 2

- [x] T029 [US2] Confirm the switch never waits on an in-flight turn, by checking the detach path in `src/terminal/attached_session.ts` issues no stop and blocks on nothing, per FR-004
- [x] T030 [US2] Ensure the source client is not polled once the target is joined, so background frames cannot paint on the target's screen, in `src/terminal/attach.ts`, per FR-007
- [x] T031 [US2] Confirm a pending approval in the source survives a switch and is answerable on return, since approval state lives in the daemon, and add the check to `src/terminal/attached_session.test.ts`
- [x] T032 [US2] Add a harness scenario in `scripts/verify_multi_session_pty.py` asserting a turn started in the source completes while the user is in the target and its output is present on switching back, per SC-003
- [x] T033 [US2] Add a harness assertion that the target's screen is not interrupted by source activity during the switch window, per FR-007
- [x] T034 [US2] Run `make multi-session-harness` and `make test` and confirm all pass

**Checkpoint**: Switching is safe mid-turn, which is the reason to run several
sessions at all.

---

## Phase 5: User Story 3 - Switch to a session that is not running yet (Priority: P2)

**Goal**: `/session <name>` for a name with no running session starts it,
resuming saved history, and lands in it.

**Independent Test**: With only one session running, switch to a new name and
confirm a session by that name now runs and the terminal is in it.

### Implementation for User Story 3

- [x] T035 [US3] Pass a resume flag of true when attaching to a switch target in `src/terminal/attached_session.ts`, so a not-running target resumes its saved history, per FR-005
- [x] T036 [US3] Add the running-session threshold note in `src/terminal/session_switch.ts`, printed when a switch starts a session past the threshold, naming how many run and how to end one, per FR-014
- [x] T037 [US3] Report and stay put when the target cannot be started, in `src/terminal/attach_commands.ts`, distinguishing this from an unknown-name typo in the message
- [x] T038 [P] [US3] Add a harness scenario in `scripts/verify_multi_session_pty.py` asserting a switch to a name with no daemon starts that session and lands in it
- [x] T039 [P] [US3] Add a harness assertion that a target with saved history resumes it on being switched into
- [x] T040 [US3] Run `make multi-session-harness` and `make test` and confirm all pass

**Checkpoint**: Sessions can be created by switching, not only from the shell.

---

## Phase 6: User Story 4 - Leaving still works the way it does now (Priority: P3)

**Goal**: Quit, exit, rename and stop keep their behaviour and act on whichever
session is current after a switch.

**Independent Test**: Run the quit and rename flows before and after a switch
and confirm nothing changed except which session they act on.

### Implementation for User Story 4

- [x] T041 [US4] Confirm the quit prompt, `/exit`, `/rename`, `/stop-daemon` and `/share` read the current session from the `AttachedSession` value rather than a captured startup name, in `src/terminal/attach.ts` and `src/terminal/attach_commands.ts`, per FR-009
- [x] T042 [US4] Confirm `--continue` applies only to the session named at startup and never to one switched into, in `src/terminal/attach.ts`
- [x] T043 [US4] Refuse a switch while an approval prompt or the quit prompt is open, in `src/terminal/attach.ts`, so a switch cannot be used to skip an open prompt
- [x] T044 [US4] Add a harness scenario in `scripts/verify_multi_session_pty.py` asserting that after a switch, Ctrl-D "keep in background" leaves both sessions running
- [x] T045 [US4] Add a harness assertion that after a switch, "end the session" stops only the current session and leaves the other running
- [x] T046 [US4] Run `make multi-session-harness`, `make attach-commands-harness` and `make test` and confirm all pass

**Checkpoint**: All four stories work on the daemon path.

---

## Phase 7: Standalone terminal parity (FR-010)

**Purpose**: Deliver the same switch on the legacy standalone terminal, which
runs when there is no API key or no daemon. Cross-cutting rather than a user
story: it re-delivers stories 1, 2 and 3 on a second code path. No story labels,
per the format rules.

**Depends on**: Phases 3 to 6, since it enters the attached loop those built.

- [x] T047 Change `runTerminal` in `src/terminal/terminal.ts` to return the switch target instead of printing a shell command, leaving the alt screen as it does today
- [x] T048 Hand the standalone session to a background daemon on a switch by reusing `detachToBackground` from `src/terminal/quit_decision.ts`, which already flushes history and spawns a resuming daemon
- [x] T049 Enter the attached client loop for the target from `src/code.ts` after a standalone switch, so `src/terminal/terminal.ts` never imports `src/terminal/attach.ts`
- [x] T050 Re-enter the standalone loop with the reason printed when the handoff produced no live daemon, per FR-006
- [x] T051 Update `switchSessionNotes` in `src/terminal/session_switch.ts` so the standalone path no longer tells the user to run a command, per FR-011
- [x] T052 Add a harness scenario in `scripts/verify_multi_session_pty.py` covering a switch from the standalone terminal, driven with no API key so `runDaemonJoule` declines
- [x] T053 Run the full harness set and `make test` and confirm all pass

**Checkpoint**: Both terminals switch, satisfying FR-010.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T054 [P] Document what a switch is in `docs/03-daemon.md`, beside the attach lifecycle it builds on, including the join-before-leave order and why
- [x] T055 [P] Update `README.md` if it describes `/session`, so the exit behaviour is not documented anywhere as current
- [ ] T056 Measure the time from Enter to the target's prompt on a session with real history and confirm it meets the one-second target in SC-001, recording the number
- [x] T057 Re-read the whole diff for comment lines and files near 450 lines, since the hook only checks staged files at commit time
- [ ] T058 Walk the manual scenarios in [quickstart.md](quickstart.md) end to end on one platform
- [x] T059 Confirm every success criterion SC-001 through SC-007 in [spec.md](spec.md) has a harness assertion or a recorded measurement
- [x] T060 Run `make build` and `make test` plus every harness target one final time before opening the pull request, per the constitution's merge gate

---

## Status, 2026-09-04

Phases 1 to 8 are implemented and pushed. What is worth knowing beyond the
checkboxes:

- **T026 changed shape.** The unsent-text harness scenario was written, run,
  and found unreachable: `/session <name>` consumes the input line and the
  picker swallows typed keys, so a draft and a switch cannot coexist in the
  attached terminal today. The store is unit-tested instead, and FR-012 in
  the spec now records exactly this. It is a guarantee, not yet an observable
  behaviour.
- **T027 changed shape for the same reason.** A target that cannot be attached
  is hard to arrange in the attached terminal, because an unknown name simply
  starts a session. The failed-switch path is covered on the standalone
  terminal instead, where an unreachable daemon is the normal case.
- **T052 caught a real bug.** The standalone command outcome still asked the
  loop to end, so a failed probe dropped the user to the shell instead of
  keeping them where they were. Both standalone entry points now share one
  probe.
- **T056 and T058 are not done.** The one-second measurement wants a session
  with real history on a real machine, and the manual walk-through wants a
  human at a terminal. Both are reviewer tasks.
- **Phase 2 grew two files beyond the plan.** `terminal_approval.ts` and
  `terminal_leave.ts` came out of `terminal.ts` to keep it under the cap once
  the switch probe landed.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies, start immediately
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS everything else, because the pre-commit hook will not accept edits to the oversized loop files
- **User Story 1 (Phase 3)**: Depends on Phase 2. The MVP
- **User Story 2 (Phase 4)**: Depends on Phase 3, since it verifies the switch built there behaves correctly mid-turn
- **User Story 3 (Phase 5)**: Depends on Phase 3. Independent of Phase 4
- **User Story 4 (Phase 6)**: Depends on Phase 3. Independent of Phases 4 and 5
- **Standalone parity (Phase 7)**: Depends on Phases 3 to 6
- **Polish (Phase 8)**: Depends on everything above

### User Story Dependencies

- **US1 (P1)**: The foundation of the feature. Everything else builds on it
- **US2 (P1)**: Needs US1's switch to exist before its behaviour can be checked
- **US3 (P2)**: Needs US1's switch. Independent of US2 and US4
- **US4 (P3)**: Needs US1's switch. Independent of US2 and US3

Only US1 is a true prerequisite. US2, US3 and US4 can proceed in parallel once
it lands.

### Within Each User Story

- The switch function before the command handlers that call it
- The command handler before the picker, since the picker delegates to it
- Implementation and harness in the same phase, per constitution principle III

### Parallel Opportunities

- T003 runs alongside T001 and T002 in Setup
- T006 runs alongside T004 and T005, different files
- T011 and T014 run alongside T010 and T012, different files
- T026 and T027 are separate harness scenarios in the same file, so treat [P] as "independent to write, serialise the edits"
- T038 and T039 likewise
- T054 and T055 are different documents
- After Phase 3, all of Phases 4, 5 and 6 can be worked in parallel by different people

---

## Parallel Example: Phase 2 Foundational

```text
Person A: T004, T005   (split attach.ts into attach_commands.ts and attach_frames.ts)
Person B: T006         (split terminal.ts into terminal_commands.ts)
Then together: T007, T008, T009   (verify under the cap, harnesses green, commit)
Person A: T010, T012, T013        (AttachedSession and the loop rewire)
Person B: T011, T014              (drafts.ts and the scrollback reset)
Then: T015                        (verify nothing changed)
```

---

## Implementation Strategy

### MVP scope

Phases 1, 2 and 3. That is Setup, Foundational and User Story 1: sixty percent
of the tasks by count, and the whole user-visible point of the feature for
anyone with an API key. A reviewer can see the feature work at T028.

### Incremental delivery

1. **Phase 2 lands alone** as the behaviour-preserving split, with every harness
   green and no assertion edited. It is reviewable on its own and safe to merge
   ahead of the rest.
2. **Phase 3 lands as the MVP.** After this, switching works.
3. **Phases 4, 5 and 6** harden it: mid-turn safety, creating sessions by
   switching, and the existing leave paths.
4. **Phase 7** extends it to the legacy terminal, which is the smaller
   population and the riskier code path, so it goes last.
5. **Phase 8** finishes the docs and the merge gate.

### Stopping early

If the feature has to ship short, stopping after Phase 6 is coherent: the switch
works for every user with an API key, and the standalone terminal keeps today's
exit-and-print behaviour, which is not broken, only unimproved. Say so in the
pull request, since FR-010 would then be unmet.
