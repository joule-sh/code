"""Six short vertical scenes that explain how Joule Code works.

Rendered with Manim Community Edition. Every scene is a self-contained
9:16 short (1080x1920) of twenty to forty seconds, and the six run in
order as one explainer. What each scene says is taken from docs/00-plan.md,
docs/03-daemon.md, docs/08-daemon-frame-protocol.md and docs/09-pipeline.md;
where this file and those disagree, they are right.

    manim -qh joule_shorts.py TheOneInvariant
    manim -qh joule_shorts.py            # every scene, pick from the list
    JOULE_SHORTS_PREVIEW=1 manim -ql joule_shorts.py TurnLoop

No LaTeX is used, so a plain `pip install manim` plus ffmpeg is enough.
"""

import os

from manim import (
    BOLD,
    DOWN,
    LEFT,
    ORIGIN,
    RIGHT,
    UP,
    TAU,
    Arrow,
    Circle,
    Circumscribe,
    Create,
    Cross,
    CurvedArrow,
    DashedLine,
    Dot,
    DoubleArrow,
    FadeIn,
    FadeOut,
    Flash,
    GrowArrow,
    Indicate,
    LaggedStart,
    Line,
    MarkupText,
    MoveAlongPath,
    Rectangle,
    ReplacementTransform,
    Rotate,
    RoundedRectangle,
    Scene,
    SurroundingRectangle,
    Text,
    Transform,
    VGroup,
    Write,
    config,
    smooth,
)

# ---------------------------------------------------------------- format --

PREVIEW = os.environ.get("JOULE_SHORTS_PREVIEW", "") != ""
config.pixel_width = 540 if PREVIEW else 1080
config.pixel_height = 960 if PREVIEW else 1920
config.frame_width = 9.0
config.frame_height = 16.0
config.background_color = "#0E0D13"

# The console's palette: QUANTA_COLOR is the brand dot in console/src/brand.ts.
INK = "#ECEAF4"
MUTED = "#8A879A"
QUANTA = "#7C3AED"
PANEL = "#1A1826"
GOOD = "#34D399"
WARN = "#F59E0B"
BAD = "#F87171"
SKY = "#60A5FA"

SANS = "DejaVu Sans"
MONO = "DejaVu Sans Mono"


# --------------------------------------------------------------- helpers --

def sans(s, size=34, color=INK, weight="NORMAL"):
    return Text(s, font=SANS, font_size=size, color=color, weight=weight, line_spacing=0.9)


def mono(s, size=26, color=INK):
    return Text(s, font=MONO, font_size=size, color=color, line_spacing=0.9)


def chip(s, color=QUANTA, size=24, pad=0.18):
    """A small rounded label: a frame name, a mode, a tool call."""
    t = mono(s, size, color)
    box = RoundedRectangle(
        corner_radius=0.16,
        width=t.width + 2 * pad + 0.1,
        height=t.height + 2 * pad,
        stroke_color=color,
        stroke_width=2.5,
        fill_color=PANEL,
        fill_opacity=1,
    )
    t.move_to(box)
    g = VGroup(box, t)
    g.box = box
    g.label = t
    return g


def card(title, lines=(), width=7.6, color=QUANTA, title_size=38, body_size=27):
    """A panel with a bold title and a few muted lines under it."""
    t = sans(title, title_size, weight=BOLD)
    parts = [t]
    if lines:
        body = VGroup(*[sans(line, body_size, MUTED) for line in lines])
        body.arrange(DOWN, aligned_edge=LEFT, buff=0.16)
        parts.append(body)
    content = VGroup(*parts).arrange(DOWN, aligned_edge=LEFT, buff=0.28)
    box = RoundedRectangle(
        corner_radius=0.3,
        width=width,
        height=content.height + 0.8,
        stroke_color=color,
        stroke_width=4,
        fill_color=PANEL,
        fill_opacity=1,
    )
    content.move_to(box).align_to(box, LEFT).shift(RIGHT * 0.45)
    g = VGroup(box, content)
    g.box = box
    g.content = content
    return g


