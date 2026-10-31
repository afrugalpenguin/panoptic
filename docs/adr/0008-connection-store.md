# 0008. Encrypted local connection store

- Status: Accepted (amended 2026-10-30 to describe what was built)
- Recorded: 2026-10-29

## Context

Connections must survive reinstalls and move between machines via a dotfiles repo without exposing secrets.

## Decision

Environments, connections, their secrets (SQL login passwords, Cosmos account keys) and app settings are stored together in one file, `%APPDATA%\Panoptic\store.bin`, encrypted as a single blob with DPAPI in CurrentUser scope (`apps/sidecar/Panoptic.Sidecar/ConfigStore.cs`). Every change rewrites the whole file through a temporary file that is then moved into place. Secrets never leave the sidecar: the config the UI receives carries none.

Entra tokens are not in this file. MSAL caches them in the user profile, also DPAPI-encrypted (`Credentials.cs`, ADR 0007).

## Amendment

As first accepted, this ADR put secrets in Windows Credential Manager and included export and import as a single file. Neither was built: secrets live in the same DPAPI-encrypted file as the rest of the store, and there is no export or import of the store.

Export and import move to M4 (plan.md, milestones): a single file holding environments and connections but no secrets, with credentials re-entered or re-acquired on import.

## Consequences

- The store is tied to the Windows user who wrote it. Copying `store.bin` to another machine is not a way to move connections; until M4, the connection importer (SSMS, Azure Data Studio, VS Code) is the only bulk way in.
- Settings and secrets share one file and one write, so they cannot get out of step with the connections they belong to.
