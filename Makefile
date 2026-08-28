.PHONY: build release test macos-test e2e share-liveness-harness terminal-share-mode-harness cold-start-harness stop-then-start-harness skills-harness memory-files-harness editor-frames editor-icon editor-check editor-harness editor-window-harness editor-package npm-check npm-package terminal-harness clipboard-harness layout-harness onboarding-harness login-server-harness daemon-concurrent-harness daemon-attach-harness build-mismatch-harness daemon-commands-harness daemon-stop-harness attach-commands-harness two-client-harness share-bridge-harness console-association-harness owner-admission-harness session-listing-harness windows-harness windows-daemon-harness relay-reconnect-harness relay-reshare-harness relay-path-advert-harness relay-tls-advert-harness ws-peer-lifecycle-harness dangling-toolcall-harness bench-mailbox clean

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

# Which tty shim to compile, and what the linker calls the result. The two tty
# shims share no code - one is termios, the other console modes and a reader
# thread, and their headers say why - so this is a swap rather than a set of
# ifdefs inside one file. The platform shim beside it is the same C on both.
#
# SHIM_FLAGS turns off the UBSan instrumentation zig cc adds by default: on a
# Windows target the calls it emits have nothing to resolve against, and the
# link fails on __ubsan_handle_type_mismatch_v1 rather than on anything here.
#
# ws2_32 is on the link line because the platform shim asks Winsock directly
# whether a port is accepting, rather than finding out by connecting - see the
# lumen#44 note where plat_port_open is defined. The backend links it for its
# own socket layer but does not put it where a shim object can resolve
# against it, so naming it here is what makes socket/connect/htons resolve.
ifeq ($(findstring windows,$(LUMEN_TARGET)),windows)
TTY_SHIM_SRC := src/vendor/tty/tty_shim_win32.c
SHIM_FLAGS := -fno-sanitize=undefined
TARGET_FLAGS += --link ws2_32
EXE := .exe
else
TTY_SHIM_SRC := src/vendor/tty/tty_shim.c
SHIM_FLAGS :=
EXE :=
endif

SHIMS := src/vendor/tty/tty_shim.o src/vendor/platform/platform_shim.o

JOULE := bin/joule$(EXE)
RELAY := bin/relay$(EXE)
DAEMON := bin/joule-daemon$(EXE)
STUB_MODEL := bin/stub_model$(EXE)

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

build: $(JOULE) $(RELAY) $(DAEMON)

src/vendor/tty/tty_shim.o: $(TTY_SHIM_SRC)
	$(SHIM_CC) $(SHIM_FLAGS) -c $(TTY_SHIM_SRC) -o src/vendor/tty/tty_shim.o

src/vendor/platform/platform_shim.o: src/vendor/platform/platform_shim.c
	$(SHIM_CC) $(SHIM_FLAGS) -c src/vendor/platform/platform_shim.c -o src/vendor/platform/platform_shim.o

$(JOULE): $(ALL_TS) $(SHIMS)
	mkdir -p bin
	lumen compile $(TARGET_FLAGS) $(LUMEN_FLAGS) src/code.ts
	mv code$(EXE) $(JOULE)

$(RELAY): $(ALL_TS) $(SHIMS)
	mkdir -p bin
	lumen compile $(TARGET_FLAGS) $(LUMEN_FLAGS) src/relay/relay.ts
	mv relay$(EXE) $(RELAY)

$(DAEMON): $(ALL_TS) $(SHIMS)
	mkdir -p bin
	lumen compile $(TARGET_FLAGS) $(LUMEN_FLAGS) src/daemon/daemon_main.ts
	mv daemon_main$(EXE) $(DAEMON)

$(STUB_MODEL): $(ALL_TS) $(SHIMS)
	mkdir -p bin
	lumen compile $(TARGET_FLAGS) $(LUMEN_FLAGS) src/e2e/stub_model.ts
	mv stub_model$(EXE) $(STUB_MODEL)

release: $(SHIMS)
	mkdir -p bin
	lumen compile --release-fast $(TARGET_FLAGS) $(LUMEN_FLAGS) src/code.ts
	mv code$(EXE) $(JOULE)
	lumen compile --release-fast $(TARGET_FLAGS) $(LUMEN_FLAGS) src/relay/relay.ts
	mv relay$(EXE) $(RELAY)
	lumen compile --release-fast $(TARGET_FLAGS) $(LUMEN_FLAGS) src/daemon/daemon_main.ts
	mv daemon_main$(EXE) $(DAEMON)

test: $(SHIMS)
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

macos-test: $(SHIMS)
	lumen test src/code.ts
	lumen test src/relay/relay.ts
	lumen test src/e2e/stub_model.ts
	lumen test src/daemon/daemon_main.ts
	for f in $(MACOS_TEST_TS); do lumen test $$f || exit 1; done

