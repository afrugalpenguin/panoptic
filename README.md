# Panoptic

A native, instant-start object explorer that holds every environment at once:
dev, UAT, prod and client sandboxes, SQL Server and Cosmos DB side by side,
with the same node shape all the way down.

Status: M0 (measurement). Nothing usable yet. See [docs/plan.md](docs/plan.md)
for the build plan and [docs/adr/](docs/adr/) for decisions.

Windows only until v1.

## Install

Download `Panoptic_<version>_x64-setup.exe` from the
[latest release](https://github.com/afrugalpenguin/panoptic/releases/latest) and run it.
It installs per-user into `%LOCALAPPDATA%\Panoptic` with no elevation. Builds are not
code-signed yet, so SmartScreen warns on first install (More info, Run anyway).
Installed copies check GitHub Releases on launch and offer "Restart to update". Settings can switch
that to hourly or turn automatic checks off completely.

## Develop

Needs Rust (MSVC), Node 24 with pnpm, and the .NET 10 SDK.

```powershell
pnpm install
pnpm dev     # framework-dependent sidecar, Vite dev server
pnpm test    # vitest + sidecar xunit
pnpm build   # Native AOT sidecar + release build + installer
```

## Release

Every merge to `main` releases automatically as `<major>.<minor>.<run number>`; there is no
tag step. To start a new series, bump the minor on a branch with
`.\scripts\set-version.ps1 -Version 0.3.0` and merge it.

The Release workflow builds the installer and portable zip, signs the update with the updater key
in GitHub Secrets and publishes `latest.json`. The private key lives outside the repo; if it
is lost, installed copies can no longer update.

## License

MIT
