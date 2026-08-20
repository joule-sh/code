.PHONY: build release test clean

build: bin/joule bin/relay

src/demo/tty_shim.o: src/demo/tty_shim.c
	cc -c src/demo/tty_shim.c -o src/demo/tty_shim.o

bin/joule: src/code.ts src/demo/tty_shim.o
	mkdir -p bin
	lumen compile src/code.ts
	mv code bin/joule

bin/relay: src/relay/relay.ts
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
	lumen test src/protocol/frames.test.ts

clean:
	rm -rf bin code relay src/demo/tty_shim.o
