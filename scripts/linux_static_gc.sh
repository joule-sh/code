#!/bin/sh
# Builds the static Boehm collector a Linux release links against, into the
# directory named on the command line.
#
# It is built from source rather than copied from the distro for one reason:
# the packaged `libgc.a` on a current Ubuntu is compiled against glibc 2.38
# headers, so linking it pulls `__isoc23_strtol` in and raises the glibc
# version the whole binary needs. Compiling it here against an old glibc keeps
# a statically linked collector from costing anyone their distribution.
#
# The archive is the only thing in the output directory on purpose: `-lgc`
# takes the first match on the search path, so nothing there can resolve to the
# build machine's shared copy.
#
# Usage: scripts/linux_static_gc.sh <out-dir>
set -eu

# Pinned so every release links the identical, previously verified collector.
bdwgc_tag="v8.2.6"

# Old enough to be below any glibc this project could target, and new enough
# for everything bdwgc calls.
glibc_target="x86_64-linux-gnu.2.28"

out="${1:?usage: linux_static_gc.sh <out-dir>}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL "https://github.com/ivmai/bdwgc/archive/refs/tags/$bdwgc_tag.tar.gz" -o "$work/bdwgc.tar.gz"
tar -xzf "$work/bdwgc.tar.gz" -C "$work"
src="$work/bdwgc-${bdwgc_tag#v}"

# extra/gc.c is bdwgc's own single-translation-unit build, so this needs no
# configure run. The defines match what distributions configure: threads, and
# fork handling, which a process that spawns tools wants.
zig cc -target "$glibc_target" -O2 -c "$src/extra/gc.c" \
  -I"$src/include" \
  -DGC_THREADS -D_REENTRANT -DGC_BUILTIN_ATOMIC -DHANDLE_FORK \
  -DALL_INTERIOR_POINTERS -DNO_EXECUTE_PERMISSION \
  -o "$work/gc.o"
zig ar rcs "$out/libgc.a" "$work/gc.o"

echo "$out/libgc.a"
