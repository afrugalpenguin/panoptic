# 0013. Changelog generated from change fragments, shown as a What's new tab

- Status: Accepted
- Date: 2026-10-29

## Context

Every merge to main ships a release (ADR 0010), and the patch number is the release workflow's run number, so there is no release moment where anyone writes notes. The workflow must not commit back to main, so a hand-maintained CHANGELOG.md would either go stale or need exactly that. Users still need to know what changed in the version they just got. The full design is in docs/changelog.md.

## Decision

Each pull request that changes behaviour adds one user-facing fragment under `changes/`, starting with `Added:`, `Changed:`, `Fixed:` or `Removed:`. Fragments are never edited after merge; git history assigns them to releases. `scripts/changelog.ps1` generates the changelog at build time from the tags and the fragments added between them, and the result is bundled with the app as a resource. On the first launch after a version change, the app opens a What's new tab in the workspace with the sections since the last version the user saw. CI requires a fragment on any feat or fix pull request.

## Consequences

The changelog is not a file in the repo; it exists only in builds. The GitHub release page, the updater manifest's notes and the in-app tab always agree, because all three come from the same generator run. A pull request that forgets its fragment is blocked by CI rather than shipped silently. Notes are never fetched at runtime, so the update check stays the only outbound call (ADR 0009, 0010).
