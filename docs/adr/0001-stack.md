# 0001. Tauri 2 shell, TypeScript UI, .NET 10 sidecar

- Status: Accepted
- Recorded: 2026-10-29

## Context

Panoptic needs native start-up speed, a hand-tuned tree and grid, and data access to SQL Server and Cosmos DB with Entra auth. Microsoft.Data.SqlClient and the Cosmos .NET SDK are the only mature drivers with Entra support. .NET 9 leaves support in November 2026, before v1.

## Decision

Tauri 2 hosts a TypeScript UI in WebView2 with Monaco for the query pane. All data access runs in a .NET 10 (LTS) console sidecar started and supervised by Tauri.

## Consequences

Three toolchains (Rust, Node, .NET) in one repo and in CI. Mac and Linux remain possible without rework. Sidecar cold start is a measured M0 risk (see 0005 and docs/benchmarks.md). The sidecar ships self-contained and JIT-compiled (about 70 ms start-up, 98 MB uncompressed). ReadyToRun saves about 10 ms at start-up and about 90 ms on the first SQL query of a session, but adds over a minute to every release, so it is off while releases ship on every merge. Native AOT starts in about 20 ms but SqlClient and the Cosmos SDK fail at runtime under it because they rely on reflection.
