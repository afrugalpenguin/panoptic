# Query editor IntelliSense Implementation Plan

> Execute task by task with superpowers:executing-plans, committing after each task.

**Goal:** Implement docs/query-editor.md: completions and hover in the query editor, answered in a web worker from a per-database metadata catalog that the sidecar builds, caches on disk and refreshes only when it changes.

**Architecture:** The sidecar gains a `Catalog` namespace. Builders produce one flat `DatabaseCatalog` per database (a batched `sys.*` query for the SQL Server family, a document sample for Cosmos). A DPAPI-encrypted disk cache keyed by a hash of connection id plus database, and a cheap stamp query, decide whether to rebuild. The UI asks for a catalog when a query tab opens, gets the cached copy at once, and is told by a notification when a fresh one replaces it. The catalog goes to a dedicated worker. There a token scanner (not a parser) works out the context at the cursor and answers completion and hover requests. Monaco's providers are thin adapters that post to the worker.

**Tech Stack:** .NET 10 sidecar (Microsoft.Data.SqlClient, Cosmos SDK, System.Security.Cryptography.ProtectedData, xunit), Svelte 5 and Monaco (ESM, Vite `?worker`), vitest.

Issue #55, branch `feature/intellisense`, one PR against main with one change fragment.

---

## Spec interpretations (state these in the PR)

1. **Language ids.** Monaco registers `tsql` and `cosmos-sql` as the spec says. The wire contract (`QueryTemplateResult.Language`, UI `QueryLanguage`) keeps `sql` and `cosmos`, and the editor maps between them. This avoids a sidecar contract change for a cosmetic rename.
2. **Worker plumbing.** The spec says "Monaco's custom language worker plumbing". A plain Vite `?worker` with `postMessage` gives the same property, off the main thread, without Monaco's `createWebWorker` proxy machinery. The worker never imports Monaco.
3. **Disk cache encryption.** The cache holds object and column names, which are the user's data. It is DPAPI-encrypted with the same scope as store.bin. File names are a SHA-256 of `connectionId|database`, so no server or database names appear on disk in clear text.
4. **Editor font and theme.** `explorer.rowFont` is `mono | ui`, not a choice between Consolas and Cascadia Mono, and the editor is already monospace (Cascadia Mono, then Consolas). Both are left unchanged and noted as a follow-up.
5. **Database dropdown.** New: `QueryRequest` gains an optional `Database`. It is validated (1 to 128 chars, no control characters) and goes into `SqlConnectionStringBuilder.InitialCatalog`, never into SQL text. The list comes from the connection node's existing tree children of kind `database`. Cosmos tabs are bound to a container and show no dropdown.
6. **Budget assertions.** The perf test asserts 2x the spec budgets (32 ms completion, 200 ms indexing), because CI runners are noisy. It logs the measured numbers so the real budget can be read off the output.
7. **Status bar.** The IntelliSense state shows in the query tab's toolbar next to the database dropdown, not the app status bar. The state belongs to a tab, and two tabs can be in different states. The text is the spec's: `IntelliSense: cached`, `current`, `building`, `off`.

---

## Part A: sidecar catalog

### Task A1: catalog model and JSON

**Files:**
- Create: `apps/sidecar/Panoptic.Sidecar/Catalog/CatalogModel.cs`
- Modify: `apps/sidecar/Panoptic.Sidecar/Model.cs` (add `[JsonSerializable]` entries)

```csharp
namespace Panoptic.Sidecar.Catalog;

public static class ObjectKinds { public const string Table = "table", View = "view", Proc = "proc", Fn = "fn", Synonym = "synonym"; }

public sealed record ColumnRef(string Name, string Type, bool Nullable);
public sealed record ParamRef(string Name, string Type, bool Output);
public sealed record CatalogObject(string Name, string Schema, string Kind, ColumnRef[]? Columns, ParamRef[]? Params);
public sealed record PathRef(string Path, string[] Types);
public sealed record ContainerRef(string Name, string PartitionKey, PathRef[] Paths);

/// <summary>One database's metadata, flat and pre-sorted (objects by schema then name). Replaced whole on refresh.</summary>
public sealed record DatabaseCatalog(string Stamp, string[] Schemas, CatalogObject[] Objects, string[] Types, ContainerRef[]? Containers);

/// <param name="State">"cached" (from disk, stamp not yet checked), "current", or "building" (no cache, build in progress).</param>
public sealed record CatalogResult(string Key, string State, DatabaseCatalog? Catalog);
public sealed record CatalogParams(string NodeId, string? Database = null);
```

