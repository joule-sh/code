# Joule Code: Always-on agents

The editor panel: an agentic coding session in a side panel, driven by the
`joule` you already run in a terminal. The agent reads and edits the files in
your workspace, runs commands and makes commits **on your own machine**. The
panel is a front end to a local daemon, not a hosted service and not a second
agent.

A terminal and this panel can drive the same session at the same time. Change
the model or the approval mode in either one and the other moves with it.

## Before you install: this needs the joule CLI

The extension does not carry an agent. It starts and attaches to a `joule`
daemon, so the binary has to be on the machine the workspace is on:

```sh
curl -fsSL https://raw.githubusercontent.com/joule-sh/code/main/install.sh | sh
```

That installs `joule` for x86_64 Linux, Apple Silicon macOS and Intel macOS.
On Windows, install from npm with `npm install -g @joule-sh/code`, or take
the `code-x86_64-windows.zip` a release publishes. The extension needs **joule
0.13.0 or newer**. If `joule` is not on `PATH`, point
[`joule.path`](#settings) at it.

Credentials stay with the CLI. The panel never asks for an API key, never
reads one, and never forwards one.

## Windows

**The panel drives a Windows joule the same way it drives a Linux one.** An
npm install is found without any setting being pointed at it.

**WSL and Remote-SSH work, and are worth choosing if your files live there.**
Opening a folder through WSL, Remote-SSH or a dev container runs the extension
on the remote side, next to the `joule` and the files that are there.

## What the panel does

**It opens on a first-run screen** when nothing is configured yet: one
sentence on what joule is, and the three ways it can reach a model, each as
its own button: a joule account, your own provider key, or a self-hosted
joule server. A missing `joule`, a `joule` too old to drive, and a configuration
that cannot start a session all land here with a sentence about what to do.

**An API key is never typed into the panel.** The provider-key route opens
`~/.config/joule-code/config.json` in the editor and says so. The extension
reads that file only to answer "is there a key here", never its value, and
writes nothing to it but a server address you asked it to remember.

**Approvals are cards, not prompts in a scrollback.** When the agent wants to
run a command or write a file that the current mode does not allow on its
own, the panel shows what it wants to do and where it will run, and waits.

**The composer carries the session's controls.** A chip row names the file
open beside the panel, which is what will be quoted at the top of your
message and can be dismissed with a click. Below the input, the approval mode
and the model sit as chips, with a line saying where tools will run and what
this mode lets through without asking.

**It attaches, resumes and reconnects.** Close the window and the daemon keeps
working; open it again and the panel picks the session back up.

## Getting started

1. Install `joule` (above) and run it once in a terminal to sign in or point
   it at a provider.
2. Open a folder in your editor. The session opens in a tab beside your code,
   without taking focus from the file you opened.
3. Press **Attach**.

Close that tab and the joule icon in the activity bar, on the left, is still
the way back to the session, as is **Joule: Open the session in an editor
tab** and the button in the view's own title bar. Set
`joule.openInEditorTab` to `false` if you would rather the editor area stayed
yours and the session lived in the activity bar.

Attaching is deliberately a button rather than something that happens on
open: a workspace's daemon may already be driven from a terminal, and joining
it is a decision you make. Set `joule.attachOnStartup` if you would rather it
happen every time.

## Settings

| setting | default | what it does |
| --- | --- | --- |
| `joule.path` | `joule` | the binary the daemon is started and stopped through |
| `joule.openInEditorTab` | `true` | open the session in an editor tab beside your code when the window opens |
| `joule.attachOnStartup` | `false` | attach as soon as the window opens, instead of waiting for the button |
| `joule.resumeOnStart` | `false` | when this window starts the daemon, resume the folder's previous session |

`joule.path` must be the same install a terminal would use: the daemon is
started and stopped through it.

## Commands

| command | what it does |
| --- | --- |
| `Joule: Open the session in an editor tab` | open the tab beside your code, or reveal the one already open |
| `Joule: Attach to this workspace's session` | start or join the daemon for this folder |
| `Joule: Detach from the session` | leave the session running and stop rendering it |
| `Joule: Cancel the current turn` | stop the agent mid-turn |
| `Joule: Stop this workspace's daemon` | shut the daemon down |

## Versions, and what happens when they disagree

The extension and the CLI are cut from the same tag, so an extension and a
binary carrying the same version are the pair that was tested together.
Attaching runs `joule --version` first and refuses to go further when the
binary is missing, is not a joule, or is older than **0.13.0**, the oldest
release this panel can drive. You get one sentence in the panel saying so,
rather than a session that fails part-way through. A binary built from a
checkout reports `dev` and is taken at its word.

## Installing without the marketplace

Every release also attaches `joule-editor-<version>.vsix` to
[its GitHub release](https://github.com/joule-sh/code/releases), cut from the
same tag as the binaries:

```sh
code --install-extension joule-editor-<version>.vsix
```

or the Extensions view, through _Install from VSIX_.

## Source and issues

The extension lives in
[`editor/`](https://github.com/joule-sh/code/tree/main/editor) of the
[joule-sh/code](https://github.com/joule-sh/code) repository, MIT licensed.

[Report a bug or ask for something](https://github.com/joule-sh/code/issues)