class Short(Scene):
    """A vertical short: a kicker and title up top, one caption at a time down low."""

    index = 1
    total = 6

    def setup(self):
        self._caption = None

    def header(self, title):
        kicker = mono(f"JOULE CODE  ·  {self.index}/{self.total}", 24, QUANTA)
        t = sans(title, 54, weight=BOLD)
        if t.width > 8.4:
            t.scale_to_fit_width(8.4)
        g = VGroup(kicker, t).arrange(DOWN, buff=0.28).to_edge(UP, buff=0.9)
        self.play(FadeIn(kicker, shift=DOWN * 0.2), Write(t), run_time=1.2)
        self._header = g
        return g

    def say(self, markup, wait=2.4, size=32):
        """Replace the caption. Pango markup, so <b> and <span> work."""
        new = MarkupText(markup, font=SANS, font_size=size, color=INK, line_spacing=0.9)
        if new.width > 8.2:
            new.scale_to_fit_width(8.2)
        new.to_edge(DOWN, buff=1.0)
        if self._caption is None:
            self.play(FadeIn(new, shift=UP * 0.2), run_time=0.6)
        else:
            self.play(
                FadeOut(self._caption, shift=UP * 0.15),
                FadeIn(new, shift=UP * 0.15),
                run_time=0.6,
            )
        self._caption = new
        self.wait(wait)

    def travel(self, start, end, color=QUANTA, run_time=0.8, radius=0.09):
        """A frame travelling along a wire: a dot that appears, moves, vanishes."""
        d = Dot(start, radius=radius, color=color)
        self.add(d)
        self.play(MoveAlongPath(d, Line(start, end)), run_time=run_time, rate_func=smooth)
        self.remove(d)


def accent(text, color=QUANTA):
    return f'<span foreground="{color}"><b>{text}</b></span>'


# ------------------------------------------------------------- 1 / 6 ------

class TheOneInvariant(Short):
    """The terminal is authoritative; the relay is a pipe with a short memory."""

    index = 1

    def construct(self):
        self.header("The terminal is authoritative")

        machine = card(
            "your machine",
            ["joule: the turn loop", "the workspace and the history", "every tool runs here"],
            color=GOOD,
        )
        relay = card(
            "joule.sh: the relay",
            ["pairs a browser to a terminal", "forwards frames both ways", "a short replay ring, nothing durable"],
            color=QUANTA,
        )
        browser = card(
            "browser",
            ["reads the transcript", "types, approves, cancels", "runs nothing"],
            color=SKY,
        )
        stack = VGroup(machine, relay, browser).arrange(DOWN, buff=1.05).shift(DOWN * 0.2)

        wire1 = DoubleArrow(machine.get_bottom(), relay.get_top(), buff=0.08, stroke_width=4, color=MUTED, tip_length=0.22)
        wire2 = DoubleArrow(relay.get_bottom(), browser.get_top(), buff=0.08, stroke_width=4, color=MUTED, tip_length=0.22)
        lab1 = mono("frames", 22, MUTED).next_to(wire1, RIGHT, buff=0.2)
        lab2 = mono("frames", 22, MUTED).next_to(wire2, RIGHT, buff=0.2)

        self.play(FadeIn(machine, shift=UP * 0.3))
        self.say("Run <b>joule</b> in a repo.\nIt reads, edits and runs commands there,\non your machine.")

        self.play(FadeIn(relay, shift=UP * 0.3), GrowArrow(wire1), FadeIn(lab1))
        self.play(FadeIn(browser, shift=UP * 0.3), GrowArrow(wire2), FadeIn(lab2))
        self.say("<b>/share</b> pairs a browser to that session\nthrough the relay at joule.sh.")

        top, mid, bot = machine.get_bottom(), relay.get_center(), browser.get_top()
        for _ in range(2):
            self.travel(top, bot, QUANTA, 0.7)
            self.travel(bot, top, SKY, 0.7)
        self.say(
            "The relay pairs, forwards, and keeps a\nbounded replay so a late browser sees\nthe transcript. "
            + accent("It never runs a tool."),
            wait=2.8,
        )

        cross = Cross(relay, stroke_color=BAD, stroke_width=8)
        self.play(
            Create(cross),
            relay.animate.set_opacity(0.25),
            browser.animate.set_opacity(0.25),
            wire1.animate.set_opacity(0.25),
            wire2.animate.set_opacity(0.25),
            lab1.animate.set_opacity(0.25),
            lab2.animate.set_opacity(0.25),
            run_time=1.0,
        )
        self.play(Circumscribe(machine, color=GOOD, buff=0.15, stroke_width=6), run_time=1.2)
        self.say(
            "If the relay dies, the terminal keeps working.\n"
            + accent("You lose the web view, not the work.", GOOD),
            wait=3.0,
        )


