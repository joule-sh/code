# 004: running joule on Node.js

**Status**: Draft. Depends on Lumen specs 502–508 (lumen-lang-org/lumen,
`specs/501-node-runtime` is the analysis).

## What this decides

`joule` gains a second build: `lumen compile --target node src/code.ts`,
published as a pure-JavaScript npm package that needs no platform binary and
no collector. The native build stays the primary one. `relay` and the
daemon's listening side stay native until Lumen has a non-blocking server
API (Lumen spec 508, decision 3).

## Changes in this repository

1. **Five string literals** carry a raw line break (`src/terminal/style.ts:57`,
   `src/terminal/renderer.ts`, `src/terminal/mouse_select.test.ts:226`,
   `src/terminal/scrollback.test.ts:409`, `src/providers/openai.test.ts:272`).
   Spell them `\n`. Lumen 502 warns on the old spelling.
2. **JavaScript twins of the two shims** (Lumen 507):
   `src/vendor/tty/tty_shim.mjs` and `src/vendor/platform/platform_shim.mjs`,
   named by `// @link-node` beside the existing `// @link`. `plat_*` map to
   `process.env`, `fs.appendFileSync`, `fs.chmodSync`, a TCP probe;
   `tty_*` to `tty.isatty`, `setRawMode`, `fs.readSync(fd)`, and
   `process.stdout.columns/rows`. `tty_read_byte_timeout` needs Lumen 508's
   broker; until then it returns `-3` (timeout) immediately on Node and the
   tests that exercise it are listed in `node-skip.txt`.
3. **Makefile**: `make node` (compiles `src/code.ts` to `dist/node/`),
   `make node-test` (runs every `*.test.ts` with `lumen test --target
   node`, skipping `node-skip.txt`), `make node-package` (assembles
   `npm/code-js/`).
4. **npm**: a second package, `@joule-sh/code-js`, whose `bin/joule` is
   `node dist/node/code.mjs`. `@joule-sh/code` is unchanged.

## Success criteria

- **SC-001**: `make node-test` passes the same tests as `make test` except
  those in `node-skip.txt`, and that file lists only tests that touch
  `net`, `http.createServer`, or the tty timeout read, each with the Lumen
  spec that will unblock it.
- **SC-002**: `node dist/node/code.mjs --version` prints the version;
  `scripts/e2e_full_stack.mjs` passes against the node build once Lumen 508
  lands.
- **SC-003**: `make build` and `make test` are unchanged.

## Tasks

- [ ] T001 Fix the five raw-newline literals (no behaviour change; `make
  test` green).
- [ ] T002 Write `tty_shim.mjs` and `platform_shim.mjs`; add `// @link-node`
  lines.
- [ ] T003 `make node`, `make node-test`, `node-skip.txt` with reasons.
- [ ] T004 `npm/code-js/` package and `scripts/verify_npm_js.mjs`.
- [x] T005 Record the per-file parity table from Lumen 506 T006 here.

## Node target parity (Lumen 506 T006)

`lumen/tools/joule_node_tests.sh /home/user/code` (Lumen commit adding spec
506's remaining tasks) ran every `src/**/*.test.ts` file under both `lumen
test` and `lumen test --target node`, after building the two C shims with
`zig cc -c ... -o ...` (no `// @link-node` twin exists yet, so `make node`
itself is not runnable -- this is a raw per-file compile+run sweep, not
`make node-test`).

Result: **109/109 native, 38/109 node** (38 match, 71 do not). Every
mismatch is a node-target *compile* failure, not a runtime difference, and
every one falls into exactly the two gaps this spec's T002 and Lumen spec
508 already name:

| reason | count | cause |
| --- | --- | --- |
| `E_FFI_NODE_LINK` | 50 | `plat_*`/`tty_*` externs have no `// @link-node` JS twin (this spec's T002: `platform_shim.mjs`, `tty_shim.mjs`) |
| `E_TARGET_UNSUPPORTED` | 21 | the file's import graph reaches `providers/openai.ts`'s `http.request`/`stream` (Lumen spec 508 — the node target does not support the `http` client/server surface yet) |

No file failed for any other reason, and no file that passed natively
failed on node for a reason unrelated to these two. Once T002 lands, the
`E_FFI_NODE_LINK` files should flip to passing without further changes; the
`E_TARGET_UNSUPPORTED` files are blocked on Lumen 508 (`node-skip.txt`
candidates until then, per this spec's T003 and SC-001).

Files that already match (pass on both targets), for reference: 38 files
across `approval/`, `auth/server`, `daemon/{daemon_log,dispatch_mode}`,
`protocol/frames`, `relay/{pairing,query,store,web/smoke}`,
`session/{frontmatter,history_guard,project_instructions,session,session_dangling}`,
`tasks/subagent_protocol`, most of `terminal/*` that doesn't touch tty/mouse
raw I/O, `tools/{files,jail,shell_quote}`, and
`update/{archive,platform,settings,version_compare}`.
