#!/bin/sh
# Guards what a Linux release archive promises, for each binary named on the
# command line: it is one file that resolves nothing at run time. No
# `libgc.so.1` to find, no libc version to satisfy, no loader to invoke -
# nothing the target machine has to supply (#184).
#
# Anything short of that looks identical on the build machine and dies in the
# loader on someone else's, right after an installer reported success, so it is
# checked against the ELF rather than inferred from a build that worked here.
#
# Usage: scripts/check_linux_release.sh bin/joule bin/relay bin/joule-daemon
set -eu

status=0
for bin in "$@"; do
  echo "$bin:"

  # An unreadable or non-ELF path must fail loudly rather than sail through the
  # checks below, which all ask what an ELF contains.
  if [ ! -f "$bin" ] || ! readelf -h "$bin" >/dev/null 2>&1; then
    echo "$bin is missing or is not an ELF file" >&2
    status=1
    continue
  fi

  # `ldd` is what a person reaches for, so its verdict is worth printing, but
  # the program and dynamic headers are what actually decide. A file that needs
  # nothing at run time names no interpreter and lists no shared library.
  ldd "$bin" 2>&1 | sed 's/^/  /' || true

  if readelf -lW "$bin" | grep -q INTERP; then
    echo "$bin names a dynamic loader, so it is not a self-contained file" >&2
    status=1
  fi

  needed="$(readelf -dW "$bin" 2>/dev/null | grep NEEDED || true)"
  if [ -n "$needed" ]; then
    echo "$bin still asks the machine it lands on for shared libraries:" >&2
    echo "$needed" | sed 's/^/  /' >&2
    status=1
  fi

  # Every previous way this broke left a versioned glibc reference behind: the
  # collector pulled one in, and so did building on a newer distribution. A
  # musl-linked binary has none, and one that grows any is back to a floor.
  versioned="$(readelf -sW "$bin" 2>/dev/null | grep -o 'GLIBC_[0-9.]*' | sort -uV || true)"
  if [ -n "$versioned" ]; then
    echo "$bin references versioned glibc symbols, so it carries a glibc floor:" >&2
    echo "$versioned" | sed 's/^/  /' >&2
    status=1
  fi
done

exit "$status"