# ------------------------------------------------------------- 2 / 6 ------

class TurnLoop(Short):
    """Session.submit(): model, tool.call, gate, tool.result, at most eight steps."""

    index = 2

    def construct(self):
        self.header("One turn is a loop")

        prompt = chip("> add a /health endpoint and a test", INK, 24, 0.22)
        prompt.next_to(self._header, DOWN, buff=0.7)
        self.play(FadeIn(prompt, shift=DOWN * 0.2))

        centre = ORIGIN + DOWN * 0.6
        r = 2.55
        pts = {
            "model": centre + UP * r,
            "call": centre + RIGHT * r,
            "gate": centre + DOWN * r,
            "result": centre + LEFT * r,
        }
        nodes = {
            "model": card("model", ["provider.ask, streamed"], width=3.1, color=QUANTA, title_size=30, body_size=20),
            "call": card("tool.call", ["what it wants done"], width=3.1, color=SKY, title_size=30, body_size=20),
            "gate": card("gate → tool", ["may it? then do it"], width=3.1, color=WARN, title_size=30, body_size=20),
            "result": card("tool.result", ["back into history"], width=3.1, color=GOOD, title_size=30, body_size=20),
        }
        for k, n in nodes.items():
            n.move_to(pts[k])

        order = ["model", "call", "gate", "result"]
        arcs = VGroup()
        for i, k in enumerate(order):
            a, b = nodes[k], nodes[order[(i + 1) % 4]]
            arcs.add(CurvedArrow(a.get_center(), b.get_center(), angle=-TAU / 4, color=MUTED, stroke_width=3, tip_length=0.2))
        for k in order:
            arcs.set_z_index(-1)

        counter = mono("step 0 / 8", 26, MUTED).next_to(prompt, DOWN, buff=0.35)
        self.play(LaggedStart(*[FadeIn(nodes[k], scale=0.9) for k in order], lag_ratio=0.2), run_time=1.2)
        self.play(Create(arcs), FadeIn(counter), run_time=1.0)
        self.say("A prompt opens a turn. The model answers\nwith text, or with tool calls.")

        def lap(step, call_text, result_text, gate_note, gate_color):
            new_counter = mono(f"step {step} / 8", 26, INK).move_to(counter)
            self.play(Transform(counter, new_counter), run_time=0.3)
            self.travel(pts["model"], pts["call"], QUANTA, 0.6)
            c = chip(call_text, SKY, 22).next_to(nodes["call"], DOWN, buff=0.2)
            if c.get_right()[0] > 4.3:
                c.shift(LEFT * (c.get_right()[0] - 4.3))
            self.play(FadeIn(c, shift=DOWN * 0.15), run_time=0.4)
            self.travel(pts["call"], pts["gate"], SKY, 0.6)
            g = chip(gate_note, gate_color, 22).next_to(nodes["gate"], DOWN, buff=0.2)
            self.play(FadeIn(g, shift=DOWN * 0.15), run_time=0.4)
            self.wait(0.4)
            self.travel(pts["gate"], pts["result"], gate_color, 0.6)
            rr = chip(result_text, GOOD, 22).next_to(nodes["result"], UP, buff=0.2)
            if rr.get_left()[0] < -4.3:
                rr.shift(RIGHT * (-4.3 - rr.get_left()[0]))
            self.play(FadeIn(rr, shift=UP * 0.15), run_time=0.4)
            self.travel(pts["result"], pts["model"], GOOD, 0.6)
            self.play(FadeOut(c), FadeOut(g), FadeOut(rr), run_time=0.3)

        lap(1, "read src/router.ts", "142 lines", "reads never ask", GOOD)
        self.say("Reads, lists and greps never wait\non a person. Only the workspace jail\napplies to them.")
        lap(2, "edit src/router.ts", "1 replacement", "mode: auto-edit", GOOD)
        lap(3, "run npm test", "exit 0", "asks a person", WARN)
        self.say("Every call and its full result stream\nto the terminal as it happens.\nThe reply comes after.")

        reply = chip("Added /health with a test. Tests pass.", INK, 22, 0.22)
        reply.next_to(nodes["model"], DOWN, buff=0.25)
        end = chip('turn.end  reason="done"', QUANTA, 22).next_to(counter, DOWN, buff=0.3)
        self.play(FadeIn(reply, shift=DOWN * 0.15))
        self.play(FadeIn(end, shift=DOWN * 0.15))
        self.say(
            "A reply with no tool calls ends the turn.\nSo does the "
            + accent("eighth step", WARN)
            + ": the loop cannot run away.",
            wait=3.0,
        )


