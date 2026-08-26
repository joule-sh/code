# Selection and copy

The terminal does its own mouse selection rather than leaving it to the
terminal emulator, so the wheel and drag-to-select both work at once rather
than trading against each other.

## Selecting

The wheel scrolls the transcript, PageUp/PageDown scroll it too, and dragging
over the transcript selects the rows the drag covers - drawn in reverse video,
with the status line saying how many lines are held.

The wheel keeps scrolling while a drag is in progress: the selection stays on
the text it was drawn over rather than on the screen rows.

Escape clears the selection, typing puts the status line back, and the next
click starts a new one. A click that does not move copies nothing, the way it
behaves in an editor.

Sign-in codes are never selectable: the row map covers transcript rows only,
and no selection can start, extend or copy while the input line is capturing.

Copying from a collapsed tool-output group only copies what is visible; the
rows hidden by the collapse are not part of the selection.

## Copying

Releasing copies. joule is a local process, so it writes the clipboard itself
rather than asking your terminal to: `pbcopy` on macOS, `wl-copy` on Wayland,
`xclip` or `xsel` on X11, `clip.exe` on Windows. That works on every terminal,
including the ones that refuse OSC 52 clipboard writes by default and the ones
that never implemented it.

Over ssh the local clipboard is the wrong one - the one you paste into is at
your end of the connection - so a remote session falls back to OSC 52
(`ESC ] 52 ; c ; <base64> BEL`), which travels back over the terminal. So does
a machine with no clipboard command installed. A terminal that refuses OSC 52
sends no reply, so there is nothing to detect and nothing to retry.

The status line says only what it can stand behind:

| what happened | status line |
| --- | --- |
| the clipboard command ran | `copied 3 lines - Esc clears` |
| OSC 52 was sent, and may have been ignored | `asked the terminal for 3 lines - /mouse off if nothing pasted` |
| the clipboard command was there and failed | `no clipboard here - Esc clears - /mouse off to select with the terminal` |

## `/mouse`

`/mouse` on its own names which of the three routes this machine will use.

`/mouse off` hands selection back to your terminal's own, for anyone who
prefers it or whose machine can reach no clipboard at all; the button events
are then ignored outright. It writes `"mouse": "off"` into
`~/.config/joule-code/config.json`, `/mouse on` puts it back, and
`JOULE_CODE_MOUSE` overrides the file for a single run.
