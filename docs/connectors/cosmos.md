# Cosmos DB connector

Covers Azure Cosmos DB for NoSQL, and the local emulator. The backend is
`apps/sidecar/Panoptic.Sidecar/Backends/CosmosBackend.cs`, using the Cosmos .NET SDK. One
`CosmosClient` is cached per connection and replaced when the connection's settings or key change.

## Connection settings

| Setting | Notes |
| --- | --- |
| Account URI | The account endpoint, e.g. `https://myaccount.documents.azure.com:443/`. |
| Authentication | Microsoft Entra ID or Account key. |
| Account key | Account key only. Stored DPAPI-encrypted in the local store, never sent to the UI. |
| Tenant | Optional, Entra only. Defaults to the signed-in work account's tenant. |
| Skip certificate validation | Only for the emulator's self-signed certificate. Refused unless the account URI is a loopback address, and the client is then limited to that endpoint. |

There is no Database setting: the tree always lists every database the identity can see.

Clients use Gateway mode with a 15 s request timeout. **Test** runs one database query
(`SELECT TOP 1 * FROM c` over the account's databases).

### Keys or Entra

With an account key the client has full access to the account, including throughput.

Entra connections share the same credential as SQL connections, one per tenant (WAM broker first,
device code as the fallback; see [sql-server.md](sql-server.md#entra-sign-in)). The Cosmos SDK
requests the token itself. The identity needs a Cosmos DB data-plane role, such as Cosmos DB
Built-in Data Reader; Azure control-plane roles such as Reader do not grant data access. Without
one, expands fail with "No data-plane access. Identity needs a Cosmos DB role such as
Built-in Data Reader." (status 403, substatus 5300).

Data-plane roles do not allow reading offers (throughput), so under Entra the container's
throughput leaf reads `Throughput: not visible with this identity` while the rest of the container
expands normally.

## Tree

Each expand reads one SDK feed, never one call per child. Containers are the exception: their
expand reads the container's properties and its throughput in parallel.

```
Account
  Databases                 sorted by name
    Containers              sorted by name; partition key path shown beside the name
      Items (first 100)     document ids from SELECT TOP 100 c.id FROM c
      Indexing policy       the policy JSON, shown in the detail pane when selected
      Stored procedures     names
      Triggers              names
      UDFs                  names
      Partition key: /pk    leaf
      Throughput: ...       leaf
```

The throughput leaf reads the container's own offer first: `400 RU/s`, or `autoscale up to 4,000
RU/s`. A container with no dedicated throughput falls back to the database's, marked `(shared)`.
A serverless account reads `serverless`, and anything else that fails reads `unknown`.

Items are the first 100 ids the query returns, in no particular order; the leaf shows the id only,
not the document. Stored procedures, triggers and UDFs show their names only, not their bodies.

Node ids are opaque paths such as `conn:<id>/db:Orders/c:Orders/f:items/item:<id>` (a connection's id never
includes its environment, so moving it keeps every id below it), with
each value URI-escaped. Only the sidecar parses them.

### Errors

Failures become a one-line summary on the node, with detail (status, substatus, ActivityId,
endpoint, identity) in the Problems tab (`Backends/CosmosErrors.cs`, docs/explorer-errors.md):

| Status | Summary |
| --- | --- |
| 403/5300 | No data-plane access. Identity needs a Cosmos DB role such as Built-in Data Reader. |
| 401 | Cosmos DB rejected the credentials. Check the account key or sign-in. |
| 404 | Not found. It may have been deleted or renamed; refresh the parent. |
| 429 | Cosmos DB is throttling requests. Wait a moment, then retry (marked retryable). |

Anything else falls back to the SDK's message.

## Queries

Queries run against one container, so a tab must be opened from a container or something under
it; a tab bound only to a database refuses to run with "Select a container to query". **Select
top 1000** on a container opens `SELECT TOP 1000 * FROM c`.

Results stream in pages of up to 500 rows. Columns are the union of the top-level
properties seen so far, with `id` first and `_rid`, `_self`, `_etag` and `_attachments` hidden;
objects and arrays show as JSON text. `SELECT VALUE` results go in a single `value` column. The
total request charge (RU) is shown with the row count.

## IntelliSense catalog

Completions and hover in the query editor read a catalog of the tab's database
(`Catalog/CosmosCatalog.cs`, docs/query-editor.md). The catalog is every container in the
database, with its partition key, and the property paths seen in a sample of its documents:

- Each container is sampled with `SELECT TOP n * FROM c`, four containers at a time. `n` is the
  **Cosmos sample size** in Settings: 50 by default, 10 to 500.
- Paths are dotted (`address.city`), array elements are collapsed to `[]` (`lines[].sku`), and
  each path carries the JSON types seen at it (string, number, boolean, object, array, null).
  `_rid`, `_self`, `_etag`, `_attachments` and `_ts` are left out.
- A tab needs a database (or a container under it) to get a catalog.

Cosmos has no cheap way to tell whether anything changed, so there is no stamp check. A tab first
gets the cached catalog, and the database is re-sampled in the background once per session.
Clicking the IntelliSense status in the tab, or refreshing the connection or database in the
explorer, re-samples straight away.

Catalogs are cached the same way as SQL Server's: under `%LOCALAPPDATA%\Panoptic\catalog`, one
DPAPI-encrypted file per connection and database, named by a hash.

## Limits

- Cosmos DB for NoSQL only. The MongoDB, Cassandra, Gremlin and Table APIs are not supported.
- Read-only browsing: no creating, editing or deleting items, containers or scripts from the tree.
- Items show the first 100 ids only, and script bodies are not shown.
- Connections are added by hand; **Import** reads SQL Server connections only.
