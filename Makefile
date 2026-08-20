.PHONY: build test clean

build: bin/code bin/relay

bin/code: src/code.ts
	mkdir -p bin
	lumen compile src/code.ts
	mv code bin/code

bin/relay: src/relay/relay.ts
	mkdir -p bin
	lumen compile src/relay/relay.ts
	mv relay bin/relay

test:
	lumen test src/code.ts
	lumen test src/relay/relay.ts
	lumen test src/protocol/frames.test.ts

clean:
	rm -rf bin code relay
