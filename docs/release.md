# Releasing Panoptic

Every merge to `main` releases automatically as `<major>.<minor>.<run number>`; there is no
tag step. To start a new series, bump the minor on a branch with
`.\scripts\set-version.ps1 -Version 0.3.0` and merge it.

Any feat or fix pull request adds a change fragment, `changes/<short-name>.md`, with one
user-facing line starting `Added:`, `Changed:`, `Fixed:` or `Removed:` (CI checks; see
[changes/README.md](../changes/README.md)). The release notes, the What's new tab in the app and
`latest.json` are all generated from these fragments ([ADR 0013](adr/0013-changelog.md)).

The Release workflow builds the installer and portable zip, signs the update with the updater key
in GitHub Secrets and publishes `latest.json`. The private key lives outside the repo; if it
is lost, installed copies can no longer update.

Each release is built as a draft and published only as the last step, after
`scripts\check-release-assets.ps1` confirms the setup.exe, its `.sig`, `latest.json` and the
portable zip are all attached. Installed copies update from `releases/latest`, which ignores
drafts, so they never see a half-published release; the tag is created when the draft is
published. A cancelled or failed run leaves an untagged draft. A newer merge does not touch it:
it ships its own version, and the stale draft is inert, so delete it from the Releases page when
convenient. Do not re-run an old cancelled release after a newer one shipped, as publishing it
would make the older version latest.
