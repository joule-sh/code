# 01: concurrency spike (#14)

## Answer

Concurrent in one process, by the exact mechanism spec 003 already committed
to: a `Worker`-hosted blocking receive loop, running alongside an `http.stream`
drain and a spawned child's output drain on the main thread, none starving the
others. Spec 003 and #10 stand as written. One addition, below: how frames
cross from the worker thread to the main thread, since spec 003 named the
`Worker` but not the handoff.

## What was built

`src/spike/` (throwaway, not wired into `make build`/`make test`, see its own
note):

- `fake_relay.ts` -- a raw TCP server on `:8475` standing in for the relay's
  terminal-facing WebSocket. `receive()` (spec 003) is a blocking read on an
  open connection; framing is not what #14 needs to prove, so this sends
  timestamped newline-delimited lines instead of real WS frames. Six frames,
  400ms apart, then closes.
- `slow_http.ts` -- an `http.createServer` two-parameter streaming handler on
  `:8476` standing in for the model's SSE stream (spec 452, `http.stream`).
  Four chunks, 1000ms apart.
- `main.ts` -- the spike itself. `Worker.run(receiveLoop)` against
  `fake_relay`, then the main thread blocks reading `http.stream` chunks from
  `slow_http`, then blocks again reading lines from a spawned
  `sh -c '... sleep 1 ...'` child. Every frame the worker receives is
  timestamped and appended to a file; the main thread drains that file after
  every blocking read returns and logs the gap between receipt and discovery.

Two independent runs, full output below. Both used a real compiled binary
(`lumen compile`), run by hand, not a `lumen test` example.

## The handoff: not in spec 003, and it has to be a mailbox, not a shared object

`Worker.run(fn)` returns one `Promise<T>` that resolves once, with `T`
restricted to `i32`/`i64`/`f64`/`bool` (spec 059). A `receive()` loop that
keeps running for the life of a session cannot hand each frame back through
that Promise -- it only fires at the end. Spec 059 is also explicit that a
Lumen object shared and mutated across threads (a `Map`, a class instance, the
`Session` the turn loop owns) is a documented, unprevented data race, not a
safe channel.

So the worker function in this spike is a zero-capture top-level function
(the verified-safe shape spec 059 describes, the same shape `relay.ts` already
uses for its own `Worker.run` calls) that writes each received frame to a
plain file with `fs.appendFileSync`. Only the worker thread ever writes it,
only the main thread ever reads it -- single-writer, single-reader, no lock
needed, and it rides on the same arena-allocator thread-safety spec 059
already verified for `fs`. The main thread checks that file each time one of
its own blocking reads returns, which is exactly the "approval gate's ~100ms
poll tick" shape spec 003's own Ctrl-C section already describes -- this spike
is evidence that the same shape works for relay frames too, not a new idea.

This is the one thing #10 should add to spec 003's text: the relay connection
being "owned by a `Worker`" needs a stated handoff, and a small append-only
file (or an equivalent single-writer/single-reader primitive) is the
mechanism, not a shared `Session` instance and not a second Promise per frame.

## Evidence

Run 1. `fake_relay` frames sent at 400ms intervals starting ~t+0; `slow_http`
chunks sent at 1000ms intervals. The main thread is inside a blocking
`stream.readLine()` call between each `http chunk observed` line -- the
`observed [frame-N ...]` lines in between are frames the worker received
*during* that block, discovered the moment the block ended:

```
main: spawning worker receive loop against fake relay at 127.0.0.1:8475
main: opening http.stream to http://127.0.0.1:8476/
main: http status 200
main: http chunk observed at 1787249645311 blocked_ms=1001 line=[data: chunk-0 sent=1787249645310]
main: observed [frame-0 sent=1787249644710] during [blocked on http.stream] recv_at=1787249644710 observed_at=1787249645311 latency_ms=601
main: http chunk observed at 1787249646311 blocked_ms=1000 line=[data: chunk-1 sent=1787249646311]
main: observed [frame-1 sent=1787249645110] during [blocked on http.stream] recv_at=1787249645833 observed_at=1787249646311 latency_ms=478
main: observed [frame-2 sent=1787249645511] during [blocked on http.stream] recv_at=1787249645929 observed_at=1787249646311 latency_ms=382
main: observed [frame-3 sent=1787249645911] during [blocked on http.stream] recv_at=1787249646028 observed_at=1787249646311 latency_ms=283
main: http chunk observed at 1787249647312 blocked_ms=1001 line=[data: chunk-2 sent=1787249647311]
main: observed [frame-4 sent=1787249646331] during [blocked on http.stream] recv_at=1787249646331 observed_at=1787249647312 latency_ms=981
main: observed [frame-5 sent=1787249646731] during [blocked on http.stream] recv_at=1787249646731 observed_at=1787249647312 latency_ms=581
main: http chunk observed at 1787249648312 blocked_ms=1000 line=[data: chunk-3 sent=1787249648312]
main: spawning child process dripper
main: child line observed at 1787249648315 blocked_ms=1 line=[child-line-1
]
main: child line observed at 1787249649316 blocked_ms=1001 line=[child-line-2
]
main: child line observed at 1787249650318 blocked_ms=830 line=[child-line-3
]
main: child line observed at 1787249651320 blocked_ms=1001 line=[child-line-4
]
main: worker receive loop finished, frames=6
```