Add `DatabaseCatalog`, `CatalogResult` and `CatalogParams` to `SidecarJson`. No test of its own: it is exercised by A2 to A5.

### Task A2: SQL Server catalog builder

**Files:**
- Create: `apps/sidecar/Panoptic.Sidecar/Catalog/SqlCatalog.cs`
- Test: `apps/sidecar/Panoptic.Sidecar.Tests/CatalogTests.cs`

One command, six result sets: stamp, schemas, objects, columns, parameters, types. `sys.indexes` names are dropped: nothing in the spec's completion contexts reads them (YAGNI, noted in the PR). Serverless Synapse pools reject some multi-statement batches, so the builder takes `splitStatements` and runs each statement separately when it is true (the spec's "two round trips where it does not"). That is decided by `SERVERPROPERTY('EngineEdition') = 11` from a first tiny query.

```sql
SELECT CONVERT(varchar(33), MAX(modify_date), 126) + '|' + CAST(COUNT(*) AS varchar(12)) FROM sys.objects;
SELECT name FROM sys.schemas WHERE schema_id < 16384 AND name NOT IN ('sys','INFORMATION_SCHEMA','guest') ORDER BY name;
SELECT o.object_id, o.name, s.name, o.type FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
  WHERE o.type IN ('U','V','P','FN','IF','TF','SN') AND o.is_ms_shipped = 0 ORDER BY s.name, o.name;
SELECT c.object_id, c.name, t.name, c.max_length, c.precision, c.scale, c.is_nullable FROM sys.columns c
  JOIN sys.types t ON t.user_type_id = c.user_type_id JOIN sys.objects o ON o.object_id = c.object_id
  WHERE o.type IN ('U','V','IF','TF') AND o.is_ms_shipped = 0 ORDER BY c.object_id, c.column_id;
SELECT p.object_id, p.name, t.name, p.max_length, p.precision, p.scale, p.is_output FROM sys.parameters p
  JOIN sys.types t ON t.user_type_id = p.user_type_id JOIN sys.objects o ON o.object_id = p.object_id
  WHERE o.type IN ('P','FN','IF','TF') AND o.is_ms_shipped = 0 AND p.parameter_id > 0 ORDER BY p.object_id, p.parameter_id;
SELECT name FROM sys.types ORDER BY name;
```

The assembly from rows is a pure static function, `SqlCatalog.Assemble(stamp, schemas, objects, columns, params, types)`, taking plain row tuples. That keeps it testable without a server.
- Type display reuses the column formatting the tree already uses: `nvarchar(50)`, `decimal(18,2)`, `varchar(max)`. Check SqlBackend's column query and lift its formatter into a shared static if it is private.
- Kinds: U to table; V to view; P to proc; FN, IF and TF to fn; SN to synonym.

**Tests (write first, run, see them fail, implement, see them pass):**
- `Assemble_groups_columns_and_params_under_their_objects`: two tables, one proc. Columns attach in order, params attach to the proc, tables have `Params == null`, the proc has `Columns == null`.
- `Assemble_maps_object_types_to_kinds`: U, V, P, FN, IF, TF and SN map to the five kinds.
- `Assemble_formats_types`: `nvarchar` max_length 100 gives `nvarchar(50)`, max_length -1 gives `nvarchar(max)`, and `decimal` 18,2 gives `decimal(18,2)`.
- Integration (in BackendIntegrationTests, skipped without `PANOPTIC_TEST_SQL_PASSWORD`): build against the dev container's `master` and assert a non-empty stamp, `dbo` among the schemas, and `Types` containing `int`.

Run: `dotnet test apps/sidecar --filter CatalogTests`

### Task A3: Cosmos catalog builder

