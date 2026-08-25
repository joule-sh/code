#!/bin/sh
set -eu

repo="joule-sh/code"
version="${CODE_VERSION:-latest}"
install_root="${CODE_INSTALL_ROOT:-$HOME/.joule-code}"
bin_dir="${CODE_BIN_DIR:-$HOME/.local/bin}"

os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Linux-x86_64) platform="x86_64-linux" ;;
  Darwin-arm64) platform="aarch64-macos" ;;
  Darwin-x86_64) platform="x86_64-macos" ;;
  *)
    echo "joule: no release built for $os-$arch yet." >&2
    echo "       built platforms: x86_64-linux, aarch64-macos, x86_64-macos." >&2
    echo "       build from source instead: https://github.com/$repo#build-from-source" >&2
    exit 1
    ;;
esac

if [ -n "${CODE_DOWNLOAD_URL:-}" ]; then
  url="$CODE_DOWNLOAD_URL"
elif [ "$version" = "latest" ]; then
  url="https://github.com/$repo/releases/latest/download/code-$platform.tar.gz"
else
  url="https://github.com/$repo/releases/download/$version/code-$platform.tar.gz"
fi

# All three binaries the archive carries, not just the two commands. `joule`
# resolves `joule-daemon` beside its own real path, so an install that dropped
# it had no daemon mode at all. It needs no link of its own; nothing runs it by
# name, and a link here would go stale the next time /update moves the others.
binaries="joule relay joule-daemon"

target="$install_root/$version"

# Nothing is unpacked, signed or run inside the live install. macOS caches the
# result of validating a signature against the vnode, not the path, so a binary
# written over one the kernel has already execed can be killed on exec even
# though the bytes that landed are validly signed - the failure #235 hits on
# every reinstall on Apple Silicon. Writing a fresh file and renaming a whole
# directory into place gives every binary an inode the kernel has never seen,
# so nothing stale can be held against it. /update has worked this way since
# #201; this is the same move, not a second answer to the same question.
mkdir -p "$install_root"
staging="$(mktemp -d "$install_root/.update-tmp-install-XXXXXX")"
trap 'rm -rf "$staging"' EXIT

echo "joule: fetching $url"
curl -fsSL "$url" -o "$staging/code.tar.gz"
tar -xzf "$staging/code.tar.gz" -C "$staging"
unpacked="$staging/code-$platform"

# On Apple Silicon a binary whose signature is missing, or no longer matches
# the bytes on disk, is not turned away by the loader: the kernel kills it as
# the image is mapped, leaving no message to relay and exit 137 as the only
# evidence (#196). An ad-hoc signature costs nothing - no account, no
# certificate - and one made here is made against the bytes that actually
# landed, so it holds regardless of what the archive, the download or the
# unpacking above did to them. A signature that already verifies is left alone,
# so a sound release is not re-signed on every install.
#
# Apple Silicon only, and that is not a shortcut. An Intel Mac asks for no
# signature at all, and signing there does real harm: the x86_64 binaries the
# backend produces have no room between their load commands and __text, so
# codesign adds LC_CODE_SIGNATURE by writing over the first function in the
# code section and hands back a binary that verifies and then faults (#255,
# lumen-lang-org/lumen#43). Signing an Intel install would break the very
# binaries it was meant to protect, so this leaves them as they came.
if [ "$os" = "Darwin" ] && [ "$arch" = "arm64" ]; then
  for bin in $binaries; do
    if codesign --verify --strict "$unpacked/$bin" >/dev/null 2>&1; then
      continue
    fi
    if ! signing="$(codesign --sign - --force "$unpacked/$bin" 2>&1)"; then
      echo "joule: $bin has no valid code signature and signing it here failed:" >&2
      printf '%s\n' "$signing" | sed 's/^/       /' >&2
      echo "       the check below decides whether it can still be installed." >&2
    fi
  done
fi

# An install is not finished until the binaries start. Anything a release still
# needs and this machine does not have fails here, quoting the loader, instead
# of reporting success over a binary that cannot run (#184). Nothing is put in
# place and nothing reaches PATH until every one of them has answered, so a
# release that will not run leaves whatever was installed before it working.
#
# A binary the kernel killed on exec answers with nothing at all, so the status
# has to carry the report on its own; printing an empty reason is how this last
# arrived as three unrelated silent failures (#196).
for bin in $binaries; do
  status=0
  output="$("$unpacked/$bin" --version 2>&1)" || status=$?
  if [ "$status" -ne 0 ]; then
    echo "joule: $bin came out of $url but will not run:" >&2
    if [ -n "$output" ]; then
      printf '%s\n' "$output" | sed 's/^/       /' >&2
    else
      echo "       it exited $status without printing anything." >&2
    fi
    if [ "$status" -eq 137 ]; then
      echo "       137 is SIGKILL on exec, which on Apple Silicon means the" >&2
      echo "       kernel refused the binary's code signature." >&2
    fi
    echo "       nothing was installed into $target and nothing was linked" >&2
    echo "       into $bin_dir, so an install already here still works." >&2
    echo "       please report this at https://github.com/$repo/issues with the" >&2
    echo "       lines above and the output of 'uname -a'." >&2
    exit 1
  fi
done

# Two renames, and a way back from the second one. The install that was here is
# moved aside rather than deleted, so if putting the new one in place fails it
# goes straight back and the machine is left with the install it started with
# (#187). The old directory then dies with the scratch directory it was moved
# into, which is what breaks the association the kernel was holding on to.
previous=""
if [ -e "$target" ]; then
  previous="$staging/previous"
  mv "$target" "$previous"
fi
if ! mv "$unpacked" "$target"; then
  if [ -n "$previous" ]; then
    mv "$previous" "$target"
    echo "joule: could not move the new install into $target." >&2
    echo "       the install that was already there was put back and nothing" >&2
    echo "       was relinked, so it still works." >&2
  else
    echo "joule: could not move the new install into $target." >&2
    echo "       nothing was linked into $bin_dir." >&2
  fi
  exit 1
fi

# Each link is made beside the one it replaces and renamed over it, the way
# /update does it (#201), so the name never spends a moment pointing at nothing
# for anything else that is looking at it.
mkdir -p "$bin_dir"
for bin in joule relay; do
  staged="$bin_dir/$bin.install-staging"
  rm -f "$staged"
  ln -s "$target/$bin" "$staged"
  mv -f "$staged" "$bin_dir/$bin"
done

echo "joule: installed $("$bin_dir/joule" --version) to $target"
echo "joule: linked $bin_dir/joule and $bin_dir/relay"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "joule: add $bin_dir to your PATH (it isn't on it right now)" ;;
esac
