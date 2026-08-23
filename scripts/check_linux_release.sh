#!/bin/sh
# Guards what a Linux release archive promises, for each binary named on the
# command line: it carries the Boehm collector instead of looking for a
# `libgc.so.1` the target may not have, and it does not quietly raise the glibc
# version it needs. Both failures look the same to whoever installed it - a
# success message, then a binary that dies in the loader (#184) - and neither
# is visible to a test that only ever runs on the build machine.
#
# Usage: scripts/check_linux_release.sh bin/joule bin/relay bin/joule-daemon
set -eu

# The newest glibc a released binary is allowed to ask for. Raising it drops
# distributions, so it is a decision, not a build detail: 2.36 already rules
# out Ubuntu 22.04 LTS, which is supported until 2027 and is what
# `wsl --install` still gives most Windows users. Removing the floor rather
# than lowering it needs the binaries linked against musl, which the compiler
# cannot ask its backend for yet (lumen-lang-org/lumen#37).
max_glibc="2.36"

status=0
for bin in "$@"; do
  echo "$bin:"
  ldd "$bin" | sed 's/^/  /'

  if ldd "$bin" | grep -q libgc; then
    echo "$bin links libgc dynamically; the archive has to carry the collector" >&2
    status=1
  fi

  needs="$(objdump -T "$bin" | grep -o 'GLIBC_[0-9.]*' | sed 's/^GLIBC_//' | sort -uV | tail -1)"
  echo "  needs glibc $needs"
  if [ "$(printf '%s\n%s\n' "$max_glibc" "$needs" | sort -V | tail -1)" != "$max_glibc" ]; then
    echo "$bin needs glibc $needs, above the $max_glibc this release targets." >&2
    echo "Something in the build raised the floor; that drops every distribution between." >&2
    status=1
  fi
done

exit "$status"
