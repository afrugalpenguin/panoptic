# 0010. Per-user installer with auto-update from GitHub Releases

- Status: Accepted
- Date: 2026-10-29

## Context

The work laptop is the real test bed for Entra, Intune and real data. Copying installers by hand after every build would stop it being used daily. This was planned for the final milestone and moved to M0.

## Decision

A tag-triggered GitHub Actions workflow builds a per-user NSIS installer (installMode currentUser, installs to %LOCALAPPDATA%, no elevation) and publishes it with an updater manifest to GitHub Releases. The Tauri updater plugin installs in place. How often it checks is a user setting: on startup (the default), hourly, or never, where never means no automatic calls to GitHub at all. A manual Check now stays available in Settings. Update payloads are signed with a Tauri updater key held in GitHub Secrets.

Amended 2026-10-30: releases are not tag-triggered. The Release workflow (.github/workflows/release.yml) runs on every push to main except one that changes only docs (`docs/**` and `*.md` are ignored), and can be run by hand. The version is major.minor from apps/desktop/package.json plus the workflow run number as the patch, so there is no manual bump or tag step; the workflow creates the `v<version>` tag and release itself. To start a new series, bump the minor with scripts/set-version.ps1. A newer merge cancels a release still in progress, so version numbers may skip.

The plan said MSI. Tauri's WiX MSI always installs per-machine, which needs elevation and would prompt UAC on every update; NSIS currentUser meets the intent (per-user, no elevation) and is supported by the updater.

## Consequences

Losing the updater private key strands installed copies, so it is backed up outside GitHub. The update check is the one sanctioned outbound call.
