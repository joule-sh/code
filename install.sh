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
  *)
    echo "code: no release built for $os-$arch yet (only x86_64-linux so far)." >&2
    echo "      build from source instead: https://github.com/$repo#build-from-source" >&2
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

echo "code: fetching $url"
curl -fsSL "$url" -o "$work/code.tar.gz"
tar -xzf "$work/code.tar.gz" -C "$work"

target="$install_root/$version"
mkdir -p "$target"
cp "$work/code-$platform/code" "$work/code-$platform/relay" "$target/"

mkdir -p "$bin_dir"
ln -sf "$target/code" "$bin_dir/code"
ln -sf "$target/relay" "$bin_dir/relay"

echo "code: installed to $target"
echo "code: linked $bin_dir/code and $bin_dir/relay"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "code: add $bin_dir to your PATH (it isn't on it right now)" ;;
esac

if command -v code >/dev/null 2>&1; then
  first="$(command -v code)"
  if [ "$first" != "$bin_dir/code" ]; then
    echo "code: warning, a different 'code' is first on your PATH ($first)." >&2
    echo "      that is very likely VS Code's CLI, not this. run $bin_dir/code directly," >&2
    echo "      or reorder PATH, to avoid ambiguity." >&2
  fi
fi

"$bin_dir/code" --version
