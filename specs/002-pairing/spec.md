# Spec 002: how a browser earns the right to drive a terminal

## What is true today

The terminal runs on a laptop behind NAT. The browser is somewhere else. Nothing
can dial in, so the terminal dials out and the relay introduces the two.

The thing being handed over is not a document. It is a process that edits files
and runs commands on a machine someone is logged into. Getting this wrong is not
a leaked transcript; it is a shell.

## What other systems decided

**Device authorisation (RFC 8628)** — the flow a TV uses when you type a code
into a phone — is the closest published answer, and its shape is the one to
take: a short user code that a human moves between two devices, a longer device
code that never appears on screen, and an expiry short enough that a code seen
over a shoulder is worthless by the time it is used.

Its central decision is the one worth stating outright: **the short code is not
the credential.** It is a pointer that lets an *already authenticated* user
attach their identity to a pending session. The authorisation comes from the
login, never from the code. Systems that skipped that step — anything where
knowing a room name is enough to join the room — have all been embarrassed by
someone guessing a room name.

**ngrok and friends** are the cautionary case. A tunnel with an unguessable URL
treats the URL as the secret, so it leaks through a Referer header, a proxy log,
a screen share. Unguessable is not the same as unauthorised.

**Tailscale's node authorisation** contributes the last piece: the machine
approves the pairing too. The person at the browser and the person at the
terminal are both asked, so neither side can be attached to unilaterally.

## What this adds

1. Terminal: `POST /sessions {workspace, model}` → `{sessionId, secret, code,
   expiresAt}`. The session is created **unowned**. The terminal authenticates
   everything afterwards with `secret`, which never appears on screen.
2. Terminal prints the code and the URL, and opens its SSE downstream.
3. Browser — already logged in to joule.sh, so the console proxy has attached
   `x-user` — `POST /pair {code}` → the relay binds the session to that uuid.
4. Afterwards the relay serves that session's frames only to requests carrying
   the same uuid, and accepts only the three inbound frames of
   [spec 001](../001-frames/spec.md).

Auth is the console's job. It already turns a cookie into a user (`readSession`)
and mints the `x-user` document the agents engine consumes (`xUserDocument`).
The relay sits behind that proxy and trusts the header, exactly as the engine
does — no cookie parsing, no user table, no second auth implementation to keep
correct.

## The rules

1. **The code is a pointer, not a credential.** Redeeming it requires a joule.sh
   login. A code alone authorises nothing, so a code read over a shoulder or
   left in scrollback is not a shell.
2. **Single use, ten-minute expiry, constant-time comparison.** Six characters
   from an unambiguous alphabet — a code a person retypes from a screen has to
   survive being read as `0` for `O`.
3. **Rate-limit redemption per uuid and per address, and count failures per
   session.** Six characters is small; the defence against guessing is that
   guessing is slow and the window is short, and both must be enforced.
4. **The relay trusts `x-user` only because the proxy sets it.** It binds to
   loopback or the tailnet, never a public interface. A directly reachable relay
   is a relay anyone can forge a user against, and that is the whole of the auth
   model gone.
5. **The terminal shows who attached, and can refuse.** Both ends consent. The
   terminal prints the account that paired and keeps a way to detach it.
6. **The relay stores nothing durable.** A bounded ring per session so a late or
   reconnecting browser catches up, evicted on idle. It never holds a checkout,
   never runs a tool, and losing it costs the web view and not the work.
7. **Eviction is reported, never silent.** A browser that resumes from a `seq`
   the ring no longer has is told it missed frames, rather than shown a
   transcript with a hole in it.

## Deliberately not in scope

**Multiple browsers on one session, and handing a session to a second account.**
One account, one session, for v0. Both are natural extensions and neither
changes the model above; they change who is in the set the relay compares
against, which is a set of one today.

**Session persistence across a terminal restart.** The session dies with the
process. Reattaching after a crash means a new code.

The consequence, recorded: because the relay keeps only a bounded ring and
nothing durable, a browser that is closed for longer than the ring is deep comes
back to a partial transcript. It is told so (rule 7). The fix, when it matters,
is a longer ring — not a database, because a database is a copy of the work on a
machine that is not the one doing the work.

## Update, #134: a terminal can associate a session with an account

Everything above still holds unchanged: the code is still a pointer, not a
credential; redeeming it still requires a joule.sh login; a paired
browser's authority is still capped at input/cancel/approval.reply; and
authorization to drive a session still comes entirely from pairing, never
from anything below. What this adds is a second, weaker fact - association
- so a signed-in user can see which of their own sessions are running
before they have paired to any of them.

**The knowing change:** rule 4 said the relay trusts `x-user` only
because a proxy sets it, and holds no account logic of its own. That is
still true for every existing endpoint. This adds one new outbound call the
relay makes on its own initiative: when a terminal presents a #97
credential's secret alongside `POST /sessions`, the relay calls the
console's own `POST /terminal/verify` to turn that secret into a
server-verified `accountId`/`accountEmail`, the same way the console
already turns a browser's cookie into the `x-user` it forwards. The relay
never trusts an accountId a client merely asserts - only what the console
hands back. This is a real, deliberate widening of what the relay depends
on (a live console it can reach), not a config change, and is exactly why
the spike that preceded this treated it as a decision to make explicit
rather than a detail to patch around.

**What it does not change:**

- **A terminal with no credential is unaffected.** `credentialSecret` is
  never sent at all when a terminal has not signed in (`/login`), the
  session is created exactly as before, and it appears in nobody's list.
  Association is additive; the unowned, paired-browser flow this spec
  already describes is untouched.
- **A verify failure degrades to unowned, it never blocks sharing.** A
  revoked or unreachable-console credential still lets `/share` succeed;
  it just does not get listed anywhere. The relay's job is to attribute a
  session when it safely can, never to gate sharing on account validity.
- **Listing is read-only and carries neither the code nor the secret.**
  `GET /sessions/mine`, gated by the same `x-user` trust as `/pair`,
  answers with workspace, model and paired-status only. A browser that can
  see a session it owns still has to be handed the code by the human at
  the terminal to do anything with it - exactly rule 1, unchanged. This is
  the alternative the earlier decision explicitly rejected: a signed-in
  browser cannot claim a session by being signed in, only by presenting the
  same code it always needed.
- **Association is not authorization.** Two accountIds never overlap in a
  listing, and nothing about being listed changes what `pairByCode`,
  `authorizeBrowser` or `isDownstreamAllowed` do. Rules 4 and 5 (the
  relay trusts the proxy, the terminal can refuse) still govern who may
  actually attach.

Verified in `make console-association-harness`
(`scripts/verify_console_association.mjs`): a real daemon holding a real
credential file, a real relay verifying it against a stub console, a
listing scoped correctly to one account and empty for another, a listing
that never carries the code, and the same POST /pair + browser websocket
path this spec always described still gating the actual drive.
