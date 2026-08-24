.PHONY: build release test macos-test e2e editor-frames editor-check editor-harness editor-window-harness editor-package terminal-harness layout-harness onboarding-harness login-server-harness daemon-concurrent-harness daemon-attach-harness daemon-commands-harness daemon-stop-harness attach-commands-harness share-bridge-harness console-association-harness relay-reconnect-harness ws-peer-lifecycle-harness bench-mailbox clean

ALL_TS := $(shell find src -name '*.ts')
TEST_TS := $(shell find src -name '*.test.ts')

# The triple to build for, empty for a build that only has to run where it was
# built. Naming one makes the result self-contained: `lumen compile` links musl
# and its own copy of the Boehm collector into the binary, so nothing is
# resolved on the machine it lands on (#184). The C shim has to be compiled for
# the same target, because a static link cannot take an object built against
# the host's libc headers.
LUMEN_TARGET ?=

ifeq ($(strip $(LUMEN_TARGET)),)
SHIM_CC := cc
TARGET_FLAGS :=
else
SHIM_CC := zig cc -target $(LUMEN_TARGET)
TARGET_FLAGS := --target $(LUMEN_TARGET) --static
endif

# Extra flags for `lumen compile`. Empty for a local build, where the Boehm
# collector is whatever the machine already has: a normal system library on
# Linux, Homebrew's keg on macOS (Zig only knows about Apple Silicon's prefix,
# so a Mac build passes it as `--link -L<dir>`).
#
# The release workflow fills this in on macOS, pointing at a directory holding
# nothing but a static `libgc.a`, so a released binary carries the collector
# instead of hoping to find one on the machine it lands on. Linux needs nothing
# here: LUMEN_TARGET already builds the collector into the binary.
LUMEN_FLAGS ?=

# How many mailbox entries `make bench-mailbox` writes per mode. The rewrite
# modes are quadratic, so raising this costs time faster than it looks.
BENCH_ENTRIES ?= 2000

build: bin/joule bin/relay bin/joule-daemon

src/vendor/tty/tty_shim.o: src/vendor/tty/tty_shim.c
	$(SHIM_CC) -c src/vendor/tty/tty_shim.c -o src/vendor/tty/tty_shim.o

bin/joule: $(ALL_TS) src/vendor/tty/tty_shim.o
	mkdir -p bin
	lumen compile $(TARGET_FLAGS) $(LUMEN_FLAGS) src/code.ts
	mv code bin/joule

bin/relay: $(ALL_TS)
	mkdir -p bin
	lumen compile $(TARGET_FLAGS) $(LUMEN_FLAGS) src/relay/relay.ts
	mv relay bin/relay

bin/joule-daemon: $(ALL_TS)
	mkdir -p bin
	lumen compile $(TARGET_FLAGS) $(LUMEN_FLAGS) src/daemon/daemon_main.ts
	mv daemon_main bin/joule-daemon

bin/stub_model: $(ALL_TS)
	mkdir -p bin
	lumen compile $(TARGET_FLAGS) $(LUMEN_FLAGS) src/e2e/stub_model.ts
	mv stub_model bin/stub_model

release: src/vendor/tty/tty_shim.o
	mkdir -p bin
	lumen compile --release-fast $(TARGET_FLAGS) $(LUMEN_FLAGS) src/code.ts
	mv code bin/joule
	lumen compile --release-fast $(TARGET_FLAGS) $(LUMEN_FLAGS) src/relay/relay.ts
	mv relay bin/relay
	lumen compile --release-fast $(TARGET_FLAGS) $(LUMEN_FLAGS) src/daemon/daemon_main.ts
	mv daemon_main bin/joule-daemon

test: src/vendor/tty/tty_shim.o
	lumen test src/code.ts
	lumen test src/relay/relay.ts
	lumen test src/e2e/stub_model.ts
	lumen test src/daemon/daemon_main.ts
	for f in $(TEST_TS); do lumen test $$f || exit 1; done

# The same suite, minus the files that do not pass on macOS yet. Every one
# of those is an unrelated platform gap - the permission bits a credential
# file is written with, and how the update path recognises and smoke-tests
# a managed install - and each is tracked on its own ticket. Everything
# else runs, so a new macOS-only failure anywhere in the tree still fails
# CI. The list is meant to shrink.
MACOS_SKIP_TS := src/auth/credentials.test.ts src/terminal/update_offer.test.ts src/update/install_detect.test.ts src/update/install_smoke.test.ts
MACOS_TEST_TS := $(filter-out $(MACOS_SKIP_TS),$(TEST_TS))

macos-test: src/vendor/tty/tty_shim.o
	lumen test src/code.ts
	lumen test src/relay/relay.ts
	lumen test src/e2e/stub_model.ts
	lumen test src/daemon/daemon_main.ts
	for f in $(MACOS_TEST_TS); do lumen test $$f || exit 1; done

e2e: build bin/stub_model
	node scripts/e2e_full_stack.mjs

terminal-harness: build bin/stub_model
	python3 scripts/terminal_structural_harness.py

layout-harness: build bin/stub_model
	python3 scripts/verify_layout.py

onboarding-harness: build bin/stub_model
	python3 scripts/verify_onboarding.py

login-server-harness: build bin/stub_model
	python3 scripts/verify_login_server.py

daemon-concurrent-harness: build bin/stub_model
	node scripts/verify_daemon_concurrent_clients.mjs

daemon-attach-harness: build bin/stub_model
	python3 scripts/verify_attach_pty.py

daemon-commands-harness: build bin/stub_model
	node scripts/verify_daemon_mode_model.mjs

daemon-stop-harness: build bin/stub_model
	node scripts/verify_daemon_stop.mjs

attach-commands-harness: build bin/stub_model
	python3 scripts/verify_attach_commands.py

share-bridge-harness: build bin/stub_model
	node scripts/verify_share_bridge.mjs

console-association-harness: build bin/stub_model
	node scripts/verify_console_association.mjs

editor-frames:
	node scripts/gen_editor_frames.mjs

editor-check:
	node scripts/syntax_check.mjs
	node scripts/gen_editor_frames.mjs --check
	node --check editor/extension.js
	for f in editor/src/*.js editor/media/*.js scripts/editor_window/suite.js; do node --check $$f || exit 1; done

editor-harness: build bin/stub_model editor-check
	node scripts/verify_editor_client.mjs

# Downloads a real VS Code, opens a window on a throwaway workspace and drives
# the panel through it. Needs a display: on Linux the runner starts its own
# Xvfb when DISPLAY is unset, and kills it again on the way out.
editor-window-harness: build bin/stub_model editor-check
	npm --prefix scripts/editor_window ci --no-audit --no-fund
	node scripts/editor_window/runner.mjs

editor-package: editor-check
	node scripts/package_editor.mjs

relay-reconnect-harness: bin/relay
	node scripts/verify_relay_reconnect.mjs

ws-peer-lifecycle-harness: build bin/stub_model
	node scripts/verify_ws_peer_lifecycle.mjs

bin/mailbox_bench: $(ALL_TS)
	mkdir -p bin
	lumen compile $(TARGET_FLAGS) $(LUMEN_FLAGS) src/bench/mailbox_bench.ts
	mv mailbox_bench bin/mailbox_bench

bench-mailbox: bin/mailbox_bench
	BENCH_MODE=rewrite BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench
	BENCH_MODE=mailbox BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench
	BENCH_MODE=poll-rewrite BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench
	BENCH_MODE=poll-mailbox BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench
	BENCH_MODE=concurrent BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench

clean:
	rm -rf bin code relay daemon_main dist src/vendor/tty/tty_shim.o
