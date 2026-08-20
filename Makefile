.PHONY: build release test clean

build: bin/joule bin/relay

bin/joule: src/code.ts
	mkdir -p bin
	lumen compile src/code.ts
	mv code bin/joule

bin/relay: src/relay/relay.ts
	mkdir -p bin
	lumen compile src/relay/relay.ts
	mv relay bin/relay

release:
	mkdir -p bin
	lumen compile --release-fast src/code.ts
	mv code bin/joule
	lumen compile --release-fast src/relay/relay.ts
	mv relay bin/relay

test:
	lumen test src/code.ts
	lumen test src/relay/relay.ts
	lumen test src/protocol/frames.test.ts

clean:
	rm -rf bin code relay
