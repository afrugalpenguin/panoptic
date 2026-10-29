# 0010. Per-user MSI with auto-update from GitHub Releases

- Status: Accepted
- Date: 2026-10-29

## Context

The work laptop is the real test bed for Entra, Intune and real data. Copying MSIs by hand after every build would stop it being used daily. This was planned for M5 and moved to M0.

## Decision

A tag-triggered GitHub Actions workflow builds a per-user (no elevation) MSI and publishes it with an updater manifest to GitHub Releases. The Tauri updater plugin checks on launch and installs in place. Update payloads are signed with a Tauri updater key held in GitHub Secrets.

## Consequences

Losing the updater private key strands installed copies, so it is backed up outside GitHub. The update check is the one sanctioned outbound call.