e2e: build bin/stub_model
	node scripts/e2e_full_stack.mjs

terminal-harness: build bin/stub_model
	python3 scripts/terminal_structural_harness.py

# Reads the system clipboard back after a mouse selection, rather than
# asserting that an escape sequence was emitted - emitting it is what already
# worked while nothing reached a clipboard (#282). Needs a display and a
# clipboard command: on Linux the script starts its own Xvfb and uses xclip,
# on macOS the runner's own session and pbcopy.
clipboard-harness: build bin/stub_model
	python3 scripts/verify_clipboard_pty.py

layout-harness: build bin/stub_model
	python3 scripts/verify_layout.py

onboarding-harness: build bin/stub_model
	python3 scripts/verify_onboarding.py

model-platform-harness: build bin/stub_model
	python3 scripts/verify_model_platform_pty.py

cold-start-harness: build bin/stub_model
	python3 scripts/verify_cold_start_pty.py

skills-harness: build bin/stub_model
	python3 scripts/verify_skills_pty.py

memory-files-harness: build bin/stub_model
	python3 scripts/verify_memory_files_pty.py

login-server-harness: build bin/stub_model
	python3 scripts/verify_login_server.py

daemon-concurrent-harness: build bin/stub_model
	node scripts/verify_daemon_concurrent_clients.mjs

daemon-attach-harness: build bin/stub_model
	python3 scripts/verify_attach_pty.py

# A client of one build meeting a daemon of another, which is the one thing
# the build-mismatch refusal (#276) is for and the one thing nothing ran. It
# compiles a second daemon from a copy of the tree with another version.ts,
# so the two really are different builds, and then asserts the client's exit
# status rather than only its output: the refusal printed correctly and the
# process aborted straight afterwards (#291).
build-mismatch-harness: build bin/stub_model
	python3 scripts/verify_build_mismatch_pty.py

daemon-commands-harness: build bin/stub_model
	node scripts/verify_daemon_mode_model.mjs

daemon-stop-harness: build bin/stub_model
	node scripts/verify_daemon_stop.mjs

stop-then-start-harness: build bin/stub_model
	python3 scripts/verify_stop_then_start.py

attach-commands-harness: build bin/stub_model
	python3 scripts/verify_attach_commands.py

two-client-harness: build bin/stub_model
	python3 scripts/verify_two_clients.py

share-bridge-harness: build bin/stub_model
	node scripts/verify_share_bridge.mjs

# The one thing #311 was about: a shared turn reaching the relay while it is
# still running. It asserts on when frames arrive rather than that they do -
# the uplink delivered every frame of a turn eventually, in one batch after
# turn.end, so a check that only counted arrivals passed the whole time the
# feature was unusable. The model streams on a delay so the turn takes tens of
# seconds, and the approval is answered from the browser and nowhere else,
# because an approval that arrives after the turn it blocked cannot be
# answered at all.
share-liveness-harness: build bin/stub_model
	node scripts/verify_share_liveness.mjs

# The terminal front end's own share, read off a browser socket rather than
# off the screen (#312). It runs the binary on a pty with no daemon binary
# beside it, which is what makes src/code.ts fall back to that front end, and
# then asks a paired browser what the hello actually carried and whether a
# /mode typed at the terminal moved it.
terminal-share-mode-harness: build bin/stub_model
	node scripts/verify_terminal_share_mode.mjs

console-association-harness: build bin/stub_model
	node scripts/verify_console_association.mjs

owner-admission-harness: build bin/stub_model
	node scripts/verify_owner_admission.mjs

# Polls the relay's account listing right through a session's life - created,
# paired, driven, browser gone, terminal still connected - rather than once
# just after /share. A session that is listed at one convenient moment and not
# at the next is what #292 shipped, and a point-in-time check passed the whole
# time it was broken.
#
# It takes the binaries as they are, so the release jobs can point it at what
# they built. That is the half that matters here: the fault was in which
# collector a targeted build links, so it did not exist in a host build.
session-listing-harness: build bin/stub_model
	node scripts/verify_session_listing_lifecycle.mjs

# The Windows sibling of terminal-harness. It drives the real binary through a
# ConPTY, which is what Windows Terminal hosts a console program with, rather
# than asserting anything about a build that only exited 0.
windows-harness: build $(STUB_MODEL)
	python scripts/win_terminal_harness.py

# The Windows sibling of the daemon harnesses, and the only place the Windows
# spawn is driven: the client starts a daemon, leaves, a second client joins
# the session it left behind, and `joule --stop` ends it.
windows-daemon-harness: build $(STUB_MODEL)
	python scripts/win_daemon_harness.py

