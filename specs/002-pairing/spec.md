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

## Update, #279: a share is made under an account, or not at all

The relay is unchanged by this. Everything the #134 update says about what
the relay does with a `credentialSecret` -- verify it, attribute the
session when it can, degrade to unowned when it cannot, never gate sharing
on account validity -- still holds exactly. `POST /sessions` with no
secret still creates an unowned session and answers 200.

What changes is the client, and one bullet above with it. That bullet said
a terminal with no credential is unaffected: it shares, and the session
appears in nobody's list. That was true and it was useless. The address a
share prints is now the console's own `/terminal/sessions` page, carrying
the code, because there is no `/w/` route on joule.sh or on any
self-hosted console and never was. That address comes from the server the
terminal signed in to, advertised at `/login` and stored beside the
per-server credential.

So with no credential there is no address to print, and the session that
would be created is one no console can list and no browser can be sent to.
The client refuses instead, where a person is looking and can act on it:

    not signed in to <server>
      a shared terminal is watched from that console, under your
      account, so sharing needs its credential. Run /login.

A relay run without any console in front of it still serves its own page
at `/` and still pairs unowned sessions by code. That path is a property
of the relay, and this is a client refusing to enter it blind rather than
the relay closing it.

Verified in `make console-association-harness`, which now spawns the
daemon with only what `posixDaemonSpawnCommand` actually hands one. The
previous harness passed `JOULE_CODE_SERVER` and the relay address in the
daemon's environment -- the four values the real spawn drops -- and so
asserted an association it had arranged. It now reads them off disk, the
way a signed-in machine does, and additionally asserts that the printed
address is the console page, that no joule.sh address survives a
self-hosted share, and that a daemon holding no credential says so and
puts nothing in the relay.

## Update, #279 follow-up: an unowned session is refused where it is asked for

The #134 update said a verify failure "degrades to unowned, it never blocks
sharing", and that is still exactly what the **relay** does. `POST /sessions`
with a secret the console will not vouch for still creates the session and
still answers 200. Nothing about the relay's permissiveness changes here.

What was missing is that it never said so. The create answer carried
`sessionId`, `secret`, `code` and `expiresAt` and nothing about whose session
it was, so a client that had offered a credential could not tell an owned
session from an unowned one. It printed a URL either way, and the console page
that URL points at listed nothing, because there was nothing of that account's
to list.

That is not hypothetical. A relay serving one console was handed a credential
minted by another; the console it asked answered 401, the session was created
owned by nobody, and the share looked like a success from the terminal. The
same shape follows from a revoked key or a console that is down.

So the create answer now carries two more fields:

    accountStatus  ""  no credential was offered
                   ok  the console vouched for it
             rejected  the console does not know it
          unreachable  the console could not be asked

    verifiedBy     the console the relay actually asked, empty when
                   no credential was offered

Naming the console is the point. The failure a person actually hits is a relay
pointed somewhere other than where they signed in, and no message that omits
that address can tell them so.

A client that offered a credential and did not get `ok` back refuses the share
and says which console was asked and what it said. A client that offered none
is unaffected, and neither is the relay's own page, which pairs unowned
sessions by code and always could. The relay decides nothing new; it just stops
being the only party that knows.

Verified in `make console-association-harness`: the create command the relay
records is asserted to carry the account id and email, rather than inferring it
from `/sessions/mine` being non-empty; and a second relay, wired to a console
that does not know the credential, is asserted to produce `share.failed`
naming that console, with nothing left in the relay. Both harnesses that share
a credential now run a console stub for the relay to ask, because one that has
no console to ask attributes nothing.

## Update, #296: the account a session was made under is admitted without a code

Rule 1 said the code is a pointer, not a credential, and the #134 update went
further: a signed-in browser cannot claim a session by being signed in, only by
presenting the same code it always needed. That was the right answer to the
question being asked then, which was whether *association* — a fact the relay
learns cheaply — should be allowed to become authorization. It should not, and
it still does not.

This is a different question. Not "is this browser signed in", which is a claim
the relay would be taking on trust, but "is this the account the console
already vouched for at `POST /sessions`, named by that same answer". That fact
is not asserted by the browser and cannot be. It is handed to the relay by the
console, in the reply to the one outbound call the #134 update introduced.

**What the console now answers.** `POST /terminal/verify` returns

    { "account": { "id": ..., "email": ..., "relayUser": ... } }

where `relayUser` is the same opaque name that console already puts in every
`POST /pair` header and every browser websocket url for that account — an HMAC
of the account id under the console's own session secret, which is why the
relay cannot compute it and a browser cannot guess it. Nothing new is
disclosed: the relay was being sent this value on every pair already. What
changes is that it now arrives attached to a verified account instead of
arriving on its own.

