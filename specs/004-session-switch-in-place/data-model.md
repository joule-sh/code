# Data Model: Switch Sessions In Place

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-04

No stored data changes. Session persistence, daemon runtime records and the
frame protocol are all untouched. What follows is the in-memory shape the
terminal needs so that a switch can replace one session with another.

## AttachedSession

Everything the terminal holds *about the session it is currently in*. Built
from an `AttachResult` (`src/daemon/attach_lifecycle.ts:266`) and replaced
whole on a switch.

| Field | What it holds | Source on build |
| --- | --- | --- |
| `name` | session name, `""` for the default one | the switch target, or the startup flag |
| `client` | the connected `DaemonClient` | `AttachResult.client` |
| `port` | the daemon's port, used by the watchdog | `AttachResult.port` |
| `approvalLog` | current approval mode and the approval history | mode from `session.hello`, else the startup default |
| `state` | model, current turn id, stop reason | model from `session.hello`, else the config default |
| `watchdog` | overdue-turn detection, keyed by port | new, from `port` |
| `pendingApproval` | the approval prompt on screen, if any | new, then filled by the replay |
| `planPending`, `planTracker` | plan-mode decision state | new |
| `tagged` | background task turn grouping | new |
| `echoes` | prompts typed locally, so the replay does not double them | new |
| `rk` | turn status tracker for the status line | new |
| `notes` | one-off lines to show on arrival | `AttachResult.notes` |

**Validation rules**

- An `AttachedSession` is only built from an `AttachResult` whose
  `client.socketReady` is true. A result that is not ready never becomes one;
  the switch fails and the previous value stays current (FR-006).
- `name` is the name that was attached to, never the name that was asked for,
  so the two cannot drift.
- At most one `AttachedSession` exists at a time in a terminal. Building the
  next one happens only after `detach()` on the previous.

## What is not in it

Screen-scoped state stays outside and survives a switch: the `Scrollback` and
its width, the `InputLine` and `InputHistory`, mouse reporting and colour
accent, the sign-in state, the update notifier and its offer or install
prompts, the quit prompt, the session picker, `serverBase` and `argv`.

The rule: if it describes what the user is looking at or typing on, it lives
outside. If it describes the conversation, it lives in `AttachedSession`.

## Drafts

Unsent input is the exception to that rule: the widget is screen-scoped but its
text belongs to a session (FR-012), and it must outlive the `AttachedSession`
it was typed in so that switching back can restore it.

| Field | What it holds |
| --- | --- |
| `byName` | session name to unsent text, for every session visited in this terminal's lifetime |

**Validation rules**

- A switch saves the input widget's current text under the outgoing session's
  name, then loads the incoming session's entry, empty string when it has none.
- Sending a request clears that session's entry, because the text is no longer
  unsent.
- Entries are never written to disk and do not survive the terminal exiting.
- A draft is never shown to a session other than the one it was typed in, which
  is what SC-007 checks.

## SwitchOutcome

What one attempt to change session produces. Not a stored type; the shape a
switch function returns so the loop knows what to do.

| Field | Meaning |
| --- | --- |
| `session` | the new `AttachedSession`, or nothing when the switch failed |
| `notes` | lines to show: arrival notes, or the reason it failed |

**State transitions**

```text
                  /session <name>, or Enter in the picker
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
      name == current                        name != current
              │                                     │
        stay, print note              ensureAttached(name, resume)
        (FR-001 unchanged)            source stays joined, unpolled
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │                               │
                              socketReady                     not ready
                                    │                               │
                        save draft under source name      print the reason
                        detach source client              nothing changed:
                        build AttachedSession             still in source,
                        clear scrollback                  draft untouched
                        replay pending frames             (FR-006)
                        load target's draft
                        show target's prompt
```

The source is left only after the target is joined, so the failure branch has
nothing to undo (FR-006, SC-006). The source daemon is never stopped by a
switch, in either outcome: it keeps running with its turn and any pending
approval (FR-003).

## Session, as the user sees it

Unchanged by this feature, restated so the entities in the spec have a
concrete referent.

| Property | Where it lives today |
| --- | --- |
| name | the `--session` flag, `""` for default |
| transcript | the daemon's replay buffer, and `~/.config/joule-code/sessions/<key>.json` |
| mode, model | announced in `session.hello`, changed by `mode.set` and `model.set` |
| running or not | whether a daemon holds the port recorded for that name |

`runningSessionsFor(workspaceRoot)` (`src/daemon/attach_lifecycle.ts:173`)
is what the picker lists. A name absent from it is a session that exists only
as saved history, or not at all; both are started by attaching with resume
(FR-005).