**Files:**
- Create: `apps/sidecar/Panoptic.Sidecar/Catalog/CosmosCatalog.cs`
- Test: `CatalogTests.cs`

- `CosmosCatalog.FlattenPaths(IEnumerable<JsonElement> docs)` returns `PathRef[]` and is pure.
  - It produces dotted paths. Arrays collapse to `[]` (`tags[]`, `items[].sku`).
  - Each path carries the set of JSON types seen: `string`, `number`, `boolean`, `object`, `array`, `null`.
  - System properties (`_rid`, `_self`, `_etag`, `_attachments`, `_ts`) are skipped. `id` is kept.
  - Paths are sorted ordinal.
- `BuildAsync(client, database, sampleDocs, ct)`:
  - lists containers, using the CosmosBackend helper that already reads `PartitionKeyPaths`;
  - runs `SELECT TOP @n * FROM c` per container, in parallel with at most 4 at a time;
  - the stamp is the UTC sample time, ISO 8601;
  - `Objects`, `Schemas` and `Types` are empty arrays (the keyword and system-function list already lives in the UI's Monarch definition).

**Tests:**
- `FlattenPaths_collapses_arrays_and_merges_types`: docs `{a:1,b:{c:"x"},t:[{s:1}]}` and `{a:"y",t:[]}` give `a` [number,string], `b` [object], `b.c` [string], `t` [array], `t[]` [object], `t[].s` [number].
- `FlattenPaths_skips_system_properties`.

### Task A4: disk cache

**Files:**
- Create: `apps/sidecar/Panoptic.Sidecar/Catalog/CatalogCache.cs`
- Test: `CatalogTests.cs`

```csharp
/// <summary>One DPAPI-encrypted file per connection and database under %LOCALAPPDATA%\Panoptic\catalog.
/// File names are hashes, so no server or database name is stored in clear text.</summary>
public sealed class CatalogCache(string folder)
{
    public static string DefaultFolder => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Panoptic", "catalog");
    public static string KeyOf(string connectionId, string? database) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{connectionId}|{database}")))[..32];
    public DatabaseCatalog? Read(string key);                // null when missing, unreadable or undecryptable
    public void Write(string key, DatabaseCatalog catalog);  // temp file then File.Move(overwrite), so a crash never leaves half a file
}
```

When a connection is deleted, its cache files become orphans that can never be read, because the key needs the connection id. Deleting them needs a key-to-connection index, which isn't worth it yet: note it in the PR as a follow-up.

**Tests (temp folder):**
- `Cache_round_trips`.
- `Cache_returns_null_for_corrupt_file`.
- `Key_has_no_clear_text_names`: the key does not contain the connection id or the database name.

### Task A5: CatalogService and RPC

**Files:**
- Create: `apps/sidecar/Panoptic.Sidecar/Catalog/CatalogService.cs`
- Modify: `Methods.cs`, `Program.cs`, `Model.cs` (QueryRequest gains `string? Database = null`), `TreeService.ResolveTarget` (database override, validated), `QueryService` (pass the override)
- Test: `CatalogTests.cs`, `QueryTests.cs`

Behaviour of `catalog.get { nodeId, database? }`:
1. Resolve the target, then compute the key.
2. If a disk cache exists, return `{ state: "cached", catalog }` at once and start a background check: run the stamp query (SQL), or treat Cosmos as current within a session once sampled. If the stamp is unchanged, notify `catalog.state { key, state: "current" }`. Otherwise rebuild, write the cache and notify `catalog.updated { key, state: "current", catalog }`.
3. With no cache, return `{ state: "building", catalog: null }`, build in the background, then notify `catalog.updated`.
4. Failures notify `catalog.state { key, state: "error", message }`. They never throw past the background task.
5. At most one build per key runs at a time. A second request joins the running one (a `ConcurrentDictionary<string, Task>`).

`catalog.refresh { nodeId, database? }` forces a rebuild (Cosmos re-samples) and returns `{ state: "building" }`. A notification follows.

Database override validation in `ResolveTarget`: non-empty, at most 128 chars, no control characters, otherwise `RpcException(InvalidParams)`. It is passed to `SqlBackend.OpenAsync` as the `database` argument, which already sets `InitialCatalog` through the builder.

The builders sit behind a small interface, `ICatalogSource { Task<string> StampAsync(...); Task<DatabaseCatalog> BuildAsync(...) }`, with SQL and Cosmos implementations, so the service is testable with a fake.

**Tests:**
- `ResolveTarget_rejects_bad_database_override`: empty, 129 chars, or containing `\n`.
- `ResolveTarget_uses_database_override`.
- `CatalogService` with a fake source and the temp cache:
  - with no cache it returns building and notifies updated;
  - with a cache it returns cached, and an unchanged stamp notifies `current` with no rebuild;
  - a changed stamp rebuilds and notifies updated;
  - concurrent gets on one key build once.

Commit after each of A1 to A5 (`feat(sidecar): ...`, `Refs #55`).

---

## Part B: UI

### Task B1: catalog types, store and API

**Files:**
- Create: `apps/desktop/src/query/catalog.ts` (types mirroring A1, plus `CatalogStore`: key to `{ state, catalog }`, updated from `catalog.get` results and the `catalog.updated` and `catalog.state` notifications)
- Modify: `app/api.ts` (`catalogGet`, `catalogRefresh`), wherever notifications are wired in App.svelte (as `query.rows` is), `query/types.ts`
- Test: `query/catalog.test.ts`

Tests:
- a get result sets the state;
- an `updated` notification replaces the catalog and sets the state to current;
- a `state` notification changes only the state;
- an unknown key is ignored.

### Task B2: scanner (pure, no Monaco)

**Files:**
- Create: `apps/desktop/src/query/intellisense/scanner.ts`
- Test: `apps/desktop/src/query/intellisense/scanner.test.ts`

The scanner is its own small tokenizer: words, quoted identifiers (`[x]` and `"x"`), strings, comments, numbers and punctuation. It is not Monaco's Monarch output, because the worker cannot load Monaco. It is cheap and only runs over one statement.

API:

```ts
export type Context =
  | { kind: "objects"; qualifier: string[] }                          // after FROM/JOIN/UPDATE/INSERT INTO/DELETE [FROM]/TRUNCATE TABLE; qualifier is the dotted chain typed so far
  | { kind: "columns"; tables: TableRef[] }                           // SELECT/WHERE/ON/GROUP BY/ORDER BY/HAVING/SET and after ','
  | { kind: "aliasColumns"; table: TableRef }                         // after alias.
  | { kind: "procs" } | { kind: "params"; proc: string; schema?: string }
  | { kind: "variables"; names: string[] }                            // after @: DECLARE lines + containing proc params
  | { kind: "types" }                                                 // CAST(x AS / DECLARE @x / CONVERT(
  | { kind: "keywords" }
  | { kind: "cosmosPaths"; prefix: string[] } | { kind: "cosmosFrom" };
export interface TableRef { name: string; schema?: string; database?: string; alias?: string }
export function statementAt(text: string, offset: number): { start: number; end: number };  // GO line, ';', or blank line
export function contextAt(text: string, offset: number, language: "tsql" | "cosmos-sql"): { context: Context; prefix: string; useDatabase?: string };
```

`useDatabase` is the last `USE x` before the cursor in the batch text, so the worker reads that database's catalog. Whether `x.` in an objects context is a schema or a database is decided by the engine against the catalog, not by the scanner.

**Tests: one per spec bullet, written first.** Use `|` in the fixture string for the cursor.
- `select * from |` gives objects with an empty qualifier.
- `select * from dbo.|` gives objects with qualifier `["dbo"]`.
- `select | from dbo.Orders o join dbo.Lines l on ...` gives columns with Orders aliased o and Lines aliased l.
- `select o.| from dbo.Orders o` gives aliasColumns for Orders.
- `select Orders.| from dbo.Orders` (unaliased) gives aliasColumns for Orders.
- `exec |` gives procs; `exec dbo.GetThing |` gives params.
- `declare @a int; select @|` gives variables including `@a`.
- `cast(x as |` gives types; `declare @x |` gives types.
- `sel|` at the start gives keywords.
- The statement boundary stops at `GO` on its own line, at `;`, and at a blank line.
- Brackets and comments: `select [o].| from [dbo].[Orders] [o] -- from x` gives aliasColumns for Orders, and comment text is ignored.
- `use Other\nGO\nselect * from |` gives useDatabase `Other`.
- Cosmos: `select c.| from c` gives cosmosPaths with prefix []; `select c.address.| from c` gives prefix `["address"]`; `select * from |` gives cosmosFrom.

### Task B3: completion and hover engine (pure)

**Files:**
- Create: `apps/desktop/src/query/intellisense/engine.ts`
- Test: `engine.test.ts`

```ts
export interface Item { label: string; kind: "table"|"view"|"proc"|"fn"|"synonym"|"column"|"param"|"variable"|"schema"|"type"|"keyword"|"function"|"path"|"container"; detail?: string; insertText: string; sortText: string; dimmed?: boolean }
export class Index { constructor(catalog: DatabaseCatalog) }  // builds maps once: by name and by schema.name (case-insensitive), columns by object
export function complete(indexes: Map<string, Index>, current: string, ctx: Context, prefix: string, keywordCase: "lower"|"upper"|"preserve"): Item[]
export function hover(indexes: Map<string, Index>, current: string, text: string, offset: number): string | null  // markdown
```

- Keyword and function lists for T-SQL live in `intellisense/tsql-words.ts`. Cosmos reuses the `COSMOS_KEYWORDS` and `COSMOS_FUNCTIONS` exported from a new `intellisense/cosmos-words.ts`. Move them out of `monaco.ts` so the worker doesn't import Monaco.
- An objects context with a one-part qualifier: if it names a schema in the current catalog, list that schema's objects. Otherwise, if the name has an index (a database whose catalog is loaded), list its schemas. Otherwise return [], so it never blocks. Two parts mean database then schema.
- `dbo.` items carry `dimmed: true`, rendered as a muted detail, matching the explorer.
- Column items are labelled with their alias and type: label `CustomerId`, detail `o, int`.
- Keyword case: `editor.keywordCase`, default lower for tsql and upper for cosmos-sql.

**Tests:**
- objects with and without a schema filter;
- a database qualifier lists that database's schemas;
- columns of two aliased tables carry their alias in the detail;
- aliasColumns returns one table's columns only;
- params for a proc;
- types;
- keyword casing in all three modes;
- hover on an object lists its columns, and hover on a column shows type and nullability;
- Cosmos paths with a nested prefix;
- an unknown alias returns [] and does not throw.

**Perf test**, `engine.perf.test.ts`: build a synthetic catalog of 5,000 objects with 20 columns each (100k columns). Assert `new Index` takes under 200 ms and the 95th-percentile `complete` time for a columns context over 3 tables is under 32 ms. `console.log` the measured numbers.

### Task B4: worker

**Files:**
- Create: `apps/desktop/src/query/intellisense/worker.ts` and `client.ts`
- Test: `worker.test.ts`. Export a `handle(message)` from `worker.ts`, keep the `self.onmessage` wiring to one line, and test `handle` directly.

Messages:
- `{ type: "catalog", key, catalog }`: build the Index and replace any old one.
- `{ type: "complete", id, key, text, offset, language, keywordCase }` returns `{ id, items }`.
- `{ type: "hover", id, key, text, offset }` returns `{ id, markdown }`.

The worker re-scans only the current statement and the batch's DECLARE lines (through `statementAt`).

`client.ts` keeps one worker per app, lazily created. It tracks which keys it has sent, sends a catalog when the store's version for that key changes, and returns promises by id. Results for a superseded request id are dropped.

### Task B5: Monaco wiring

**Files:**
- Modify: `apps/desktop/src/query/monaco.ts`, `QueryEditor.svelte`
- Create: `apps/desktop/src/query/intellisense/tsql-language.ts` (Monarch: Monaco's sql `language` definition, with T-SQL keywords added), registered as `tsql`. Rename the Cosmos registration to `cosmos-sql`.

- Imports: add the contributions for suggest, hover, bracket matching, folding, comment and multicursor. Find is already there. Use the ESM paths under `monaco-editor/editor/contrib/...` that match the existing find import; check the exact paths in node_modules.
- Providers are registered once, in `monaco.ts`, for `tsql` and `cosmos-sql`, with trigger characters `.`, `@` and space.
  - Each provider reads the model's entry in a `WeakMap<ITextModel, { key, language }>` set by QueryEditor and calls the client.
  - It returns `{ suggestions: [] }` when `editor.intellisense` is off or the key has no catalog yet. That path never blocks.
- QueryEditor gets props `catalogKey` and `intellisense`, maps `language` to the Monaco id, and sets the WeakMap entry when the key changes.
- Prefetch: export `preloadMonaco()` from a tiny module that calls `import("./monaco")`. App.svelte calls it once when a connection-or-below row is first selected.

Test: there is no Monaco in vitest. The adapter is a short function, `toMonacoItem(item, range, monacoKinds)`, in `client.ts`, unit-tested with a fake kinds map.

### Task B6: tab database dropdown, IntelliSense status and refresh triggers

**Files:**
- Modify: `query/store.svelte.ts` (QueryTab gains `database = $state<string>()` and `catalogKey = $state<string>()`; `run` sends `database`), `QueryView.svelte` (toolbar dropdown and status text), `App.svelte` (database list from the connection node's children; the refresh menu also calls `catalogRefresh` for database and connection nodes)
- Test: `store.test.ts`

- On tab open, call `catalogGet` with the tab's node and database. Record the returned key on the tab.
- Changing the dropdown calls `catalogGet` again and updates the key.
- After a run finishes, if `autoRefreshOnDdl` is on and the executed text contains `create`, `alter` or `drop` as a keyword token (the scanner's tokenizer, so strings and comments don't count), call `catalogRefresh`.
- The status text is derived from the CatalogStore state for the tab's key, or `off` when IntelliSense is disabled.

Tests:
- `run` sends the selected database;
- DDL detection is true for `create table`, false for `select 'drop'`, and false for `-- drop`.

### Task B7: settings

**Files:**
- Modify: `Model.cs` (an `EditorSettings(bool Intellisense = true, string? KeywordCase = null, int CatalogSampleDocs = 50, bool AutoRefreshOnDdl = true)` record, hung off AppSettings the way Explorer is), `ConfigStore.SaveSettings` (validation: KeywordCase null, lower, upper or preserve; sample docs 10 to 500), `app/api.ts`, `SettingsDialog.svelte` (an Editor section with four controls)
- Test: `StoreAndTreeTests` (round trip; reject sample docs 9 and 501; reject KeywordCase "title")

A null `KeywordCase` means the language default: lower for tsql, upper for cosmos-sql. Settings apply live because the providers read the current settings object on each request. CosmosCatalog reads `CatalogSampleDocs` from the store at build time.

### Task B8: docs, fragment, verification

- `changes/intellisense.md`: "Added: The query editor completes table, view, column, procedure, parameter, variable and type names as you type, and shows details on hover. For Cosmos DB it completes property paths sampled from each container. Each query tab also has a database picker."
- `docs/connectors/sql-server.md`: a short IntelliSense paragraph listing the catalog queries, the cache location and encryption.
- `docs/query-editor.md`: no edits. Interpretations go in the PR.

Verification, all of it pasted into the PR:
- `pnpm --filter @panoptic/desktop check` gives 0 errors;
- `pnpm --filter @panoptic/desktop test`, including the perf numbers;
- `dotnet test apps/sidecar` with `PANOPTIC_TEST_SQL_PASSWORD` set, against the dev container;
- `pnpm build` succeeds;
- the Monaco chunk size before and after;
- a manual check in `pnpm tauri dev` against the dev SQL container, using a synthetic fixture database only:
  - completions after FROM, alias dot and EXEC;
  - hover;
  - switching the database dropdown;
  - running `create table` refreshes the catalog;
  - a reopened tab shows `IntelliSense: cached` before `current`.

Commit per task. Before reporting the PR as ready, follow the PR-head check: the PR head SHA matches local, and CI ran on that SHA.
