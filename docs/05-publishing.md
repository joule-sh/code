# Publishing the editor extension (#175)

Everything in this file is a thing a person has to do by hand, once. The
repository is already wired: the `publish` job in `.github/workflows/release.yml`
runs `scripts/publish_editor.mjs` after every release, and that script publishes
the `.vsix` the release already carries to whichever registries it finds a token
for. With no tokens it prints two lines saying so and exits 0, which is what
happens on every release today.

So there is no code change at the end of this. Adding the two secrets is the
whole switch.

**Two secrets, named exactly:**

| secret | registry | who reads it |
| --- | --- | --- |
| `VSCE_PAT` | Visual Studio Marketplace | `@vscode/vsce` |
| `OVSX_PAT` | Open VSX | `ovsx` |

Both are read from the environment by the tools themselves. Neither is ever
passed on a command line, written to a file, or printed.

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

# 3. Verifying a release published

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

# 4. Taking a bad version back

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
