# Publishing (#175, #174)

Everything in this file is a thing a person has to do by hand, once: the editor
extension to two marketplaces (part one), and the CLI to npm (part two).

The repository is already wired for both. Two jobs in
`.github/workflows/release.yml` run after every release, each publishing an
artifact the release already carries to whichever registry it finds a token
for. With no tokens they print a line saying so and exit 0, which is what
happens on every release today.

So there is no code change at the end of any of this. Adding the secrets is the
whole switch.

**Three secrets, named exactly:**

| secret | registry | who reads it |
| --- | --- | --- |
| `VSCE_PAT` | Visual Studio Marketplace | `@vscode/vsce` |
| `OVSX_PAT` | Open VSX | `ovsx` |
| `NPM_TOKEN` | npm | `npm publish` |

All three are read from the environment by the tools themselves. None is ever
passed on a command line, written to a file, or printed.

---

# Part one: the editor extension (#175)

## What the workflow does with them

- It publishes **the exact `.vsix` attached to the release**, downloaded as the
  build artifact. It never repackages, so what a marketplace serves is byte for
  byte what the GitHub release carries.
- It only runs for tags shaped `vMAJOR.MINOR.PATCH`. A pre-release tag
  publishes nowhere: neither registry has a notion of a pre-release that is not
  also the version everybody gets, and `vsce` refuses a semver prerelease
  outright.
- It runs after the GitHub release exists, in its own job, so a registry being
  down or a token being expired cannot cost you the release.
- A registry with no token is skipped with a log line naming the missing
  secret. A registry that fails is a failed job, and the other registry is
  still attempted, so a half-published release says which half.
- `--skip-duplicate` means re-running the job for a version already on a
  registry is a no-op rather than an error.

---

# 1. The Visual Studio Marketplace

## 1.1 An Azure DevOps organisation

The marketplace publisher is backed by an Azure DevOps organisation, and the
token comes from there.

1. Sign in to <https://dev.azure.com> with the Microsoft account that should
   own this. Use an account the project will still have in two years, not a
   personal one that happens to be logged in.
2. If you have no organisation, create one. Its name does not matter and is
   not shown anywhere on the listing.

## 1.2 The publisher

1. Go to <https://marketplace.visualstudio.com/manage>.
2. **Create publisher**.
3. **ID: `joule-sh`.** This is the part that must be exact. It has to equal
   the `publisher` field in `editor/package.json`, which is `joule-sh`, and it
   **cannot be changed after creation**. Getting it wrong means creating a
   second publisher and abandoning the first. The extension will be served at
   `https://marketplace.visualstudio.com/items?itemName=joule-sh.joule-editor`.
4. Name: `Joule`. This one is a display name and can be changed later.

## 1.3 The token

This is the step people get wrong, in one specific way.

1. In Azure DevOps, top right, **User settings > Personal access tokens**, or
   go to `https://dev.azure.com/<your-org>/_usersSettings/tokens`.
2. **New Token.**
3. **Organization: `All accessible organizations`.** Not your organisation.
   This is the mistake. A token scoped to a single organisation authenticates
   fine and then fails to publish with a `401` or an "access denied", because
   the marketplace is not inside your organisation. There is no error message
   that tells you this is what you did.
4. **Scopes: `Custom defined`**, then find **Marketplace** and tick
   **`Manage`**. Nothing else. Do not use `Full access`.
5. **Expiration.** The maximum is one year. Take it, and put the expiry date
   in a calendar. A shorter expiry is not more secure here, it just brings the
   day the publish step starts failing closer.
6. Copy the token. The page shows it once.

**When it expires**: the `publish` job fails with an authentication error on
the next release. The release itself, the tarballs and the `.vsix` are all
unaffected, because publishing is a separate job downstream of the release.
The fix is to generate a new token the same way and overwrite the secret; then
re-run the failed job, or let the next release carry it.

Check the token before you trust it, without storing it anywhere:

```sh
VSCE_PAT=<the token> npx --yes @vscode/vsce@3.6.0 verify-pat joule-sh
```

Do not use `vsce login`: it keeps the token in a local credential store, which
is one more copy of it than needs to exist.

## 1.4 The secret

1. `https://github.com/joule-sh/code/settings/secrets/actions`
2. **New repository secret.**
3. Name: **`VSCE_PAT`**, exactly. Value: the token.

---

# 2. Open VSX