editor-frames:
	node scripts/gen_editor_frames.mjs

editor-icon:
	node scripts/gen_editor_icon.mjs

editor-check:
	node scripts/syntax_check.mjs
	node scripts/gen_editor_frames.mjs --check
	node scripts/verify_renderer.mjs
	node scripts/verify_editor_modes.mjs
	node scripts/verify_editor_setup.mjs
	node scripts/verify_editor_placement.mjs
	node scripts/verify_editor_publish.mjs
	node --check editor/extension.js
	for f in editor/src/*.js editor/media/*.js scripts/editor_window/*.js; do node --check $$f || exit 1; done

editor-harness: build bin/stub_model editor-check
	node scripts/verify_editor_client.mjs

# Downloads a real VS Code, opens a window on a throwaway workspace and drives
# the panel through it. Needs a display: on Linux the runner starts its own
# Xvfb when DISPLAY is unset, and kills it again on the way out. A Windows
# runner already has one, which is why this target names $(STUB_MODEL) rather
# than the POSIX spelling of it - the same recipe runs there (#250).
editor-window-harness: build $(STUB_MODEL) editor-check
	npm --prefix scripts/editor_window ci --no-audit --no-fund
	node scripts/editor_window/runner.mjs

editor-package: editor-check
	node scripts/package_editor.mjs

# The npm packages need no toolchain: they repack binaries a release already
# built. So these checks build their own fixture archives, pack them, install
# what they packed into a scratch prefix and run it, which is the only way to
# see the things that actually break an npm CLI - a lost execute bit, an
# optional dependency npm skipped, and a wrapper that resolves nothing.
npm-check:
	node --check npm/code/bin/joule
	node --check npm/code/bin/relay
	for f in npm/code/lib/*.js; do node --check $$f || exit 1; done
	node scripts/verify_npm_wrapper.mjs
	node scripts/verify_npm_publish.mjs

# Takes the release archives, so it wants --artifacts pointing at a directory
# holding code-x86_64-linux.tar.gz and the two macOS ones. It never builds a
# binary of its own; a package with a binary nobody released is the one thing
# this must not be able to produce.
npm-package:
	node scripts/package_npm.mjs

relay-reconnect-harness: bin/relay
	node scripts/verify_relay_reconnect.mjs

# The one shape nothing drove before #317: a relay reached through a path on
# a shared gateway rather than on a port of its own, which is what production
# is. It serves its own relay behind a reverse proxy under /relay and asserts
# on the request line that proxy received, because a check that only asks
# whether the share worked passes against a bare host and port and proves
# nothing (#280). The bare shape is driven too, since staging advertises one.
relay-path-advert-harness: build bin/stub_model
	node scripts/verify_relay_path_advert.mjs

# #319/#323: a terminal socket advertised as wss:// is dialled, not refused.
# #321 refused it up front, because net.connect is plaintext and there was no
# TLS-capable read to reach for; both halves exist now, so the share goes
# through to the relay and reports whatever happens there. The relay in this
# harness answers nothing, so what it reports is which address it tried -
# which is how we know the advert was taken as an address rather than as a
# reason to stop. Driven under a real pty on the built binary, because the
# behaviour is what the terminal prints and when, not a return value.
relay-tls-advert-harness: build bin/stub_model
	python3 scripts/verify_relay_tls_advert_pty.py

# A relay restart, driven the way one happens: the process is killed, a
# replacement comes up on the same ports, and nobody touches the terminal.
# It asserts on the relay's own command log - a create after the restart
# carrying the same account and workspace, and a terminal connect against
# what that create made - rather than on the absence of an error (#280).
# The give-up path runs at its real two-minute budget, so this target is
# slow on purpose: a budget a harness can shorten is one the shipped binary
# never has to honour.
relay-reshare-harness: build bin/stub_model
	node scripts/verify_relay_reshare.mjs

# A dangling tool_call is a session-killer, not a lost turn: the provider
# refuses the history and joule keeps sending it, so every later turn in that
# workspace dies too (#305). Each scenario drives a real daemon into the shape
# a different way and then asserts the NEXT turn still succeeds. The stub model
# refuses an invalid history the way DeepSeek does, so this cannot pass on a
# product that is broken and a fake that shrugs (#280).
dangling-toolcall-harness: build bin/stub_model
	node scripts/verify_dangling_toolcall.mjs

ws-peer-lifecycle-harness: build bin/stub_model
	node scripts/verify_ws_peer_lifecycle.mjs

bin/mailbox_bench: $(ALL_TS) $(SHIMS)
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
	rm -rf bin code relay daemon_main code.exe relay.exe daemon_main.exe dist src/vendor/tty/tty_shim.o src/vendor/platform/platform_shim.o