# ------------------------------------------------------------- 3 / 6 ------

class ApprovalGate(Short):
    """Five modes, one gate, three answers."""

    index = 3

    def construct(self):
        self.header("Every tool call passes a gate")

        modes = ["read-only", "auto-edit", "safe-auto", "full-auto", "plan"]
        chips = VGroup(*[chip(m, MUTED, 22) for m in modes])
        row1 = VGroup(*chips[:3]).arrange(RIGHT, buff=0.2)
        row2 = VGroup(*chips[3:]).arrange(RIGHT, buff=0.2)
        rows = VGroup(row1, row2).arrange(DOWN, buff=0.2).next_to(self._header, DOWN, buff=0.6)
        self.play(LaggedStart(*[FadeIn(c, scale=0.9) for c in chips], lag_ratio=0.1))

        def pick(i):
            anims = []
            for j, c in enumerate(chips):
                col = QUANTA if j == i else MUTED
                anims.append(c.box.animate.set_stroke(col))
                anims.append(c.label.animate.set_color(col))
            self.play(*anims, run_time=0.4)

        # The gate: two posts and a bar hinged on the left post.
        gate_y = -0.3
        post_l = Rectangle(width=0.22, height=1.1, fill_color=MUTED, fill_opacity=1, stroke_width=0).move_to([-2.2, gate_y, 0])
        post_r = Rectangle(width=0.22, height=1.1, fill_color=MUTED, fill_opacity=1, stroke_width=0).move_to([2.2, gate_y, 0])
        bar = Rectangle(width=4.2, height=0.16, fill_color=WARN, fill_opacity=1, stroke_width=0).move_to([0, gate_y + 0.35, 0])
        hinge = post_l.get_top() + DOWN * 0.2
        gate_label = mono("Gate.check()", 20, MUTED).next_to(post_r, RIGHT, buff=0.15)
        workspace = card("workspace", ["jail(): every path clamped to the root"], width=7.6, color=GOOD, title_size=30, body_size=22)
        workspace.to_edge(DOWN, buff=2.6)
        self.play(FadeIn(post_l), FadeIn(post_r), FadeIn(bar), FadeIn(gate_label), FadeIn(workspace, shift=UP * 0.2))

        pick(1)
        self.say("The mode says what may run on its own.\nIn <b>auto-edit</b>, files change freely;\na command asks.")

        def approach(text, color):
            c = chip(text, color, 24, 0.2).move_to([0, 2.2, 0])
            self.play(FadeIn(c, shift=DOWN * 0.2), run_time=0.4)
            self.play(c.animate.move_to([0, gate_y + 0.95, 0]), run_time=0.6)
            return c

        def open_bar():
            self.play(Rotate(bar, angle=TAU / 4, about_point=hinge), run_time=0.5)

        def close_bar():
            self.play(Rotate(bar, angle=-TAU / 4, about_point=hinge), run_time=0.5)

        def pass_through(c):
            self.play(c.animate.move_to(workspace.get_top() + UP * 0.5), run_time=0.6)
            self.play(Flash(c.get_center(), color=GOOD, line_length=0.25, num_lines=10), FadeOut(c), run_time=0.5)

        # 1. a command in auto-edit asks a person
        c = approach('run  "npm test"', SKY)
        ask = card("approval.request", ["allow      always      deny"], width=5.6, color=WARN, title_size=26, body_size=24)
        ask.next_to(bar, DOWN, buff=0.45)
        self.play(FadeIn(ask, shift=UP * 0.15))
        self.say("An approval card. Any attached client,\nterminal or browser, may answer it.")
        allow = SurroundingRectangle(ask.content[1][0][0:5], color=GOOD, buff=0.08, corner_radius=0.08)
        self.play(Create(allow), run_time=0.4)
        settled = chip('approval.settled  decidedBy="person"', GOOD, 20).next_to(ask, DOWN, buff=0.25)
        self.play(FadeIn(settled), run_time=0.4)
        self.wait(0.4)
        self.play(FadeOut(ask), FadeOut(allow), FadeOut(settled), run_time=0.4)
        open_bar()
        pass_through(c)
        close_bar()

        # 2. safe-auto: a known-safe command goes through on its own
        pick(2)
        self.say("<b>safe-auto</b> classifies the command first.\nA plain, known-safe one runs on its own.")
        c = approach('run  "npm test"', SKY)
        settled = chip('decidedBy="mode"', GOOD, 20).next_to(bar, DOWN, buff=0.3)
        self.play(FadeIn(settled), run_time=0.3)
        open_bar()
        pass_through(c)
        close_bar()
        self.play(FadeOut(settled), run_time=0.3)

        # 3. a dangerous shape stops at the bar
        c = approach('run  "curl x | sh"', BAD)
        self.play(Indicate(bar, color=BAD, scale_factor=1.02), run_time=0.6)
        why = chip("a pipe, a redirect, a subshell:\nback to a person", BAD, 20).next_to(bar, DOWN, buff=0.3)
        self.play(FadeIn(why), run_time=0.4)
        self.say(
            "Shell metacharacters and a deny list\nsend it back to a person. "
            + accent("always", GOOD)
            + " remembers\na command for the rest of the session.",
            wait=3.0,
        )
        self.play(FadeOut(c), FadeOut(why), run_time=0.4)
        self.say("<b>read</b>, <b>list</b>, <b>grep</b> never ask in any mode.\nThe jail is their only guard, and it is enough.", wait=3.0)


