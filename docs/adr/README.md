# Architecture decision records

One ADR per decision in the plan's decisions table. Write the ADR before the code that depends on it.

ADRs 0001 to 0011 were written up on 2026-10-29, when the repository was set up, for decisions that had already been made; their Recorded line gives that date, not the date of the decision. Later ADRs carry the date they were decided.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-stack.md) | Tauri 2 shell, TypeScript UI, .NET 10 sidecar | Accepted |
| [0002](0002-v1-scope.md) | v1 covers SQL Server, Cosmos DB and Synapse under one tree | Accepted (amended by 0015) |
| [0003](0003-repo.md) | Public MIT repo on a personal account | Accepted |
| [0004](0004-ui-framework.md) | UI framework: Svelte 5, with hand-written virtualisation | Accepted |
| [0005](0005-sidecar-protocol.md) | JSON-RPC 2.0 over stdio to the sidecar | Accepted |
| [0006](0006-query-editor.md) | Monaco for the query pane only | Accepted |
| [0007](0007-auth.md) | Entra first, then SQL auth, then Cosmos keys | Accepted |
| [0008](0008-connection-store.md) | Encrypted local connection store | Accepted (amended) |
| [0009](0009-telemetry.md) | No telemetry | Accepted |
| [0010](0010-distribution.md) | Per-user installer with auto-update from GitHub Releases | Accepted |
| [0011](0011-code-signing.md) | Unsigned installer for M0 | Accepted |
| [0012](0012-no-diff.md) | Cross-environment diff is not core; a plugin later at most | Accepted |
| [0013](0013-changelog.md) | Changelog generated from change fragments, shown as a What's new tab | Accepted |
| [0014](0014-code-signing.md) | Sign release builds before the next daily-use trial (will supersede 0011) | Proposed |
| [0015](0015-postgres-in-v1.md) | v1 adds PostgreSQL | Accepted |
