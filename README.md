# joule

An AI coding agent that runs in your terminal and can be driven from a browser.

Pre-1.0. The install below gets the latest release.

## Install

```sh
npm i -g @joule-sh/code
```

or, with no Node on the machine:

```sh
curl -fsSL https://raw.githubusercontent.com/joule-sh/code/main/install.sh | sh
```

Both put `joule` and `relay` on your `PATH` at the same version, and both run
every binary before reporting success. npm pins and uninstalls cleanly; the
script needs nothing installed first. `install.sh` covers Linux and macOS only,
so npm is the way in on Windows - that, or the `code-x86_64-windows.zip` a
release publishes.

Prebuilt for x86_64 Linux, Apple Silicon macOS, Intel macOS and x86_64 Windows.
Other platforms fail with a message naming the platform. A Linux binary is
linked statically against musl, so it runs the same on Ubuntu 22.04, on a
decade-old enterprise release and on Alpine.

It installs as `joule`, not `code` - `code` is already VS Code's CLI on most
machines. Either install notices a newer release and offers to install it in
place; there is no update command.

## Start it

Run `joule` in a directory you want to work in. It reads and edits files, runs
commands and makes commits there, on your machine.

`/help` lists the commands. `joule --continue` reopens the most recent session
for the current directory.

## Connect a model

Pick one:

- `/login` signs in to joule.sh through a browser, or to a server you name.
- `baseUrl` and `apiKey` in `~/.config/joule-code/config.json` use a model you
  already pay for. `JOULE_CODE_BASE_URL` and `--model` override per run.
- `--server`, or `JOULE_CODE_SERVER`, points at your own Joule server.

## The editor extension

`joule-sh.joule-editor` on the [Visual Studio
Marketplace](https://marketplace.visualstudio.com/items?itemName=joule-sh.joule-editor),
or the `.vsix` every release attaches. Not on Open VSX.

It drives the same session the terminal does rather than carrying an agent of
its own, so install `joule` first. [editor/README.md](editor/README.md) has the
settings and the Windows notes.

## Share it to a browser

`/share` prints a URL and a six-character code, and the session shows up in the
console as a conversation you can read and reply in from any browser. The
browser is a remote control - it never executes anything.

A console signed in to the account that shared it needs no code. Anybody else
needs the one printed on the terminal.

## Docs

- [docs/00-plan.md](docs/00-plan.md): architecture, the decisions and what
  forced them.
- [docs/07-building.md](docs/07-building.md): building from source.
- [docs/06-selection.md](docs/06-selection.md): mouse selection and copy.
- [specs/](specs/): one directory per decided piece.
