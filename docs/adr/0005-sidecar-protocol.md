# 0005. JSON-RPC 2.0 over stdio to the sidecar

- Status: Accepted
- Date: 2026-10-29

## Context

The UI must talk to the .NET sidecar without opening ports, which would trigger firewall prompts and CORS issues on a managed work laptop.

## Decision

JSON-RPC 2.0 over the sidecar's stdin and stdout, using Tauri's sidecar lifecycle. Result sets stream as notifications in 500-row batches; requests are cancellable. The shared node model types are generated from the sidecar's C# records.

## Consequences

No network surface. Tauri restarts a crashed sidecar, and the UI shows every connection as disconnected until ping answers. stdout is reserved for protocol traffic; sidecar logging goes to stderr.

## Cancellation

Added 2026-10-30. Any request can be cancelled with the notification `$/cancelRequest` `{ "id": <request id> }`, named and shaped as in LSP.

- The sidecar keeps a CancellationTokenSource per in-flight request, keyed by the id's raw JSON (so `7` and `"7"` are different requests). The cancel fires that request's token, which every handler receives. The entry is removed when the request completes, so a cancel for an unknown or finished id is ignored. Nothing is sent back for the cancel itself.
- Requests run concurrently: the stdin loop registers each request before handing it to the thread pool, then reads the next line straight away. A cancel is therefore read while its request runs, and can never overtake it.
- A request whose token fired and whose handler then failed (with OperationCanceledException or whatever the driver throws on cancel) answers with error `-32800` "Request cancelled" (LSP's RequestCancelled). A handler that finishes normally despite the cancel still returns its result.
- The UI passes an AbortSignal to `RpcClient.request`. Aborting rejects the request at once with an `AbortError`, sends `$/cancelRequest`, and drops the sidecar's late response. Callers that cancel on purpose (collapsing a loading node, the status bar's cancel, closing the connection dialog mid-test) treat an AbortError as not an error: no error row, no Problems entry.
- `tree.children` and `connection.test` honour the token down to the driver. `catalog.get` and `catalog.refresh` answer at once from memory or disk; the build they may start is shared by every request for that database and outlives the request, so it is not tied to any one request's token.

`query.execute` keeps its own `query.cancel { queryId }` method. It predates this, is keyed by the UI's query id, and reports a cancelled run as a normal summary with `cancelled: true`, keeping the rows already streamed. `$/cancelRequest` on a `query.execute` request id has the same effect, because the query links its token to the request's. Moving the query tab to `$/cancelRequest` and retiring `query.cancel` is a possible follow-up, not part of this change.
