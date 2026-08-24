#!/bin/sh
# Guards what a macOS release archive promises, by opening the archive rather
# than trusting the tree it was built from: every binary inside it carries a
# valid code signature, resolves nothing at run time, and starts.
#
# Opening the archive is the whole point. The macOS CI job builds on the runner
# and then runs the binaries sitting in bin/, so a fault introduced by signing,
# copying or packaging is invisible to it - a green macOS job and a download
# that dies on exec are consistent with each other, and that is how #196
# shipped three times. This unpacks the published tarball into a directory of
# its own and runs what comes out of it.
#
# The signature is checked with codesign and not left to the run below, and
# that ordering is deliberate. On a Mac the run would be enough: Apple Silicon
# refuses to exec a binary it cannot check a signature for, sending SIGKILL as
# the image is mapped, so the process leaves no message and a shell reports 137
# with nothing else to go on. On a hosted runner it is not enough. GitHub's
# macOS images run with System Integrity Protection disabled, and a binary
# there runs happily with its signature stripped out - measured, not assumed.
# So the only check that sees a signature fault on the machine that builds the
# release is codesign's. Running the binaries stays, because it catches
# everything else an archive can get wrong, but it is not what guards this.
#
# Usage: scripts/check_macos_release.sh code-aarch64-macos.tar.gz
set -eu

archive="${1:-}"
if [ -z "$archive" ]; then
  echo "usage: check_macos_release.sh <code-aarch64-macos.tar.gz|code-x86_64-macos.tar.gz>" >&2
  exit 2
fi
if [ ! -f "$archive" ]; then
  echo "$archive does not exist" >&2
  exit 2
fi

dir_name="$(basename "$archive")"
dir_name="${dir_name%.tar.gz}"
case "$dir_name" in
  code-aarch64-macos) want_arch="arm64" ;;
  code-x86_64-macos) want_arch="x86_64" ;;
  *)
    echo "$archive is not a macOS release archive" >&2
    exit 2
    ;;
esac

# Running the binaries is the check that matters, and it only means anything on
# the architecture they were built for. Refusing here beats quietly skipping
# it and reporting success over an archive nobody ever started.
host_arch="$(uname -m)"
if [ "$host_arch" != "$want_arch" ]; then
  echo "$archive holds $want_arch binaries and this is a $host_arch machine," >&2
  echo "so none of them could be run. Check it on a $want_arch machine." >&2
  exit 2
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar -xzf "$archive" -C "$work"

root="$work/$dir_name"
if [ ! -d "$root" ]; then
  echo "$archive does not contain a $dir_name directory" >&2
  exit 1
fi

status=0
run_with_deadline() {
  deadline=$1
  shift
  "$@" &
  pid=$!
  ( sleep "$deadline"; kill -9 "$pid" 2>/dev/null ) &
  watcher=$!
  wait "$pid" 2>/dev/null
  code=$?
  kill -9 "$watcher" 2>/dev/null
  if [ "$code" -ge 128 ]; then return 124; fi
  return "$code"
}

for bin in joule relay joule-daemon; do
  echo "$bin:"
  path="$root/$bin"

  if [ ! -f "$path" ]; then
    echo "  $archive does not contain $bin" >&2
    status=1
    continue
  fi
  if [ ! -x "$path" ]; then
    echo "  $bin came out of the archive without its executable bit" >&2
    status=1
  fi

  archs="$(lipo -archs "$path" 2>/dev/null || echo "")"
  case " $archs " in
    *" $want_arch "*) echo "  arch: $archs" ;;
    *)
      echo "  $bin is not a $want_arch executable (lipo reads: ${archs:-nothing})" >&2
      status=1
      ;;
  esac

  # A released macOS binary depends on nothing but libSystem. A dynamic libgc
  # installs fine and then dies in the loader on a machine without Homebrew.
  if otool -L "$path" | grep -q libgc; then
    echo "  $bin still links libgc dynamically:" >&2
    otool -L "$path" | grep libgc | sed 's/^/    /' >&2
    status=1
  fi

  set +e
  signing="$(codesign --verify --strict --verbose=2 "$path" 2>&1)"
  signing_status=$?
  set -e
  if [ "$signing_status" -eq 0 ]; then
    echo "  signature: valid"
  else
    echo "  $bin has no code signature this machine will accept:" >&2
    printf '%s\n' "$signing" | sed 's/^/    /' >&2
    echo "    an unsigned or stale signature is fatal on Apple Silicon, where" >&2
    echo "    the kernel kills the process on exec instead of reporting it." >&2
    status=1
  fi

  set +e
  output="$(run_with_deadline 20 "$path" --version 2>&1)"
  run_status=$?
  set -e
  if [ "$run_status" -eq 124 ]; then
    echo "  $bin did not print its version within 20s" >&2
    echo "    it started but never returned, so the archive cannot be verified" >&2
    status=1
    continue
  fi
  if [ "$run_status" -eq 0 ]; then
    echo "  runs: $output"
  else
    echo "  $bin exited $run_status instead of printing its version" >&2
    if [ -n "$output" ]; then
      printf '%s\n' "$output" | sed 's/^/    /' >&2
    else
      echo "    it said nothing at all on the way out" >&2
    fi
    if [ "$run_status" -eq 137 ]; then
      echo "    137 is SIGKILL on exec, which on Apple Silicon means the kernel" >&2
      echo "    refused the binary's code signature" >&2
    fi
    status=1
  fi
done

exit "$status"