Run 2, same setup, run independently a few minutes later:

```
main: spawning worker receive loop against fake relay at 127.0.0.1:8475
main: opening http.stream to http://127.0.0.1:8476/
main: http status 200
main: http chunk observed at 1787249845242 blocked_ms=1000 line=[data: chunk-0 sent=1787249845242]
main: observed [frame-0 sent=1787249844641] during [blocked on http.stream] recv_at=1787249844641 observed_at=1787249845243 latency_ms=602
main: observed [frame-1 sent=1787249845041] during [blocked on http.stream] recv_at=1787249845042 observed_at=1787249845243 latency_ms=201
main: http chunk observed at 1787249846243 blocked_ms=1000 line=[data: chunk-1 sent=1787249846243]
main: observed [frame-2 sent=1787249845442] during [blocked on http.stream] recv_at=1787249845442 observed_at=1787249846243 latency_ms=801
main: observed [frame-3 sent=1787249845842] during [blocked on http.stream] recv_at=1787249845842 observed_at=1787249846243 latency_ms=401
main: http chunk observed at 1787249847243 blocked_ms=1000 line=[data: chunk-2 sent=1787249847243]
main: observed [frame-4 sent=1787249846242] during [blocked on http.stream] recv_at=1787249846243 observed_at=1787249847332 latency_ms=1089
main: observed [frame-5 sent=1787249846643] during [blocked on http.stream] recv_at=1787249846643 observed_at=1787249847332 latency_ms=689
main: http chunk observed at 1787249848244 blocked_ms=912 line=[data: chunk-3 sent=1787249848243]
main: spawning child process dripper
main: child line observed at 1787249848246 blocked_ms=0 line=[child-line-1
]
main: child line observed at 1787249849248 blocked_ms=1002 line=[child-line-2
]
main: child line observed at 1787249850250 blocked_ms=1002 line=[child-line-3
]
main: child line observed at 1787249851252 blocked_ms=1002 line=[child-line-4
]
main: worker receive loop finished, frames=6
```

## What the numbers show

- `blocked_ms` on every `http chunk observed` and `child line observed` line
  sits at ~1000ms, matching the sender's own interval -- the main thread was
  genuinely parked in a blocking read each time, not spinning.
- `recv_at` on the worker's frames falls *inside* those same 1000ms windows
  (e.g. run 1: frame-1 received at `...5833`, between the chunk-0 read
  finishing at `...5311` and the chunk-1 read finishing at `...6311`), and in
  run 1 frame-0 is received (`...4710`) before the first `http chunk observed`
  line even prints (`...5311`) -- the worker's connection was live and
  receiving before the main thread had finished its very first blocking read.
- `latency_ms` (time from the worker receiving a frame to the main thread
  noticing it) ranges 201-1089ms across both runs, bounded by the ~1000ms
  cadence of whichever blocking read the main thread was mid-way through, not
  by the 2400ms it takes all six frames to arrive or by the ~4000ms the
  `http.stream` phase runs for. A frame is never held until `http.stream`
  finishes, and never held until the child process finishes either -- all six
  are drained during the `http.stream` phase in both runs, before the child
  process is even spawned.
- Both runs end with `frames=6`, the exact count sent, and the process exits
  cleanly -- `Worker.run`'s promise resolves correctly after a real
  multi-second concurrent run, not just a quick one.

## What this does not change

Nothing in spec 003's transport decision, the WebSocket-in/SSE-out shape, or
#10's design changes. The one addition is recorded above: the handoff is a
small single-writer/single-reader file, not a shared `Session` object and not
a second Promise per frame. No new upstream Lumen issues were filed by this
spike -- every primitive it needed (`Worker.run`, `net.connect`/
`net.createServer`, `http.stream`, `fs.appendFileSync`/`readFileSync`,
`child_process.spawn`) already exists and worked as documented.
