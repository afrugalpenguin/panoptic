# 0005. JSON-RPC 2.0 over stdio to the sidecar

- Status: Accepted
- Recorded: 2026-10-29

## Context

The UI must talk to the .NET sidecar without opening ports, which would trigger firewall prompts and CORS issues on a managed machine.

## Decision

JSON-RPC 2.0 over the sidecar's stdin and stdout, using Tauri's sidecar lifecycle. Result sets stream as notifications in 500-row batches; requests are cancellable. The shared node model types are generated from the sidecar's C# records.

## Consequences

No network surface. Tauri restarts a crashed sidecar, and the UI shows every connection as disconnected until ping answers. stdout is reserved for protocol traffic; sidecar logging goes to stderr.

Request cancellation and the methods the backend contract added later are specified in [docs/sidecar-protocol.md](../sidecar-protocol.md).
