#!/bin/sh
# Guards the one thing an install over an existing install has to get right:
# it must never write a new binary over a file the kernel has already execed.
# macOS caches the result of validating a code signature against the vnode, so
# a replacement written into the old file's inode can be killed on exec even
# though its bytes are validly signed - #235, which reproduced on every
# reinstall on Apple Silicon.
#
# What this proves, and where. The assertion is about inodes, not about exec:
# it installs, runs what it installed, keeps a hard link to the running binary,
# installs again, and then checks that the path now holds a different inode and
# that the inode it kept a link to still hashes to what it did before. That is
# the mechanism itself, and it is machine-independent - a Linux runner checks
# it as well as a Mac does.
#
# Exec is deliberately not the check, and on a hosted runner it could not be.
# GitHub's macOS images run with System Integrity Protection disabled and do
# not enforce signatures at all, so a binary with a stale or missing one starts
# there quite happily; #196 measured that. So a green run here does not say
# "this would have survived the kernel" - it says the installer never put the
# kernel in a position to refuse anything, and that every binary it leaves
# behind passes codesign on the way out.
#
# Usage: scripts/check_install_swap.sh [path/to/install.sh]
set -eu

installer="${1:-install.sh}"
case "$installer" in
  /*) ;;
  *) installer="$PWD/$installer" ;;
esac
if [ ! -f "$installer" ]; then
  echo "no install script at $installer" >&2
  exit 2
fi

release="${CHECK_INSTALL_VERSION:-v0.18.0}"
os="$(uname -s)"
machine="$(uname -m)"
case "$os-$machine" in
  Linux-x86_64) platform="x86_64-linux" ;;
  Darwin-arm64) platform="aarch64-macos" ;;
  Darwin-x86_64) platform="x86_64-macos" ;;
  *)
    echo "no release is built for $os-$machine, so there is nothing to install here" >&2
    exit 2
    ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

CODE_INSTALL_ROOT="$work/root"
CODE_BIN_DIR="$work/bin"
CODE_VERSION="$release"
export CODE_INSTALL_ROOT CODE_BIN_DIR CODE_VERSION
target="$CODE_INSTALL_ROOT/$release"
binaries="joule relay joule-daemon"

status=0
ok() { echo "  ok: $1"; }
bad() { echo "  FAIL: $1" >&2; status=1; }

inode_of() { ls -i "$1" | awk '{print $1}'; }
if command -v sha256sum >/dev/null 2>&1; then
  hash_of() { sha256sum "$1" | awk '{print $1}'; }
else
  hash_of() { shasum -a 256 "$1" | awk '{print $1}'; }
fi

remember() { inode_of "$2" > "$work/$1-inode-$3"; hash_of "$2" > "$work/$1-hash-$3"; }
recall() { cat "$work/$1-$2-$3"; }

install_run() {
  label="$1"
  if sh "$installer" >"$work/$label.log" 2>&1; then
    sed 's/^/    /' "$work/$label.log"
    return 0
  fi
  sed 's/^/    /' "$work/$label.log"
  return 1
}

no_scratch_left() {
  found="$(ls -a "$CODE_INSTALL_ROOT" 2>/dev/null | grep '^\.update-tmp-' || true)"
  if [ -z "$found" ]; then ok "$1"; else bad "$1 (found: $found)"; fi
}

signatures_valid() {
  [ "$os" = "Darwin" ] || return 0
  for bin in $binaries; do
    if codesign --verify --strict "$target/$bin" >/dev/null 2>&1; then
      ok "$bin at its installed path passes codesign --verify --strict"
    else
      bad "$bin at its installed path has no signature this machine accepts"
      codesign --verify --strict --verbose=2 "$target/$bin" 2>&1 | sed 's/^/    /' >&2 || true
    fi
  done
}

links_sane() {
  for bin in joule relay; do
    link="$CODE_BIN_DIR/$bin"
    if [ ! -L "$link" ]; then
      bad "$bin in the bin dir is not a symlink"
    elif [ "$(readlink "$link")" != "$target/$bin" ]; then
      bad "$bin points at $(readlink "$link"), not at $target/$bin"
    elif "$link" --version >/dev/null 2>&1; then
      ok "$bin resolves through its link and runs"
    else
      bad "$bin resolves through its link but will not run"
    fi
  done
  if [ -e "$CODE_BIN_DIR/joule.install-staging" ] || [ -e "$CODE_BIN_DIR/relay.install-staging" ]; then
    bad "a staging link was left behind in the bin dir"
  else
    ok "no staging links were left behind in the bin dir"
  fi
}

echo "=== phase 1: a first install of $release into an empty root ==="
if install_run first; then
  ok "the first install succeeded"
else
  bad "the first install failed, so nothing below can be checked"
  exit "$status"
fi
for bin in $binaries; do
  if [ -f "$target/$bin" ]; then ok "$bin landed in $target"; else bad "$bin is missing from $target"; fi
done
signatures_valid
links_sane
no_scratch_left "no scratch directories were left behind by the first install"

echo "=== phase 2: run what was installed, then keep a hard link to the very inode ==="
mkdir -p "$work/witness"
for bin in $binaries; do
  if "$target/$bin" --version >/dev/null 2>&1; then
    ok "$bin runs from its installed path, so the kernel has now execed this inode"
  else
    bad "$bin will not run from its installed path"
  fi
  ln "$target/$bin" "$work/witness/$bin"
  remember before "$target/$bin" "$bin"
done

echo "=== phase 3: install $release again, over the install already sitting there ==="
if install_run second; then
  ok "the second install succeeded"
else
  bad "the second install failed"
fi
for bin in $binaries; do
  was_inode="$(recall before inode "$bin")"
  was_hash="$(recall before hash "$bin")"
  now_inode="$(inode_of "$target/$bin")"
  witness_hash="$(hash_of "$work/witness/$bin")"
  if [ "$now_inode" != "$was_inode" ]; then
    ok "$bin is a new inode at the same path ($was_inode -> $now_inode): renamed into place, not written over"
  else
    bad "$bin is still inode $was_inode - the second install wrote into the file the kernel had already execed"
  fi
  if [ "$witness_hash" = "$was_hash" ]; then
    ok "$bin's previous inode still holds the bytes it was execed with; nothing was written through it"
  else
    bad "$bin's previous inode was written through: $was_hash -> $witness_hash"
  fi
done
signatures_valid
links_sane
no_scratch_left "no scratch directories were left behind by the second install"

for bin in $binaries; do
  remember good "$target/$bin" "$bin"
done

probe=0
echo "not a gzip stream, just bytes" > "$work/corrupt.tar.gz"
curl -fsS "file://$work/corrupt.tar.gz" -o "$work/curl-probe" 2>/dev/null || probe=1

if [ "$probe" -eq 0 ]; then
  echo "=== phase 4: a corrupt archive changes nothing ==="
  export CODE_DOWNLOAD_URL="file://$work/corrupt.tar.gz"
  if install_run corrupt; then bad "a corrupt archive was accepted"; else ok "the corrupt archive was refused"; fi
  unset CODE_DOWNLOAD_URL

  echo "=== phase 5: an archive that unpacks but will not run changes nothing ==="
  mkdir -p "$work/fake/code-$platform"
  for bin in $binaries; do
    printf '#!/bin/sh\nexit 3\n' > "$work/fake/code-$platform/$bin"
    chmod 755 "$work/fake/code-$platform/$bin"
  done
  (cd "$work/fake" && tar -czf "$work/wontrun.tar.gz" "code-$platform")
  export CODE_DOWNLOAD_URL="file://$work/wontrun.tar.gz"
  if install_run wontrun; then bad "an archive whose binaries exit 3 was installed anyway"; else ok "the archive that would not run was refused"; fi
  unset CODE_DOWNLOAD_URL

  echo "=== after the refusals ==="
  for bin in $binaries; do
    was_inode="$(recall good inode "$bin")"
    was_hash="$(recall good hash "$bin")"
    if [ "$(inode_of "$target/$bin")" = "$was_inode" ] && [ "$(hash_of "$target/$bin")" = "$was_hash" ]; then
      ok "$bin is exactly the file it was before the refused installs"
    else
      bad "$bin was disturbed by an install that was supposed to have been refused"
    fi
  done
  signatures_valid
  links_sane
  no_scratch_left "no scratch directories were left behind by the refused installs"
else
  echo "=== phases 4 and 5 skipped: this curl will not read file:// URLs ==="
fi

echo
if [ "$status" -ne 0 ]; then
  echo "install swap check FAILED" >&2
else
  echo "install swap check passed"
fi
exit "$status"
