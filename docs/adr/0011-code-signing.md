# 0011. Unsigned MSI for M0

- Status: Accepted
- Date: 2026-10-29

## Context

Authenticode signing costs money and identity validation time. Whether SmartScreen and Intune block an unsigned per-user MSI on the work laptop is unknown.

## Decision

Ship unsigned (Authenticode) MSIs during M0 and record what SmartScreen and Intune do. Revisit with Azure Trusted Signing or a certificate if install is blocked, and before v1.

## Consequences

Users see a SmartScreen warning on first install. Updater integrity still rests on the Tauri updater signature (0010).
