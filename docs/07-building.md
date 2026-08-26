# Building from source

Requires the [Lumen](https://lumen-lang.org) toolchain (`lumen`, and `zig`
alongside it on `PATH`, as the release archive ships them). Lumen publishes
macOS builds too (`lumen-aarch64-macos.tar.gz`, `lumen-x86_64-macos.tar.gz`),
so this works natively on a Mac.

```sh
git clone https://github.com/joule-sh/code.git
cd code
make build
./bin/joule --version
```

`make build` produces all three binaries: `bin/joule`, `bin/relay` and
`bin/joule-daemon`. `make test` runs the test suite. `make release` builds the
`--release-fast` binaries the release workflow packages.

## macOS needs Homebrew's collector

Lumen's allocator links the Boehm collector as a system library. Linux distros
ship it as `libgc` and a local build needs nothing extra. macOS has no system
copy, so a Mac build needs Homebrew's and has to point the compiler at it:

```sh
brew install bdw-gc
make build LUMEN_FLAGS="--link -L$(brew --prefix bdw-gc)/lib"
```

The `-L` is not optional on Intel Macs. Zig ignores `LIBRARY_PATH` on macOS and
only has Apple Silicon's `/opt/homebrew` in its built-in search paths, so an
Intel build fails without it.

## Reproducing a release build

The release archives link that library statically on both platforms, so an
installed release carries it, and there is no library to install alongside
it: a macOS binary needs nothing beyond the system's own libSystem, and a
Linux one needs nothing at all - no libc version, no loader, no shared
library - so it runs the same on Ubuntu 22.04, on a decade-old enterprise
release and on Alpine. macOS uses Homebrew's `libgc.a`. Linux names a
target instead, which links musl and a collector the compiler builds for that
target, leaving a binary with nothing to resolve. To reproduce what a Linux
release ships:

```sh
make release LUMEN_TARGET=x86_64-linux-musl
scripts/check_linux_release.sh bin/joule bin/relay bin/joule-daemon
```

`LUMEN_TARGET` also compiles the vendored `tty_shim.o` for that target, so
switch it on a tree that was already built and `make clean` first.
