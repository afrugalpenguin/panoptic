# Panoptic

[![CI](https://github.com/afrugalpenguin/panoptic/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/afrugalpenguin/panoptic/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/afrugalpenguin/panoptic?sort=semver)](https://github.com/afrugalpenguin/panoptic/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/afrugalpenguin/panoptic/total)](https://github.com/afrugalpenguin/panoptic/releases)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4)
[![License: MIT](https://img.shields.io/github/license/afrugalpenguin/panoptic)](LICENSE)

A fast desktop database client for SQL Server, Azure SQL, Azure Synapse and Cosmos DB. It
replaces SSMS for everyday work: one explorer holds every environment at once (dev, UAT, prod,
client sandboxes), with a query editor and results grid hanging off whatever you select.

It aims to do what SSMS does day to day, faster, across engines and environments, rather than
adding features SSMS lacks. Admin surfaces (Agent, security, backup and restore) are out of
scope; SSMS stays the tool for those.

## What it does today

- **Explorer.** An environment-first tree with SQL Server, Azure SQL, Synapse and Cosmos DB
  side by side under the same node shape. It loads lazily, has environment groups and kind
  filter chips, and is virtualised so large servers stay responsive.
- **Query editor.** Monaco with T-SQL and Cosmos SQL. Results stream into a virtualised grid,
  with multiple result sets, messages, an elapsed timer and cancel. Export to CSV or JSON.
  Select top 1000 on any table, view or container.
- **Read-only environments.** Queries against an environment marked read-only run in a
  transaction that is always rolled back.
- **Sign-in.** Microsoft Entra (Windows account broker or device code), SQL login, Windows
  authentication and Cosmos account keys. Secrets are stored encrypted on your machine.
- **Import.** Saved connections from SSMS, Azure Data Studio and VS Code.
- **Updates.** The installer updates itself from GitHub Releases, and a What's new tab shows
  what changed. No telemetry; the update check is the only outbound call.

Next up (M3): filtering inside a subtree, a Ctrl+P palette across every loaded node, Script as
CREATE and Open definition. v1 is planned for the end of March 2027. See
[docs/plan.md](docs/plan.md) for the plan, [docs/adr/](docs/adr/) for decisions,
[docs/connectors/](docs/connectors/) for each connector and
[docs/benchmarks.md](docs/benchmarks.md) for measurements.

Windows only until v1. The stack (Tauri and .NET) can reach Mac and Linux later, but Windows is
the only tested target.

## Install

Download `Panoptic_<version>_x64-setup.exe` from the
[latest release](https://github.com/afrugalpenguin/panoptic/releases/latest) and run it. It
installs per-user into `%LOCALAPPDATA%\Panoptic` with no elevation. To run without installing,
unzip `Panoptic_<version>_x64-portable.zip` anywhere and run `panoptic.exe`.

Builds are not code-signed yet, so SmartScreen warns on first install (More info, Run anyway).
Installed copies check for updates on launch and offer "Restart to update". Settings can switch
that to hourly or turn automatic checks off. The portable build tells you when a new version
exists.

## Develop

Needs Rust (MSVC), Node 24 with pnpm, and the .NET 10 SDK.

```powershell
pnpm install
pnpm dev     # framework-dependent sidecar, Vite dev server
pnpm test    # vitest + sidecar xunit
pnpm build   # self-contained sidecar + release build + installer
```

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

## License

[MIT](LICENSE)
