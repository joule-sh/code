# @joule-sh/code

An agentic coding terminal you can also drive from a web page.

```sh
npm i -g @joule-sh/code
joule
```

The command is `joule`, not `code`: `code` is already VS Code's CLI on most
machines, and this would silently shadow or lose to it depending on `PATH`
order. `relay` is installed alongside it, the same pair
[install.sh](https://github.com/joule-sh/code/blob/main/install.sh) puts on
your `PATH`.

## What this package is

A wrapper. The binary itself lives in a per-platform package that npm installs
as an optional dependency and skips everywhere it does not apply:

| platform | package |
| --- | --- |
| `linux-x64` | `@joule-sh/code-linux-x64` |
| `darwin-x64` | `@joule-sh/code-darwin-x64` |
| `darwin-arm64` | `@joule-sh/code-darwin-arm64` |

Every one of them carries the garbage collector it needs, so there is nothing
to install alongside. The Linux binary is linked statically against musl and
needs nothing at all from the machine it lands on.

**There is no Windows build yet.** Installing here prints a message saying so
and pointing at
[#173](https://github.com/joule-sh/code/issues/173). Until that lands, joule
runs on Windows inside WSL.

## If npm skipped the binary

npm has a [long-standing bug](https://github.com/npm/cli/issues/4828) where it
fails to install the optional dependency it should have. The install step here
falls back to fetching the platform package from the registry itself, so you
should never see it. If you do, any of these fixes it:

```sh
npm install @joule-sh/code-linux-x64
rm -rf node_modules package-lock.json && npm install
JOULE_BINARY_PATH=/path/to/the/binaries joule
```

`JOULE_BINARY_PATH` takes a directory holding `joule`, `relay` and
`joule-daemon`, or the path of one of them, and overrides resolution entirely.

## Elsewhere

- Source, issues and the shell installer:
  <https://github.com/joule-sh/code>
- The VS Code extension: `joule-sh.joule-editor`
