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

target="$install_root/$version"
mkdir -p "$target"
cp "$work/code-$platform/joule" "$work/code-$platform/relay" "$target/"

# The macOS builds carry their own copy of the Boehm collector and load it from
# @executable_path, so it has to land beside the binaries. Linux archives have
# no such file and this loop does nothing there.
for lib in "$work/code-$platform"/*.dylib; do
  if [ -e "$lib" ]; then
    cp "$lib" "$target/"
  fi
done

mkdir -p "$bin_dir"
ln -sf "$target/joule" "$bin_dir/joule"
ln -sf "$target/relay" "$bin_dir/relay"

echo "joule: installed to $target"
echo "joule: linked $bin_dir/joule and $bin_dir/relay"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) echo "joule: add $bin_dir to your PATH (it isn't on it right now)" ;;
esac

"$bin_dir/joule" --version
