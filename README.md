# Panoptic

[![CI](https://github.com/afrugalpenguin/panoptic/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/afrugalpenguin/panoptic/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/afrugalpenguin/panoptic?sort=semver)](https://github.com/afrugalpenguin/panoptic/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/afrugalpenguin/panoptic/total)](https://github.com/afrugalpenguin/panoptic/releases)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4)
[![License: MIT](https://img.shields.io/github/license/afrugalpenguin/panoptic)](LICENSE)

A fast desktop database client for SQL Server, Azure SQL, Azure Synapse, Cosmos DB and
PostgreSQL. It replaces SSMS for everyday work: one explorer holds every environment at once (dev,
UAT, prod, client sandboxes), with a query editor and results grid hanging off whatever you select.

It aims to do what SSMS does day to day, faster, across engines and environments, rather than
adding features SSMS lacks. Admin surfaces (Agent, security, backup and restore) are out of
scope; SSMS stays the tool for those.

![The explorer with Dev, UAT and Prod expanded, showing SQL Server, Cosmos DB and PostgreSQL connections side by side and a SQL Server database open to its tables](docs/images/readme/explorer.png)

*The explorer: every environment and engine in one tree (sample data).*

## What it does today

- **Explorer.** One tree with every environment, and SQL Server, Azure SQL, Synapse, Cosmos DB and
  PostgreSQL connections side by side. Filter by engine, expand or collapse every environment at
  once, and reorder environments from their right-click menu. Environments are optional: drag a
  connection onto one to group it, or leave it ungrouped.
- **Start page.** Seek finds environments, connections and recent objects from one box (Ctrl+P),
  and Reopen last session picks up where you left off.
- **Query editor.** T-SQL, Cosmos SQL and PostgreSQL, with results streamed into a grid, several
  result sets, messages, an elapsed timer and cancel. Export to CSV or JSON, and Select top 1000
  on any table, view or container.
- **New query before connecting.** Ctrl+N opens a Query N tab you can type into straight away,
  then pick a connection for it.
- **IntelliSense.** Completion and hover for tables, views, columns, procedures and functions, and
  for Cosmos the property paths in each container. Unknown names are underlined before you run.
- **Errors at the right spot.** A failed query marks the bad name in the editor and suggests the
  closest name the database has, with a quick fix.
- **Coming from SQL Server to Postgres.** The PostgreSQL editor flags T-SQL habits such as `TOP`,
  `[brackets]`, `GETDATE()` and `ISNULL` before you run, with a quick fix to the Postgres form.
- **Drag and copy names.** Drag a table, view, column, database or container into the editor to
  insert its name, or use Copy name to put it on the clipboard, quoted the way the engine needs.
- **Cancellable explorer loads.** A slow expand can be stopped with Cancel in the status bar, and
  collapsing a node that is still loading stops it too.
- **Explorer errors inline.** A node that fails to load says why in one line in the tree, in
  plain English for common failures, with the full details in a Problems tab.
- **Read-only environments.** Queries against an environment marked read-only are rolled back, and
  a `COMMIT` in the script stops the run and flags it as committed. On PostgreSQL the server
  refuses every write.
- **Sign-in.** Microsoft Entra (Windows sign-in or device code), SQL login, Windows
  authentication, Cosmos account keys and Postgres username and password. Secrets are stored
  encrypted on your machine.
- **Import.** Saved connections from SSMS, Azure Data Studio and VS Code.
- **Updates.** Panoptic updates itself from GitHub Releases, and a What's new tab shows what
  changed. No telemetry; the update check is the only outbound call.

![A query tab running Select top 1000 against a sample Orders table, with twelve rows in the results grid and a Messages tab](docs/images/readme/query.png)

*Select top 1000 on a table, with results and messages (sample data).*

![The start page with the Seek box empty, listing where you left off, environments and recent objects](docs/images/readme/start.png)

*The start page with nothing typed: Seek, recent objects and quick actions (sample data).*

What comes next is in [docs/plan.md](docs/plan.md) and the
[open issues](https://github.com/afrugalpenguin/panoptic/issues). Decisions are in
[docs/adr/](docs/adr/), each connector is described in [docs/connectors/](docs/connectors/), and
measurements are in [docs/benchmarks.md](docs/benchmarks.md).

Windows only until v1. The stack (Tauri and .NET) can reach Mac and Linux later, but Windows is
the only tested target.

## Install

Download `Panoptic_<version>_x64-setup.exe` from the
[latest release](https://github.com/afrugalpenguin/panoptic/releases/latest) and run it. It
installs per-user into `%LOCALAPPDATA%\Panoptic` with no elevation and updates itself. To run
without installing, unzip `Panoptic_<version>_x64-portable.zip` anywhere and run `panoptic.exe`.

Builds are not code-signed yet. SmartScreen may warn on first install, and Microsoft Defender may
quarantine `panoptic.exe` as `Trojan:Win32/Bearfoos.A!ml`, a false positive on an unsigned file.
Until builds are signed, add a Defender folder exclusion for `%LOCALAPPDATA%\Panoptic` and
reinstall. Details, and how updates are checked, are in [docs/install.md](docs/install.md).

## Develop

Needs Rust (MSVC), Node 24 with pnpm, and the .NET 10 SDK.

```powershell
pnpm install
pnpm dev     # framework-dependent sidecar, Vite dev server
pnpm test    # vitest + sidecar xunit
pnpm build   # self-contained sidecar + release build + installer
```

Locally, `pnpm build` writes the installer to `apps/desktop/src-tauri/target/release/bundle/nsis/`
and then fails at signing the update, because the updater's private key is only in GitHub Secrets
(see Release). The installer it wrote is complete.

The UI is Svelte 5 in a Tauri 2 shell. Data access runs in a .NET 10 sidecar over JSON-RPC on
stdio, because Microsoft.Data.SqlClient and the Cosmos .NET SDK are the mature drivers with
Entra support. Why the sidecar is a self-contained JIT build rather than Native AOT is in
[ADR 0001](docs/adr/0001-stack.md).

## Release

Every merge to `main` releases automatically as `<major>.<minor>.<run number>`; there is no
tag step. To start a new series, bump the minor on a branch with
`.\scripts\set-version.ps1 -Version 0.3.0` and merge it.

Any feat or fix pull request adds a change fragment, `changes/<short-name>.md`, with one
user-facing line starting `Added:`, `Changed:`, `Fixed:` or `Removed:` (CI checks; see
[changes/README.md](changes/README.md)). The release notes, the What's new tab in the app and
`latest.json` are all generated from these fragments (ADR 0013).

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

## License

[MIT](LICENSE)
