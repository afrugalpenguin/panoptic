# 0008. Encrypted local connection store, secrets in the OS keychain

- Status: Accepted
- Date: 2026-10-29

## Context

Connections must survive reinstalls and move between machines via a dotfiles repo without exposing secrets.

## Decision

Store connection metadata in an encrypted local file and secrets in Windows Credential Manager. Support export and import as a single file.

## Consequences

The exported file holds no secrets; credentials are re-entered or re-acquired on import.
