# Architecture decision records

One ADR per decision in the plan's decisions table. Write the ADR before the code that depends on it.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-stack.md) | Tauri 2 shell, TypeScript UI, .NET 10 sidecar | Accepted |
| [0002](0002-v1-scope.md) | v1 covers SQL Server and Cosmos DB under one tree | Accepted |
| [0003](0003-repo.md) | Public MIT repo on a personal account | Accepted |
| [0004](0004-ui-framework.md) | UI framework: Svelte 5 or plain TypeScript | Proposed |
| [0005](0005-sidecar-protocol.md) | JSON-RPC 2.0 over stdio to the sidecar | Accepted |
| [0006](0006-query-editor.md) | Monaco for the query pane only | Accepted |
| [0007](0007-auth.md) | Entra first, then SQL auth, then Cosmos keys | Accepted |
| [0008](0008-connection-store.md) | Encrypted local connection store, secrets in the OS keychain | Accepted |
| [0009](0009-telemetry.md) | No telemetry | Accepted |
| [0010](0010-distribution.md) | Per-user MSI with auto-update from GitHub Releases | Accepted |
| [0011](0011-code-signing.md) | Unsigned MSI for M0 | Accepted |