**What the relay does with it.** The create command carries `ownerUser`
alongside `accountId`, set from that verify answer and from nowhere else, and
only when the verify said `ok`. A browser connecting in the browser role whose
`x-user` equals a session's `ownerUser` is admitted. Everything else is exactly
the code path that was there before: no `ownerUser`, no match, or no verified
account, and the answer is still `not_paired`.

**Why the recorder is the point.** The console's transcript is written by a
socket in the browser role. Until now that socket was refused until a human
typed the code, so nothing at all was recorded before somebody looked: a
terminal shared and left alone did its work with no record of it. It now
attaches as soon as the console learns the share is happening — which is at the
verify call, the moment of `/share` — and the relay replays that session's ring
from its first frame, so the conversation begins at `/share` rather than at
first sight.

**Admitted is also drivable, deliberately.** The alternative was an owner who
may watch but must still spend a code to type. It was rejected for two reasons.
The narrow one: with the console rendering a shared terminal as a conversation,
the recorder's socket *is* the drive path, so a read-only admission would mean
inventing a second, weaker browser role on the relay to hold a distinction
nothing else needs. The wide one: the code exists so that a person at the
terminal consents to a watcher who cannot otherwise be identified. Here the
person at the terminal is the person at the browser — the credential the share
was made under is one they signed in with and can revoke — and asking them to
copy six characters out of their own terminal into their own console is not a
second party consenting. It is the same party, twice.

**Rule 4 is unchanged and load-bearing.** `ownerUser` is a bearer name inside
the relay, exactly as a paired uuid always was, and the relay still binds to
loopback or the tailnet and still trusts what reaches it there. This adds no
new reason to expose it and takes none away.

**Two-sided consent for a third party is untouched.** Admitting the owner
spends nothing: `codeUsed` stays false, `pairedUserId` stays empty, the listing
still reports the session unpaired, and the code the terminal printed still
pairs somebody else afterwards — who is then admitted alongside the owner
rather than instead of them. A browser signed in to a different account is
refused with `not_paired` and has to be handed the code, which is spec 002 as
written.

