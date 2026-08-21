.PHONY: build release test e2e terminal-harness layout-harness onboarding-harness bench-mailbox clean

ALL_TS := $(shell find src -name '*.ts')
TEST_TS := $(shell find src -name '*.test.ts')

# Extra flags for `lumen compile`. Empty on Linux, where the Boehm collector is
# a normal system library. macOS has no system copy, and Zig only knows about
# Apple Silicon's Homebrew prefix, so the release workflow passes the keg's lib
# directory here as `--link -L<dir>`.
LUMEN_FLAGS ?=

# How many mailbox entries `make bench-mailbox` writes per mode. The rewrite
# modes are quadratic, so raising this costs time faster than it looks.
BENCH_ENTRIES ?= 2000

build: bin/joule bin/relay

src/vendor/tty/tty_shim.o: src/vendor/tty/tty_shim.c
	cc -c src/vendor/tty/tty_shim.c -o src/vendor/tty/tty_shim.o

bin/joule: $(ALL_TS) src/vendor/tty/tty_shim.o
	mkdir -p bin
	lumen compile $(LUMEN_FLAGS) src/code.ts
	mv code bin/joule

bin/relay: $(ALL_TS)
	mkdir -p bin
	lumen compile $(LUMEN_FLAGS) src/relay/relay.ts
	mv relay bin/relay

bin/stub_model: $(ALL_TS)
	mkdir -p bin
	lumen compile $(LUMEN_FLAGS) src/e2e/stub_model.ts
	mv stub_model bin/stub_model

release: src/vendor/tty/tty_shim.o
	mkdir -p bin
	lumen compile --release-fast $(LUMEN_FLAGS) src/code.ts
	mv code bin/joule
	lumen compile --release-fast $(LUMEN_FLAGS) src/relay/relay.ts
	mv relay bin/relay

test: src/vendor/tty/tty_shim.o
	lumen test src/code.ts
	lumen test src/relay/relay.ts
	lumen test src/e2e/stub_model.ts
	for f in $(TEST_TS); do lumen test $$f || exit 1; done

e2e: build bin/stub_model
	node scripts/e2e_full_stack.mjs

terminal-harness: build bin/stub_model
	python3 scripts/terminal_structural_harness.py

layout-harness: build bin/stub_model
	python3 scripts/verify_layout.py

onboarding-harness: build bin/stub_model
	python3 scripts/verify_onboarding.py

bin/mailbox_bench: $(ALL_TS)
	mkdir -p bin
	lumen compile $(LUMEN_FLAGS) src/bench/mailbox_bench.ts
	mv mailbox_bench bin/mailbox_bench

bench-mailbox: bin/mailbox_bench
	BENCH_MODE=rewrite BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench
	BENCH_MODE=mailbox BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench
	BENCH_MODE=poll-rewrite BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench
	BENCH_MODE=poll-mailbox BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench
	BENCH_MODE=concurrent BENCH_ENTRIES=$(BENCH_ENTRIES) ./bin/mailbox_bench

clean:
	rm -rf bin code relay src/vendor/tty/tty_shim.o
