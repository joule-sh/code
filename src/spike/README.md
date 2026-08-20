# src/spike: evidence for #14

Throwaway programs, not wired into `make build`/`make test`. They exist to
answer #14 and back `docs/01-concurrency-spike.md`; nothing else in the repo
imports them.

`fake_relay.ts` stands in for the relay's terminal-facing WebSocket: a raw TCP
server on `:8475` that writes six timestamped frames, one every 400ms, then a
sentinel and closes. `receive()` on a real WS peer blocks the same way a
`Socket.read()` loop on this does; framing (WS opcodes and masking) is not the
part #14 needs to prove, so this skips it and speaks newline-delimited lines
instead.

`slow_http.ts` stands in for the model's SSE stream: a two-parameter
(streaming) `http.createServer` handler on `:8476` that writes four
timestamped chunks, one every second.

`main.ts` is the actual spike. It starts `Worker.run(receiveLoop)`
(`receiveLoop` is a zero-parameter, zero-capture top-level function, the
verified-safe shape from spec 059) against `fake_relay`, then blocks the main
thread reading `http.stream` chunks from `slow_http`, then blocks it again
reading lines from a spawned `sh -c 'sleep 1; echo ...'` child. Every frame the
worker thread receives gets a wall-clock timestamp and is appended to
`/tmp/joule-spike-mailbox.log` via `fs.appendFileSync` (thread-safe: only the
worker thread ever writes it, only the main thread ever reads it). The main
thread drains that file after every blocking read returns and logs the gap
between when the worker received a frame and when the main thread noticed it.

Run it by hand:

```
lumen compile src/spike/fake_relay.ts
lumen compile src/spike/slow_http.ts
lumen compile src/spike/main.ts
./fake_relay &
./slow_http &
./main
```

Two runs' full output are quoted in `docs/01-concurrency-spike.md`.
