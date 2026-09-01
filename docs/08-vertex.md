# Vertex AI

A plan, to be validated in its own iteration before any of it is built.

## Where the daemon stands

There is one provider client and it speaks OpenAI's chat-completions wire
format. Everything a conversation needs is `{ baseUrl, model, apiKey }`
(`src/providers/config.ts`), resolved from flags, then `JOULE_CODE_BASE_URL` /
`JOULE_CODE_MODEL` / `JOULE_CODE_API_KEY`, then the config file. The request
goes to `cfg.baseUrl + "/v1/chat/completions"` with `Authorization: Bearer
{apiKey}` (`src/providers/openai.ts:163`). `src/providers/platform.ts` knows
four hosts by name, and only to prefix model names for display.

Vertex AI offers two doors:

1. **The OpenAI-compatible endpoint** —
   `https://{loc}-aiplatform.googleapis.com/v1beta1/projects/{p}/locations/{loc}/endpoints/openapi/chat/completions`
   — speaks the format we already speak.
2. **The native API** (`generateContent`, publisher model paths, Anthropic-on-
   Vertex) — a different request shape, response shape, streaming framing and
   tool-call encoding.

Door 1 is a configuration problem with two real obstacles. Door 2 is a second
provider implementation and is out of scope here; if it is ever wanted it gets
its own plan.

## Obstacle one: the path

The client appends `/v1/chat/completions` unconditionally, and Vertex's path
does not end that way — it carries the project and location and ends in
`/endpoints/openapi/chat/completions`.

Plan: the append becomes a rule rather than a constant. If `baseUrl` already
ends in `/chat/completions`, it is used verbatim; otherwise the current suffix
is appended. No new config field, no behaviour change for every existing
user, and any OpenAI-compatible host with an unusual path shape gets the same
escape hatch. One function, `completionsUrl(baseUrl)`, next to the constant it
replaces, with tests for both shapes.

## Obstacle two: the credential

`apiKey` is a static string for the life of the daemon. Vertex wants an OAuth2
access token minted from a service account, and it expires in about an hour —
longer than many delegated sessions.

Plan: `JOULE_CODE_API_KEY_FILE`. When set, the daemon reads the token from
that file at each request rather than holding it from startup. Whoever runs
the daemon keeps the file fresh — locally that is
`gcloud auth print-access-token` on a timer; on the platform the engine
already stages an env file per daemon and its sweep can rewrite a token file
on the same cadence. The daemon itself never learns OAuth, JWT signing or
service-account JSON, which keeps the credential machinery — and its failure
modes — outside the sandbox.

Rejected alternative: minting tokens in the daemon from
`GOOGLE_APPLICATION_CREDENTIALS`. It means RS256 signing inside the sandbox, a
private key sitting in the container, and a clock dependency; the file
indirection gets the same result with none of that.

## Small pieces

- `platformOf` learns `aiplatform.googleapis.com` → `"vertex"`, so display
  names read `vertex/gemini-…` the way the others do. Nothing else keys on it.
- Model names pass through untouched. The compatible endpoint takes
  `google/{model}` in the model field; that is the operator's string to write.
- The engine (`std-contrib`) trims a trailing `/v1` off a model row's base URL
  before handing it to a delegate. A Vertex base URL is a full path and must
  pass through untouched — the trim applies only when what remains is a bare
  origin.

## Validation iteration — what must be proven before building

Run against a real GCP project (credentials are the operator's to bring):

1. A plain turn: request accepted, SSE streaming arrives and parses with the
   existing reader.
2. Tool calls: the daemon's `run`/`read`/`write` schemas round-trip — Vertex's
   OpenAI layer has known gaps around parallel calls and strict schemas, and
   this is the likeliest place door 1 fails outright.
3. A long turn crossing a token expiry, with the file being rewritten under
   it — the next request picks up the new token without a restart.
4. `usage` fields arrive in the shape the token tracker reads, or the tracker
   tolerates their absence.
5. An expired-token 401 produces a readable error at the person, not a hang.

If (2) fails, door 1 is not viable and this plan stops; door 2 becomes a
question of whether Vertex matters enough to fund a native provider.

## Breaking changes

None intended. The path rule preserves today's behaviour for every base URL
that does not already name the completions endpoint; `JOULE_CODE_API_KEY_FILE`
is additive and wins over `JOULE_CODE_API_KEY` only when set; the platform
table gains a row nothing else reads. The protocol, frames and session format
are untouched.
