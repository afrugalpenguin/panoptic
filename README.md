# Panoptic

[![CI](https://github.com/afrugalpenguin/panoptic/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/afrugalpenguin/panoptic/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/afrugalpenguin/panoptic?sort=semver)](https://github.com/afrugalpenguin/panoptic/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/afrugalpenguin/panoptic/total)](https://github.com/afrugalpenguin/panoptic/releases)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4)
[![License: MIT](https://img.shields.io/github/license/afrugalpenguin/panoptic)](LICENSE)

A fast desktop database client for SQL Server, Azure SQL, Azure Synapse, Cosmos DB and PostgreSQL. One explorer holds every environment (dev, UAT, prod) and every engine in the same tree, with a query editor and results grid on whatever you select. Admin surfaces such as SQL Agent, security and backup stay in the vendor tools.

Windows only until v1.

## Features

- **Explorer:** every environment and engine in one tree, with engine filters, optional environments and drag to regroup. Slow loads can be cancelled, and failures say why in one line.
- **Seek:** find environments, connections and recent objects from one box (Ctrl+P).
- **Query editor:** T-SQL, Cosmos SQL and PostgreSQL, streamed results, several result sets, cancel, and export to CSV or JSON.
- **IntelliSense:** completion and hover from each database's catalog, unknown names underlined before you run, and errors pinned to the bad name with a suggested fix. The PostgreSQL editor flags T-SQL habits such as `TOP` and `ISNULL`.
- **Read-only environments:** SQL Server queries run in a transaction that is rolled back, and PostgreSQL refuses writes. A guard against mistakes, not a permission boundary ([details](docs/connectors/sql-server.md#read-only-environments)).
- **Sign-in:** Microsoft Entra, SQL and Windows logins, Cosmos keys and Postgres passwords, with secrets encrypted on your machine.
- **Import** connections from SSMS, Azure Data Studio and VS Code.
- **Updates** itself from GitHub Releases, with a What's new tab. No telemetry.

## Install

Download `Panoptic_<version>_x64-setup.exe` from the [latest release](https://github.com/afrugalpenguin/panoptic/releases/latest). It installs per user, needs no admin rights and updates itself. A portable zip is there too.

Builds are not code-signed yet, so SmartScreen may warn and Defender may flag `panoptic.exe` as a false positive. See [docs/install.md](docs/install.md).

## Develop

Needs Rust (MSVC), Node 24 with pnpm, and the .NET 10 SDK.

```powershell
pnpm install
pnpm dev         # Vite dev server with a framework-dependent sidecar
pnpm dev:seeded  # the same, on a separate seeded store (scripts\dev-seeded.ps1)
pnpm test        # svelte-check, vitest and the sidecar's xunit tests
pnpm types       # regenerate the UI's sidecar types after changing a C# record
pnpm build       # release build and installer
```

The UI is Svelte 5 in a Tauri 2 shell; data access runs in a .NET 10 sidecar over JSON-RPC on stdio ([ADR 0001](docs/adr/0001-stack.md)). Local Docker databases for development come from `scripts\dev-db.ps1`.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Decisions are in [docs/adr/](docs/adr/README.md), the plan in [docs/plan.md](docs/plan.md), connectors in [docs/connectors/](docs/connectors/), releases in [docs/release.md](docs/release.md) and measurements in [docs/benchmarks.md](docs/benchmarks.md).

## License

[MIT](LICENSE)

The core is and stays MIT; paid Pro add-ons for team and production use are planned as separate closed packages, see [ADR 0016](docs/adr/0016-open-core.md).