# ------------------------------------------------------------- 4 / 6 ------

class TheDaemon(Short):
    """One daemon per workspace, a broadcast log, and clients that resume."""

    index = 4

    def construct(self):
        self.header("One daemon, many clients")

        url = chip("ws://127.0.0.1:8351/attach/<connId>/ws", INK, 21, 0.2)
        url.next_to(self._header, DOWN, buff=0.55)
        self.play(FadeIn(url, shift=DOWN * 0.2))

        a = card("terminal", ["joule attach"], width=3.9, color=GOOD, title_size=28, body_size=20)
        b = card("console", ["the browser (#348)"], width=3.9, color=SKY, title_size=28, body_size=20)
        clients = VGroup(a, b).arrange(RIGHT, buff=0.4).next_to(url, DOWN, buff=1.2)

        daemon = card(
            "joule-daemon",
            ["one per (workspace, session)", "owns Session, Gate, tools, tasks", "binds 127.0.0.1 only"],
            width=7.6,
            color=QUANTA,
            title_size=32,
            body_size=22,
        )
        daemon.next_to(clients, DOWN, buff=1.4)

        log_title = mono("broadcast.log", 22, MUTED).next_to(daemon, DOWN, buff=0.45)
        self.play(FadeIn(daemon, shift=UP * 0.2), FadeIn(log_title))

        wire_a = Line(a.get_bottom(), daemon.get_top() + LEFT * 1.6, color=GOOD, stroke_width=3)
        wire_b = Line(b.get_bottom(), daemon.get_top() + RIGHT * 1.6, color=SKY, stroke_width=3)

        log_rows = VGroup()
        seq = [11]

        def emit(kind, to_a=True, to_b=True):
            row = mono(f"seq {seq[0]:>2}  {kind}", 20, INK)
            if len(log_rows) == 0:
                row.next_to(log_title, DOWN, buff=0.2)
            else:
                row.next_to(log_rows[-1], DOWN, buff=0.1)
            row.align_to(daemon, LEFT).shift(RIGHT * 0.45)
            log_rows.add(row)
            seq[0] += 1
            self.play(FadeIn(row, shift=UP * 0.1), run_time=0.25)
            dots = []
            if to_a:
                dots.append(Dot(wire_a.get_end(), radius=0.09, color=GOOD))
            if to_b:
                dots.append(Dot(wire_b.get_end(), radius=0.09, color=SKY))
            anims = []
            for d in dots:
                self.add(d)
                target = wire_a if d.get_color().to_hex().upper() == GOOD.upper() else wire_b
                anims.append(MoveAlongPath(d, Line(target.get_end(), target.get_start())))
            if anims:
                self.play(*anims, run_time=0.5)
            for d in dots:
                self.remove(d)
            if len(log_rows) > 5:
                old = log_rows[0]
                log_rows.remove(old)
                self.play(FadeOut(old), log_rows.animate.shift(UP * (old.height + 0.1)), run_time=0.25)

        # client A attaches
        self.play(FadeIn(a, shift=DOWN * 0.2), Create(wire_a))
        resume_a = chip('resume  since=-1', GOOD, 20).move_to(wire_a.get_start())
        self.play(resume_a.animate.move_to(wire_a.get_end() + UP * 0.35), run_time=0.6)
        self.play(FadeOut(resume_a), run_time=0.2)
        self.say("A client opens the socket and sends\n<b>resume</b> at once. Nothing is pushed until it does.")
        emit("session.hello", to_a=True, to_b=False)
        emit("turn.start", to_a=True, to_b=False)

        # client B attaches: both see every frame
        self.play(FadeIn(b, shift=DOWN * 0.2), Create(wire_b))
        resume_b = chip('resume  since=-1', SKY, 20).move_to(wire_b.get_start())
        self.play(resume_b.animate.move_to(wire_b.get_end() + UP * 0.35), run_time=0.6)
        self.play(FadeOut(resume_b), run_time=0.2)
        emit("text.delta")
        emit("tool.call")
        self.say("Every frame the session emits goes to\n<b>every</b> attached client. Any of them can\ntype, approve, or change the mode.")

        # B drops and comes back with a watermark
        dashed = DashedLine(wire_b.get_start(), wire_b.get_end(), color=SKY, stroke_width=3)
        self.play(ReplacementTransform(wire_b, dashed), b.animate.set_opacity(0.3), run_time=0.5)
        wire_b = dashed
        emit("approval.request", to_a=True, to_b=False)
        emit("tool.result", to_a=True, to_b=False)
        solid = Line(dashed.get_start(), dashed.get_end(), color=SKY, stroke_width=3)
        self.play(ReplacementTransform(dashed, solid), b.animate.set_opacity(1), run_time=0.5)
        wire_b = solid
        resume_b = chip(f"resume  since={seq[0] - 3}", SKY, 20).move_to(wire_b.get_start())
        self.play(resume_b.animate.move_to(wire_b.get_end() + UP * 0.35), run_time=0.6)
        self.play(FadeOut(resume_b), run_time=0.2)
        for _ in range(2):
            d = Dot(wire_b.get_end(), radius=0.09, color=SKY)
            self.add(d)
            self.play(MoveAlongPath(d, Line(wire_b.get_end(), wire_b.get_start())), run_time=0.4)
            self.remove(d)
        self.say("A dropped client resumes from the last\n<b>seq</b> it saw and gets only what it missed,\nreplayed from the broadcast log.", wait=3.0)
        self.say(
            "Inbound frames land in <b>inbox/&lt;connId&gt;.in</b>,\noutbound in <b>broadcast.log</b>. Files cross\nthe thread boundary; shared objects never do.",
            wait=3.2,
        )


