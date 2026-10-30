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

## Backend contract methods

Added 2026-10-30. Everything below a connection is served by that connection kind's `IBackend` (tree, node actions), registered once in `BackendRegistry`. A backend that can query also implements `IQueryBackend` (execution, templates, editor language, IntelliSense catalog). For one that does not, the sidecar strips `newQuery` and `selectTop` from its nodes' actions, and `query.execute`, `query.template` and `catalog.*` refuse with "<kind> connections cannot run queries." or "... have no IntelliSense catalog." So that the UI never parses node ids or tests connection kinds for behaviour, these were added. All are additive: no existing method or field changed.

- `query.template` results carry `scope`: `{ connection, database?, container?, label, connectionLabel }`. `connection` is the connection's node id; `database` and `container` are the node's own segments (absent means the connection default); `label` is the nearest container, database or connection name, which names a new query tab.
- `query.scope { nodeId }` returns the same scope on its own. An explorer refresh of a connection or database uses it to find the query tabs whose catalogs to rebuild.
- `node.actionLabels` returns `{ actionId: label }` for every action id a node can carry: the shared ones (`selectTop`, `newQuery`, `refresh`, `copyName`) and any a backend adds. The UI performs `selectTop`, `newQuery` and `refresh` itself and adds its own keyboard hints.
- `node.invoke { nodeId, actionId }` performs any other action in the sidecar and returns `{ text? }`, which the UI copies to the clipboard; an absent `text` means "use the node's label". `copyName` is the only such action today.
- Node meta may carry `dragText`: the text dragging the node into the query editor inserts, set by the backend on draggable nodes only (SQL databases, objects and columns; Cosmos containers and UDFs whose names parse). The UI drags only nodes that have it. Meta keys like this are display data for the UI; more may be added.
