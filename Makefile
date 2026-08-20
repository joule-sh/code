.PHONY: build release test clean

ALL_TS := $(shell find src -name '*.ts')
TEST_TS := $(shell find src -name '*.test.ts')

build: bin/joule bin/relay

src/demo/tty_shim.o: src/demo/tty_shim.c
	cc -c src/demo/tty_shim.c -o src/demo/tty_shim.o

bin/joule: $(ALL_TS) src/demo/tty_shim.o
	mkdir -p bin
	lumen compile src/code.ts
	mv code bin/joule

bin/relay: $(ALL_TS)
	mkdir -p bin
	lumen compile src/relay/relay.ts
	mv relay bin/relay

release: src/demo/tty_shim.o
	mkdir -p bin
	lumen compile --release-fast src/code.ts
	mv code bin/joule
	lumen compile --release-fast src/relay/relay.ts
	mv relay bin/relay

test: src/demo/tty_shim.o
	lumen test src/code.ts
	lumen test src/relay/relay.ts
	for f in $(TEST_TS); do lumen test $$f || exit 1; done

clean:
	rm -rf bin code relay src/demo/tty_shim.o