Open VSX is the registry VSCodium, Cursor, Windsurf, Gitpod, Eclipse Theia and
every other non-Microsoft build of VS Code resolves extensions from. They
cannot install from the Microsoft marketplace at all - its terms do not allow
it - so skipping this registry is not a smaller audience, it is those users
having no way to install the extension.

## 2.1 An Eclipse account, and the publisher agreement

1. Create an account at <https://accounts.eclipse.org/user/register>.
2. Fill in the **GitHub Username** field of the Eclipse profile. Open VSX
   matches your Eclipse account to your GitHub login through it, and a blank
   field blocks the next step with an unhelpful message.
3. Sign the **Eclipse Publisher Agreement**: log in to
   <https://open-vsx.org> with GitHub, open your profile settings, and accept
   it there. Publishing without it fails, whatever the token says.

## 2.2 The token

1. <https://open-vsx.org/user-settings/tokens>
2. **Generate new token**, give it a description.
3. Copy it. Shown once, like the other one.

Open VSX tokens do not expire on a schedule.

## 2.3 The namespace - the other thing people get wrong

A namespace on Open VSX is not created by publishing. It has to exist first,
and it has to be **claimed** to be worth anything.

1. Create it:

   ```sh
   npx --yes ovsx@1.1.1 create-namespace joule-sh -p <the token>
   ```

   Without this, the first publish fails with `Unknown namespace: joule-sh`.

2. **Claim it.** A namespace you created but have not claimed is *unverified*,
   and every extension published into it carries a warning triangle on its
   listing telling users the publisher is not verified. Claiming it is a
   manual review: open an issue on
   <https://github.com/EclipseFdn/open-vsx.org/issues> using the **namespace
   ownership claim** template, naming `joule-sh` and linking
   <https://github.com/joule-sh/code>. It is answered by a human, so do it
   before the first release you care about rather than after.

Check the token and the namespace together:

```sh
npx --yes ovsx@1.1.1 verify-pat joule-sh -p <the token>
```

## 2.4 The secret

Same page as before. Name: **`OVSX_PAT`**, exactly.

---

# 3. Verifying the extension published

Tag a release the way you always do. Then:

1. **The workflow.** The `publish` job in the release run has a summary table
   naming each registry and whether it was published, skipped or failed. A
   skipped registry says which secret was missing.
2. **The marketplace**, a minute or two later:

   ```sh
   npx --yes @vscode/vsce@3.6.0 show joule-sh.joule-editor
   ```

   and <https://marketplace.visualstudio.com/items?itemName=joule-sh.joule-editor>.
   The first publish takes longer than later ones - the listing is scanned
   before it appears.
3. **Open VSX**: <https://open-vsx.org/extension/joule-sh/joule-editor>.
4. **An actual install**, which is the only check that covers the artifact
   rather than the upload:

   ```sh
   code --install-extension joule-sh.joule-editor
   ```

## The listing page

`editor/README.md` is the listing, rendered as the page body. It is the first
thing anyone deciding whether to install reads, so treat a change to it as a
change to the product, not to a readme. `editor/media/icon.png` is the tile.
Neither can be edited on the marketplace: both ship inside the `.vsix`, so
correcting a typo on the listing means cutting a release.

# 4. Taking a bad extension version back

There is no undo that removes a version from the machines that already have
it. In order of what actually helps:

1. **Publish a fixed patch version.** This is the real remedy on both
   registries: every client updates to the newest version, so a bad `0.19.0`
   stops mattering the moment `0.19.1` is up. It is also the only remedy Open
   VSX gives you, which has no self-serve deletion at all - removing something
   there is a request to the Eclipse team through
   <https://github.com/EclipseFdn/open-vsx.org/issues>.
2. **Delete the version on the marketplace**, from
   <https://marketplace.visualstudio.com/manage>: the extension's
   **More actions > Reports**, then the version's delete action. A deleted
   version number cannot be published again, so the fix after deleting
   `0.19.0` is `0.19.1`, never `0.19.0` a second time.
3. **Unpublish the whole extension**, if it should not be installable at all:

   ```sh
   VSCE_PAT=<the token> npx --yes @vscode/vsce@3.6.0 unpublish joule-sh.joule-editor
   ```

   This takes down every version and the listing with it. It is a last resort:
   ratings and install counts do not come back.

Whatever you do here, do the same to the GitHub release - the `.vsix` attached
to it is the other way people install.

# 5. A note on the Azure token, later

