# Joule Code in six shorts

Six vertical Manim scenes, each twenty to thirty-five seconds, that together
explain how Joule Code works. They are drawn from the documents in this
directory's parent - `00-plan.md`, `03-daemon.md`, `08-daemon-frame-protocol.md`
and `09-pipeline.md` - and from `src/session/session.ts`, `src/approval/gate.ts`
and `src/protocol/frames.ts`. Where a scene and the code disagree, the code is
right and the scene needs a fix.

`joule_shorts.py` holds all six. Nothing in it needs LaTeX.

## What the shorts say

**1. The terminal is authoritative** (`TheOneInvariant`). `joule` runs in a
repo on your machine and holds the workspace, the history and the tool loop.
`/share` pairs a browser to it through the relay at joule.sh, which forwards
frames and keeps a bounded replay ring so a late browser sees the transcript.
The relay never runs a tool and stores nothing durable, so if it dies you lose
the web view, not the work.

**2. One turn is a loop** (`TurnLoop`). A prompt opens a turn. The model
answers with text or with tool calls; each call passes the gate, runs, and its
result goes back into the history for the next round. Reads never wait on a
person. A reply with no tool calls ends the turn, and so does the eighth step:
`MAX_STEPS` in `session.ts` is what keeps the loop from running away. Every
call and its full result stream to the terminal before the reply does.

**3. Every tool call passes a gate** (`ApprovalGate`). Five modes: `read-only`,
`auto-edit`, `safe-auto`, `full-auto`, `plan`. The mode says what may run on
its own; anything else raises an approval card that any attached client may
answer with allow, always or deny, and `approval.settled` tells the others who
decided. `safe-auto` classifies a command first: a plain, known-safe one runs,
while shell metacharacters or a deny-listed substring send it to a person.
`read`, `list` and `grep` never ask in any mode; `jail()` clamping every path
to the workspace root is their only guard.

**4. One daemon, many clients** (`TheDaemon`). `joule-daemon` serves one
`(workspace, session)` pair on `127.0.0.1` over a plain websocket at
`/attach/<connId>/ws`. A client sends `resume` the moment it connects, and
nothing is pushed until it does. Every frame goes to every attached client,
any of which may type, approve or change the mode. A dropped client resumes
from the last `seq` it saw and is replayed only what it missed from
`broadcast.log`. Inbound frames land in `inbox/<connId>.in`; files cross the
thread boundary, shared objects never do.

**5. Everything is a frame** (`TheFrames`). One JSON object per websocket
message, with a version, a sequence number and a type. Session to client:
`session.hello`, `turn.start`, `text.delta`, `tool.call`, `approval.request`,
`approval.settled`, `tool.result`, `notice`, `error`, `turn.end`. Client to
session: `resume`, `input`, `approval.reply`, `cancel`, `mode.set`,
`model.set`, `share.request`, `daemon.stop`. The terminal, the relay, the
browser and the console engine speak only this.

**6. Subagents, then pipelines** (`Pipelines`). `spawn_agent` runs a scoped
problem on its own turn loop with the same tools, one level deep, with a step
budget of 1 to 40 and an optional `report` shape its last reply must match.
`run_pipeline` declares stages; stages run in order, the tasks inside a stage
run in parallel, and `{{prior}}` hands a task the previous stage's reports.
The daemon's own poll advances the stages, so no model decides the hand-offs.
At most 5 stages, 5 tasks a stage, 10 in all, one pipeline at a time.

## Rendering

```sh
python3 -m venv .venv && .venv/bin/pip install manim   # needs ffmpeg and pango on the PATH
.venv/bin/manim -qm joule_shorts.py TheOneInvariant       # one short, 1080x1920 at 30fps
.venv/bin/manim -qm joule_shorts.py -a                    # all six
JOULE_SHORTS_PREVIEW=1 .venv/bin/manim -ql joule_shorts.py TurnLoop   # 540x960 at 15fps, for a quick look
```

The file sets the vertical frame itself, so the quality flag chooses only the
frame rate. Output lands under `media/videos/joule_shorts/`, which is ignored.

On Debian and Ubuntu, `manimpango` builds from source and needs
`pkg-config libpango1.0-dev libcairo2-dev`; the system `pip` may also fail to
build the `srt` dependency, which a fresh venv with a current `setuptools`
avoids.

## Editing

Every scene extends `Short`, which gives it the kicker and title at the top,
one caption at a time at the bottom (`say()`, Pango markup so `<b>` works),
and `travel()` for a frame moving along a wire. `card()` and `chip()` are the
two shapes everything is built from. The palette is the console's: `QUANTA`
is `QUANTA_COLOR` from `console/src/brand.ts`.

A caption is three lines at most; a fourth runs into whatever sits above it.
Anything anchored under the title anchors to `self._header`, not to
`self.mobjects[0]`, which is only the kicker.