# ------------------------------------------------------------- 5 / 6 ------

class TheFrames(Short):
    """The vocabulary the terminal, daemon, relay and browser share."""

    index = 5

    def construct(self):
        self.header("Everything is a frame")

        example = chip('{"v":1,"seq":0,"type":"resume","since":-1}', INK, 20, 0.22)
        example.next_to(self._header, DOWN, buff=0.6)
        self.play(FadeIn(example, shift=DOWN * 0.2))
        self.say("One JSON object per websocket message.\nA version, a sequence number, a type.")

        down = [
            "session.hello", "turn.start", "text.delta", "tool.call", "approval.request",
            "approval.settled", "tool.result", "notice", "error", "turn.end",
        ]
        up = ["resume", "input", "approval.reply", "cancel", "mode.set", "model.set", "share.request", "daemon.stop"]

        def column(title, names, color, arrow):
            head = sans(title, 30, color, weight=BOLD)
            items = VGroup(*[mono(f"{arrow} {n}", 25, INK) for n in names])
            items.arrange(DOWN, aligned_edge=LEFT, buff=0.2)
            g = VGroup(head, items).arrange(DOWN, aligned_edge=LEFT, buff=0.3)
            return g

        left = column("session → client", down, QUANTA, "↓")
        right = column("client → session", up, SKY, "↑")
        cols = VGroup(left, right).arrange(RIGHT, buff=0.7, aligned_edge=UP)
        cols.next_to(example, DOWN, buff=0.8)
        if cols.width > 8.4:
            cols.scale_to_fit_width(8.4)

        self.play(FadeIn(left[0]), LaggedStart(*[FadeIn(m, shift=RIGHT * 0.15) for m in left[1]], lag_ratio=0.12), run_time=1.6)
        self.say("What the session says: a turn opening,\ntext as it streams, a tool it wants,\nan approval it needs, the end of the turn.")
        self.play(FadeIn(right[0]), LaggedStart(*[FadeIn(m, shift=LEFT * 0.15) for m in right[1]], lag_ratio=0.12), run_time=1.6)
        self.say("What a client says: a prompt, an answer\nto an approval, a cancel, a mode.")

        hi = SurroundingRectangle(VGroup(left[1][4], left[1][5]), color=WARN, buff=0.1, corner_radius=0.1)
        hi2 = SurroundingRectangle(right[1][2], color=WARN, buff=0.1, corner_radius=0.1)
        self.play(Create(hi), Create(hi2), run_time=0.6)
        self.say(
            "A request goes out, one client replies,\nand <b>approval.settled</b> tells every other\nclient who decided: a person, or the mode.",
            wait=3.0,
        )
        self.play(FadeOut(hi), FadeOut(hi2), run_time=0.3)
        self.say("The terminal, the relay, the browser and the\nconsole engine all speak only this. Nothing\nin it is private to <b>joule</b> itself.", wait=3.0)


