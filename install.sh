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

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "joule: fetching $url"
curl -fsSL "$url" -o "$work/code.tar.gz"
tar -xzf "$work/code.tar.gz" -C "$work"

# All three binaries the archive carries, not just the two commands. `joule`
# resolves `joule-daemon` beside its own real path, so an install that dropped
# it had no daemon mode at all. It needs no link of its own; nothing runs it by
# name, and a link here would go stale the next time /update moves the others.
binaries="joule relay joule-daemon"

target="$install_root/$version"
mkdir -p "$target"
for bin in $binaries; do
  cp "$work/code-$platform/$bin" "$target/"
done

# An install is not finished until the binaries start. Anything a release still
# needs and this machine does not have fails here, quoting the loader, instead
# of reporting success over a binary that cannot run (#184). Nothing reaches
# PATH until every one of them has answered.
for bin in $binaries; do
  if ! output="$("$target/$bin" --version 2>&1)"; then
    echo "joule: $bin was unpacked into $target but will not run:" >&2
    printf '%s\n' "$output" | sed 's/^/       /' >&2
    echo "       nothing was linked into $bin_dir." >&2
    echo "       please report this at https://github.com/$repo/issues with the" >&2
    echo "       lines above and the output of 'uname -a'." >&2
    exit 1
  fi
done

mkdir -p "$bin_dir"
ln -sf "$target/joule" "$bin_dir/joule"
ln -sf "$target/relay" "$bin_dir/relay"

echo "joule: installed $("$bin_dir/joule" --version) to $target"
echo "joule: linked $bin_dir/joule and $bin_dir/relay"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "joule: add $bin_dir to your PATH (it isn't on it right now)" ;;
esac
