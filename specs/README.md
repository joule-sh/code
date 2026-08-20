# Specs

One directory per decided piece: `NNN-short-name/spec.md`, numbered in the order
they were written. Same form the Lumen repo uses, for the same reason. A spec is
where a decision and the thing that forced it are written down once, so the next
person does not rediscover it from the code.

A spec is not a ticket. The ticket says what to do and when it is done; the spec
says what the shape is and why it is not some other shape. A piece with an
obvious shape needs a ticket and no spec.

## Sections a spec here tends to have

**What is true today.** The current behaviour, with file and line where it
exists. If it does not exist yet, what constrains it.

**What other systems decided.** Prior art, and specifically what each one got
*wrong*, because that is the part that transfers.

**What this adds.** The shape, concretely enough to build from.

**The rules.** Numbered invariants. These are the part worth re-reading during
review.

**Deliberately not in scope.** With the consequence recorded, so that a
limitation is a choice and not a surprise later.

## Index

| spec | what it settles |
| --- | --- |
| [001-frames](001-frames/spec.md) | the vocabulary the terminal, relay and browser share |
| [002-pairing](002-pairing/spec.md) | how a browser earns the right to drive a terminal |
| [003-transport](003-transport/spec.md) | WebSocket for the terminal and browser links, SSE only to the model |