Microsoft is retiring global Azure DevOps personal access tokens on
**1 December 2026**, in favour of publishing with a Microsoft Entra ID
workload identity from the workflow itself, which `vsce` already supports
through `--azure-credential`. That would replace `VSCE_PAT` with a federated
login and no stored secret at all. It is worth doing before the deadline
rather than on it; nothing in the current setup needs to change until then.

---

# Part two: the CLI on npm (#174)

`npm i -g @joule-sh/code` instead of piping a shell script from a URL.

## 6. What gets published, and in what order

Five packages per release, all at the same version, which is the git tag with
its `v` removed - the same single source of truth the `.vsix` and
`src/version.ts` already use. Nothing in the tree carries a version by hand;
`scripts/package_npm.mjs` writes every manifest from the tag.

| package | what is in it |
| --- | --- |
| `@joule-sh/code-linux-x64` | `joule`, `relay`, `joule-daemon` from `code-x86_64-linux.tar.gz` |
| `@joule-sh/code-darwin-x64` | the same three from `code-x86_64-macos.tar.gz` |
| `@joule-sh/code-darwin-arm64` | the same three from `code-aarch64-macos.tar.gz` |
| `@joule-sh/code-win32-x64` | `joule.exe`, `relay.exe`, `joule-daemon.exe` from `code-x86_64-windows.zip` |
| `@joule-sh/code` | the wrapper: no binary, a `bin` for `joule` and `relay`, and the four above as `optionalDependencies` |

Each platform package carries `os` and `cpu`, so npm silently skips the ones
that do not match. On every platform but Windows, the wrapper's install step
points `joule` and `relay` straight at the binaries in whichever platform
package did get installed, so no node process sits in front of the terminal
and `joule-daemon` is still beside `joule`'s real path, which is how `joule`
finds it. Windows never gets that symlink: npm's own generated `joule.cmd`
always launches `bin/joule` through `node`, so that file has to stay the JS
shim, and creating a filesystem symlink on Windows needs a privilege an
ordinary `npm install -g` cannot assume it has. The shim instead resolves
`joule.exe` at every run, which is the same fallback the other platforms use
when they have no linked binary yet.

**The platform packages are published before the wrapper, always.** The
wrapper names them as `optionalDependencies`, and an optional dependency npm
cannot find is one it skips rather than an error - so a wrapper published first
is a version that installs cleanly and then has no binary. If a platform
package fails to publish, the job holds the wrapper back and fails, saying
which one. That leaves the release with no wrapper version at all, which is the
recoverable failure: fix the cause and re-run the job, and it skips whatever is
already on the registry and publishes the rest. The other order leaves a
version that is permanently broken for one platform, and npm only lets you
take a version back within 72 hours.

## 7. The npm account, the org, and the names

1. Sign in at <https://www.npmjs.com>, with an account the project will still
   have in two years. Turn on two-factor authentication.
2. The **`joule-sh` org** has to exist and own the packages:
   <https://www.npmjs.com/org/create>. A free org can only hold public
   packages, which is all this needs.
3. **Nothing needs reserving in advance.** All five names are unclaimed, and
   the first publish creates each one. What matters is that the account
   publishing them is a member of `joule-sh` with write access. `joule`
   unscoped is somebody else's package, which is the reason the scope is not
   optional here.

**A scoped package is private by default.** Publishing without saying otherwise
either fails with `402 Payment Required` on a free account or quietly publishes
a package nobody else can install. Both manifests carry
`"publishConfig": {"access": "public"}` and the workflow passes `--access
public` as well, so this is already handled - but it is the single most common
way a first scoped publish goes wrong, and worth recognising if it does.

## 8. The token

A 2FA account cannot publish from CI with an ordinary login, so the token has
to be one of the two kinds that carry their own authority.

1. <https://www.npmjs.com/settings/~/tokens>, **Generate New Token**.
2. **Granular Access Token** is the one to use. Set:
   - **Expiration**: up to 365 days. Take the maximum and put the date in a
     calendar, the same as the Azure one.
   - **Packages and scopes**: *Read and write*, and select the **`joule-sh`**
     scope rather than individual packages, so it can create the five packages
     on the first publish and any later platform package without being reissued.
   - **Organizations**: `joule-sh`, read only. Publishing does not need more.
   - Leave the IP allow list empty unless the runner has a fixed address.
3. Copy it. The page shows it once.

A **Classic Automation token** also works and never expires, which is the
argument for it; it is also unscoped, so it can publish anything the account
can. Prefer the granular one.