**Revocation.** The exemption is created by that one verify and by nothing
else, so a credential the console will not vouch for produces no `accountId`,
no `ownerUser`, and admits nobody — the share itself is already refused at the
client for the same reason (#279 follow-up). A credential revoked while a
session is already running leaves that session's `ownerUser` in place for as
long as the session lasts, which is the same thing #134 already decided about
`accountId`, and is bounded by the terminal's own process: the revoked key is
the one that terminal makes its inference calls with. What matters is that
there is no second trust path to revoke separately. There is one call, it
happens at create, and it decides both facts together.

**The relay's own page is unaffected.** It is account-blind, it invents a
random uuid for `x-user`, and it talks to a relay that may have no console at
all. A session no console vouched for has an empty `ownerUser` and admits
nobody without a code, so this cannot become a route by which that page lets
anyone in.

Verified in `make owner-admission-harness`
(`scripts/verify_owner_admission.mjs`): a real daemon holding a real credential
shares into a real relay verifying it against a console stub, and with nothing
pairing anything, a browser under the owner name is admitted, replayed from
`session.hello`, sees a turn happen and approves it, and the file the tool
wrote is checked on disk. The relay's own command log is asserted on — one
create carrying the owner name, no pair command at all, and every browser
connect presenting that name — rather than the absence of an error. A browser
under any other name is refused `not_paired`, is shown nothing, then pairs with
the printed code and is admitted by the path that was always there. A second
relay whose console names no `relayUser` admits neither that name nor the bare
account id. CI runs it on the host build and against the binaries linux-release
publishes, because `ownerUser` is one more field parsed out of a create command
and kept, which is what #292 was.

## Update, #300: a share the relay forgot is re-made by the client

A relay restart drops every session it holds. Before this, the terminal went on
believing it was shared, the console's conversation went offline, and only a
person re-running `/share` recovered it. Restarting a relay is ordinary - a
deploy, an upgrade, a crash with systemd bringing it back - and none of those
are a decision to stop sharing.

**Rule 6 is not weakened; it is what forces the shape.** The relay still stores
nothing durable, and nothing here asks it to remember a session across a
restart. The client re-creates. A re-made session is a *new* session in every
way rule 6 already implies: a new id, a new secret, a new code, an empty ring,
and nobody paired to it. What survives the restart lives on the two machines
that were doing the work, never on the relay.

**Deliberately not in scope** above says session persistence across a *terminal*
restart is not a thing, and that stays true. This is the other side: the
terminal is still running and still has everything the relay was given. Handing
it back is not persistence, it is repetition.

**How the two failures are told apart.** A relay that does not answer may come
back, so the terminal keeps retrying it, with backoff, and says so once the
outage outlives a short quiet window. A relay that *answers* and refuses is a
different fact, and the refusal now says which one it is: the terminal
websocket is sent the same `error` frame the browser one always was, rather
than being closed with an unexplained 4401.

- `session_not_found` - the relay is up and has never heard of this session.
  That is the restart, and it is the only refusal that re-creates.
- anything else - the relay knows the session and will not have this terminal.
  Re-creating would be guessing, so the share ends and says why.

This is the distinction joule-sh/console#51 drew for the recorder, held to on
this side too.

**What is never re-made.** Only a share that is live, was not detached, and was
lost while the terminal still wanted it. A daemon that stops now closes its
relay socket on the way out, so the relay is *told* the share ended and drops
the session rather than leaving it to the idle sweep - and a session ended that
way is gone from the account's listing at once. A share the terminal gave up on
is ended the same way. Neither comes back by itself; `/share` is how a person
asks for a new one.

**Giving up rather than going quiet.** Retries double from 500ms to a ten-second
cap. If nothing has answered for two minutes the share ends and the terminal is
told, naming the address it tried and the last thing that happened there. It
does not keep knocking after that.

**What the terminal prints, and why it is not a code.** A silent re-share prints
one notice: that the relay restarted, that the session was re-made, and that the
code printed earlier is dead. It does not print the new code. A code nobody
asked for is noise in the middle of somebody's work, and with the owner's own
console admitted without one (#296) the code is a third-party concern - a
person who has to hand six characters to somebody else can ask for them with
`/share`, which now always answers with a code the relay actually holds. That
last part is joule-sh/code#295: the daemon's cached share was a claim, and
`/share` reconciles with the relay before repeating it.

**A third party's pairing does not survive it.** The code they spent bought a
session that no longer exists, and nothing about a relay restarting makes them
identifiable to the new one, so they are not re-admitted. Rule 1 is the reason:
authority comes from spending a code against a session that is there, never
from having spent one once. The owner is the exception #296 argued, and only
because they hold a credential they signed in with; a third party holds no such
thing before the restart and no such thing after it. Re-admitting them would
mean somebody remembering a pairing across the restart, which is rule 6 again.

What a re-make owes them is the truth and the same offer as the first time:
that the session was replaced, and somewhere to put a new code. Being shown
nothing, or a conversation that will not revive, is the one answer that is
wrong. That surface belongs to the console, and the relay already hands it what
it needs - a browser dialling the old session is answered `session_not_found`,
which is the whole of what a relay keeping nothing durable can honestly say.

**The conversation continues, and that is the point.** The console keys a
terminal conversation on account and workspace, never on session id, so a
re-made session carrying the same verified account and the same workspace lands
in the conversation that was already there, with its history. The create the
relay records after a restart is asserted to carry both.

## Update, #317: the relay address is a URL, and it is used as one

A production relay is not a bare host and port. It sits behind the shared
gateway on a path, as `https://joule.sh/relay`, the way every other service on
that host is fronted. The console already said so: `relayAdvert` returns a full
URL string.

The client did not keep it. It split the advert into a host and a port and
built the pairing call back out of those, defaulting the scheme to `http`. So
`https://joule.sh/relay` was asked as `http://joule.sh:443/sessions` - the path
gone and the scheme lost, with the port surviving only as the default that same
scheme had implied. The edge answered `400 The plain HTTP request was sent to
HTTPS port`, which is the whole of what production `/share` did.

**The advertised string is the address.** It is trimmed of trailing slashes
once, where the config is resolved, and `/sessions` is joined to it there and
nowhere else, so no call site can produce `//sessions` or drop a prefix. A
bare `http://100.89.7.80:8790` normalises to itself, which is why staging goes
on working unchanged while production moves.

**Nothing is guessed.** An advert that is not a URL leaves the client
unconfigured rather than pointed somewhere plausible, and `/share` refuses by
name, as it already did for a console that advertised nothing at all. The
development overrides keep the shape they had - `JOULE_RELAY_URL`,
`JOULE_RELAY_WS_URL` and `JOULE_WEB_BASE_URL` are URLs already, so honouring
the advert cost them nothing.

Verified in `make relay-path-advert-harness`
(`scripts/verify_relay_path_advert.mjs`): a real relay behind a reverse proxy
that serves it under `/relay` and answers 404 to everything else, advertised
at that URL, driven to a session created, a socket connected and a turn
streamed to a paired browser that approves a tool. It asserts on the request
line the proxy received - exactly `POST /relay/sessions` - rather than on the
share succeeding, because a check that only asks whether the share worked
passes against a bare host and port and proves nothing (#280). The trailing
slash and the bare host-and-port advert are driven the same way. CI runs it on
the host build and against the binaries linux-release publishes, because the
address is now a string parsed out of a credential file and held for the life
of a share, which is the shape of #292.
