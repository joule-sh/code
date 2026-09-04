# Contract: the `/session` command

**Feature**: [../spec.md](../spec.md) | **Date**: 2026-09-04

The user-facing contract of `/session`, before and after this feature. This is
a CLI, so the contract is the command, its output and its effect on the
process, not an HTTP surface.

## `/session` with no argument

Unchanged by this feature.

| Condition | Behaviour |
| --- | --- |
| only this session is running | prints `session: <name>`, where the default one reads as `default` |
| more than one is running | opens the picker: title `switch session`, the current session first and marked `(current)`, up and down arrows to move, Enter to choose |

Enter on the current entry stays put and prints the staying note. Enter on
another entry is the same as `/session <that name>`.

## `/session <name>`

| Case | Before | After |
| --- | --- | --- |
| name is the current session | prints `already in the <name> session` and stays | unchanged |
| name is another running session | warms the target, prints `run joule --session <name> here to enter it`, then **exits to the shell** | **enters the target session in this process**; no shell command is printed |
| name is not running | same as above: warms it, prints the command, exits | starts it, resuming saved history if any, then enters it |
| the target cannot be started or attached to | prints why, then exits | prints why and **stays in the current session**, which it never left, still accepting input with unsent text intact |
| the switch starts a session past the running-session threshold | no such notion | starts it, prints one line saying how many sessions are running and how to end one, then enters it |

## What the user sees on a successful switch

1. The screen clears of the previous session's transcript.
2. The target session's transcript appears in full, up to its current point,
   the same content that starting that session directly shows.
3. The status line and prompt show the target's mode and model.
4. If the target is waiting on an approval, that prompt is on screen and can be
   answered.
5. The input line holds whatever was left unsent in the target session, or is
   empty on a first visit. Text typed in the session just left is not there.
6. The current session's name is visible where it always is.

No line of output tells the user to run a command in the shell. That note is
removed from this path entirely (FR-011).

## Unsent text

Text typed but not sent belongs to the session it was typed in. Switching away
keeps it, switching back restores it, sending clears it. It is never carried
into another session, is never written to disk, and does not survive quitting.

## What happens to the session left behind

It keeps running. A turn in flight finishes. A pending approval stays pending.
Its transcript is intact for a later switch back. Its daemon keeps its port.
Nothing about a switch stops a session; only Ctrl-D "end the session",
`/exit` with the same choice, `joule --stop` and `/stop-daemon` do that.

## Commands whose meaning depends on the current session

After a switch, each of these acts on the target, because the target is now the
current session.

| Command | Acts on |
| --- | --- |
| Ctrl-D and its prompt: keep in background, end the session, stay | the current session |
| `/exit` | the current session |
| `/rename <name>` | the current session |
| `/stop-daemon` | the current session's daemon |
| `/share` | the current session |
| `/model`, `/mode` | the current session |

## Startup flags

| Flag | Effect on switching |
| --- | --- |
| `--session <name>` | chooses the session the terminal starts in; a later `/session` overrides which one is current |
| `--continue` | applies only to the session named at startup, never to one switched into afterwards |
| `--stop` | unchanged; it is not an interactive path |

## Out of scope for this contract

- Switching to a session on another workspace. `/session` remains scoped to the
  workspace the terminal was started in.
- Switching to a session reached over the relay. Sessions here are local.
- A notice on the current screen when a background session wants attention.
  Allowed by the spec, not delivered by this feature.