Check the token before you trust it, without storing it anywhere:

```sh
NPM_TOKEN=<the token> npm whoami \
  --registry https://registry.npmjs.org/ \
  --//registry.npmjs.org/:_authToken='${NPM_TOKEN}'
```

Do not use `npm login`: it writes the token to `~/.npmrc`, which is one more
copy of it than needs to exist. The workflow does not either - it writes an
npmrc holding the literal string `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`
and lets npm expand it from the environment, then deletes it.

**The secret**: `https://github.com/joule-sh/code/settings/secrets/actions`,
**New repository secret**, name **`NPM_TOKEN`** exactly.

**When it expires**: the `publish-npm` job fails with a `401` on the next
release. The release itself, the tarballs and the `.vsix` are unaffected,
because publishing is a separate job downstream of the release. Generate a new
token, overwrite the secret, and re-run the failed job.

## 9. Verifying an npm publish

1. **The workflow.** The `publish-npm` job has a summary table naming each
   package and whether it was published, skipped, already present or held
   back.
2. **The registry**, within a minute:

   ```sh
   npm view @joule-sh/code version
   npm view @joule-sh/code optionalDependencies
   npm view @joule-sh/code-linux-x64 version
   ```

   The four optional dependencies must all be pinned to the version you just
   published. If one is missing from the registry, the wrapper should never
   have gone out - say so on #174 rather than patching around it.
3. **An actual install**, which is the only check that covers the artifact
   rather than the upload. Do it somewhere disposable:

   ```sh
   npm i -g --prefix "$(mktemp -d)" @joule-sh/code
   ```

   then run the `joule` it put in that prefix's `bin` and check `--version`
   matches the tag. The install step already runs all three binaries before it
   links anything, so an install that reports success is one that runs.
4. **On a Mac**, once, after the first publish:

   ```sh
   codesign --verify --strict --verbose=2 \
     "$(dirname "$(readlink -f "$(command -v joule)")")/joule"
   ```

   `npm pack` is a gzipped tar and `npm install` restores the bytes exactly, so
   the ad-hoc signature the release applies survives untouched - the signature
   is inside the Mach-O, and there is nothing beside the file for packing to
   lose. The install step verifies it anyway and re-signs if it does not hold,
   the way `install.sh` does.

   Reinstalling over an existing install is not the hazard here that it is for
   `install.sh` (#235). The kernel caches a signature against the vnode rather
   than the path, and npm extracts a new file rather than writing over the one
   already there, so nothing is ever execed through a vnode the kernel has
   already made up its mind about.

## 10. Taking a bad npm version back

npm is less forgiving than either extension marketplace. In order of what
actually helps:

1. **Publish a fixed patch version.** As with the extension, this is the real
   remedy: `npm i -g @joule-sh/code` takes the newest version, so a bad
   `0.19.0` stops mattering the moment `0.19.1` is up.
2. **`npm deprecate`**, which leaves the version installable but makes npm
   print your message whenever anyone resolves it:

   ```sh
   npm deprecate @joule-sh/code@0.19.0 "0.19.0 will not start on macOS; use 0.19.1"
   ```

   Deprecate the wrapper version, not the platform packages - the wrapper is
   what people install, and a warning on a package nobody names is a warning
   nobody sees. `npm deprecate @joule-sh/code@0.19.0 ""` undoes it.
3. **`npm unpublish`, within 72 hours of the publish and not after.**

   ```sh
   npm unpublish @joule-sh/code@0.19.0
   ```

   Past 72 hours npm refuses unless the version has no dependents and almost no
   downloads, and then it is a support request rather than a command. Two
   things about it that are easy to get wrong:

   - **Unpublish the wrapper before the platform packages, never the other way
     round.** A platform package removed from under a wrapper that is still
     published turns every install of that version into a broken one.
   - **A version number cannot be published again once it has been
     unpublished.** The fix after unpublishing `0.19.0` is `0.19.1`, never
     `0.19.0` a second time. This is why the workflow refuses to publish the
     wrapper when a platform package has not gone out: it keeps the mistake in
     the recoverable half of that rule.

Whatever you do here, do the same to the GitHub release, and check whether
`install.sh` still points at the same version - two install paths that can
produce different versions is its own bug.

## 11. Once the first publish is out

The install instructions in `joule-sh/console` (`docs/code/install.md`) say
there is no npm package. They will be wrong from the first publish, and those
pages have gone stale twice already. Update them in the same sitting.