# ------------------------------------------------------------- 6 / 6 ------

class Pipelines(Short):
    """spawn_agent, and run_pipeline: stages the daemon advances."""

    index = 6

    def construct(self):
        self.header("Subagents, then pipelines")

        sub = card(
            "spawn_agent",
            ["its own turn loop, the same tools", "one level deep: it cannot spawn", "steps 1..40, report: a JSON shape"],
            width=7.6,
            color=SKY,
            title_size=30,
            body_size=22,
        )
        sub.next_to(self._header, DOWN, buff=0.6)
        self.play(FadeIn(sub, shift=UP * 0.2))
        self.say("A subagent works a scoped problem while\nthe session goes on. With <b>report</b> set,\nits last reply is one JSON object.")

        plan = chip("run_pipeline  {stages: [survey, verify]}", INK, 20, 0.2)
        plan.next_to(sub, DOWN, buff=0.7)
        self.play(FadeIn(plan, shift=UP * 0.2))

        def stage(name, tasks, color):
            title = mono(name, 22, color)
            ts = VGroup(*[chip(t, color, 20) for t in tasks]).arrange(RIGHT, buff=0.25)
            g = VGroup(title, ts).arrange(DOWN, buff=0.2)
            frame = SurroundingRectangle(g, color=color, buff=0.22, corner_radius=0.2, stroke_width=2)
            frame.set_fill(PANEL, opacity=1).set_z_index(-1)
            return VGroup(frame, title, ts)

        s1 = stage("stage 1: survey", ["list every test file"], QUANTA)
        s2 = stage("stage 2: verify", ["check A vs {{prior}}", "check B vs {{prior}}"], WARN)
        stages = VGroup(s1, s2).arrange(DOWN, buff=1.0).next_to(plan, DOWN, buff=0.7)
        if stages.width > 8.4:
            stages.scale_to_fit_width(8.4)

        arrow = Arrow(s1.get_bottom(), s2.get_top(), buff=0.1, color=MUTED, stroke_width=3, tip_length=0.2)
        prior = mono("{{prior}} = stage 1's reports", 20, MUTED).next_to(arrow, RIGHT, buff=0.2)
        if prior.get_right()[0] > 4.4:
            prior.shift(LEFT * (prior.get_right()[0] - 4.4))

        tick = mono("daemon poll: tick", 20, MUTED).next_to(stages, DOWN, buff=1.0)

        self.play(FadeIn(s1, shift=UP * 0.2))
        self.play(FadeIn(tick))
        self.play(Circumscribe(s1[2][0], color=GOOD, buff=0.08), run_time=0.8)
        done1 = chip("done", GOOD, 18).next_to(s1[2][0], RIGHT, buff=0.2)
        self.play(FadeIn(done1), run_time=0.3)
        self.say("Stages run in order. When a stage's tasks\nhave all reported, the daemon's own poll\nstarts the next one. No model decides that.")

        self.play(GrowArrow(arrow), FadeIn(prior), FadeIn(s2, shift=UP * 0.2))
        self.play(Circumscribe(s2[2][0], color=GOOD, buff=0.08), Circumscribe(s2[2][1], color=GOOD, buff=0.08), run_time=0.8)
        v1 = chip('{"verdict":"pass"}', GOOD, 18).next_to(s2[2][0], DOWN, buff=0.15)
        v2 = chip('{"verdict":"fail"}', BAD, 18).next_to(s2[2][1], DOWN, buff=0.15)
        self.play(FadeIn(v1), FadeIn(v2), run_time=0.4)
        self.say("Tasks inside a stage run in parallel,\neach handed the previous stage's reports.\nA shaped report is what a later stage routes on.")

        note = card("one note lands in the conversation", ["survey: 14 files · verify: A pass, B fail"], width=7.6, color=GOOD, title_size=22, body_size=19)
        note.next_to(VGroup(v1, v2), DOWN, buff=0.4)
        self.play(FadeOut(tick), FadeIn(note, shift=UP * 0.2))
        self.say(
            "Caps keep the graph as deep as the plan:\n≤5 stages, ≤5 tasks each, ≤10 in all, one at a time.",
            wait=3.4,
        )
