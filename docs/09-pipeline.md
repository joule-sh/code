# Pipelines

Closing the gap between "a loop with helpers" and a graph: subagents exist
(`spawn_agent`, one level deep, ten steps, prose replies), but nothing owns
control flow across them. The orchestrating model decides every hand-off
turn by turn, results come back as prose nobody can route on, and ten steps
is too small a budget for a producer node.

Three increments, smallest first, each useful alone.

## 1. A step budget the task can ask for

`spawn_agent` takes `steps` (default 10, clamped 1..40). A verification
side-quest stays cheap at the default; a producer node doing real work names
a bigger budget instead of dying mid-task. The clamp is the guard: a model
cannot ask for an unbounded loop.

## 2. A reply the caller can route on

`spawn_agent` takes `report` — a sentence describing the JSON object the
final reply must be, e.g. `{"verdict": "pass"|"fail", "reasons": [...]}`.
When set, the worker's system prompt requires the final reply to be exactly
one JSON object of that shape and nothing else. If the final reply does not
look like a lone JSON object, the worker sends one corrective message and
grants one extra step — once. The report text is a contract for the model,
not a schema the daemon validates; the caller still reads what came back.

Without this, fan-in means an orchestrator parsing prose. With it, a
reviewer node can answer `{"verdict":"fail","reasons":[...]}` and the
pipeline below can branch on it.

## 3. `run_pipeline` — stages the daemon advances, not the model

A new tool takes a declared plan:

    {"stages": [
      {"name": "survey",  "tasks": ["list every test file and what it covers"]},
      {"name": "verify",  "report": "{\"verdict\":\"pass\"|\"fail\"}",
       "tasks": ["check A against {{prior}}", "check B against {{prior}}"]}
    ]}

Stages run in order; the tasks inside a stage run as parallel subagents;
`{{prior}}` in a task is replaced with the previous stage's reports joined
together. A stage's `report` applies to each of its tasks. When the last
stage finishes, one consolidated note lands in the conversation, the same
way a single subagent's report does.

The daemon advances the pipeline in the poll it already runs — the same
place subagent results come home — so control flow is deterministic: the
model wrote the plan once, and no model decides the hand-offs. Approvals
still surface per tool call exactly as they do for a lone subagent, so a
pipeline in ask-mode is noisy by design rather than silently privileged.

Caps: at most 5 stages, 5 tasks per stage, 10 tasks per pipeline. One
pipeline at a time per session. Subagents in a pipeline still cannot spawn
anything, so the graph is exactly as deep as the plan says.

## What this is not

Not conditional edges, not per-node models, not sub-pipelines. Stages and
fan-out cover draft-then-review, research-then-write and build-then-check —
the shapes worth having first — and each omitted feature is a decision the
plan's owner should get to see fail before it is built.

## Files

`src/tasks/pipeline.ts` holds the spec parsing, caps and advancement;
`pipeline.test.ts` beside it. `spawn_agent` changes thread through
`schemas.ts`, `types.ts`, `registry.ts`, `manager.ts`, `subagent_worker.ts`.
The board gains two accessors (done, report-of). Every touched file stays
under five hundred lines.
