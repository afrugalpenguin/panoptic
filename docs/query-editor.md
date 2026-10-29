# Query editor spec

Decided 29 Oct 2026. Pairs with docs/explorer-ux.md; the same principles apply.

## Principles

- Nothing on the keystroke path computes anything expensive. The editor reads from a precomputed catalog snapshot; everything slow happens earlier, elsewhere, off the main thread.
- The sidecar is never called per keystroke. No LSP over IPC. Completions, hover and alias resolution are answered in the UI process from data it already holds.
- Monaco is loaded late and loaded thin. First paint of the app never waits on it.
- The editor does not own results. Rows stream from the sidecar into a virtualised grid.
- Every budget below is measured and logged, not assumed (M0).

## Monaco

- Import `monaco-editor/esm/vs/editor/editor.api` plus only these contributions: suggest, hover, find, bracket matching, folding, comment toggling, multi-cursor, drop into editor. No languages other than the two defined below. Never import the `monaco-editor` barrel.
- The Monaco chunk is a separate Vite chunk. Fetch starts when a connection row is selected in the explorer; the editor instance is created when the first query tab opens. Subsequent tabs reuse the loaded module and create a model each.
- Syntax colouring: Monaco's built-in Monarch `sql` tokenizer for T-SQL (registered as language id `tsql`, keyword list extended with T-SQL additions), and a hand-written Monarch definition for Cosmos SQL (language id `cosmos-sql`). Colouring never uses a parser.
- Font follows `explorer.rowFont` for the monospace choice (Consolas / Cascadia Mono). Theme uses the same palette as the tree; the tab strip env colour band already exists and applies to query tabs.
- Dragging an explorer row into the editor inserts its name at the drop point: SQL objects schema-qualified (`dbo.Orders`, brackets only where needed), columns and databases by name, Cosmos containers by name and UDFs as `udf.name`. Rows with nothing to insert (folders, connections, Cosmos names that are not identifiers) don't start a drag. The Tauri window has `dragDropEnabled` off, because WebView2 otherwise swallows HTML5 drag and drop.
- A query tab is bound to a connection and a database. The database is a dropdown in the tab toolbar; `USE x` in the batch also switches the catalog for the statements after it.

## Catalog

The sidecar owns a metadata catalog per server and per database. It is the only source completions read from.

### SQL Server family

- Built with batched queries over `sys.schemas`, `sys.objects` (tables, views, procedures, functions, synonyms), `sys.columns` with `sys.types`, `sys.parameters`, `sys.indexes` (names only). One round trip per database where the dialect allows it, two where it does not (serverless pools).
- Stamp: `max(modify_date)` over `sys.objects` plus the object count. The catalog is only rebuilt when the stamp changes.
- Cached on disk under the app data folder as one file per server/database, written by the sidecar. A reopened tab reads the disk cache first so completions are available before the connection has authenticated; the status bar shows `IntelliSense: cached` until the stamp has been checked, then `IntelliSense: current` or rebuilds in the background.

### Cosmos DB

- Catalog is the container list with partition key paths, the fixed system function and keyword list, and property paths inferred from a document sample per container: `SELECT TOP n * FROM c` with `n = editor.catalogSampleDocs`, paths flattened to dotted form with array indices collapsed to `[]`, each path carrying the set of JSON types seen. Sampling runs once per container per session, in the background, after the container is first expanded or a tab is bound to it. Stamp is the sample time; manual refresh re-samples.

### Shape handed to the UI

One flat, pre-sorted structure per database, sent once and replaced whole on refresh. Arrays, not trees; no methods, no lazy fields.

```
{
  stamp: string,
  schemas: string[],
  objects: { name, schema, kind: "table" | "view" | "proc" | "fn" | "synonym", columns: ColumnRef[] | null, params: ParamRef[] | null }[],
  types: string[],
  containers: { name, partitionKey: string, paths: { path, types: string[] }[] }[]   // Cosmos only
}
```

`objects` is sorted by schema then name; the UI builds its lookup maps once on receipt.

### Refresh triggers

Connect, explorer refresh on that node, a DDL statement executed from any tab on that database (`CREATE`, `ALTER`, `DROP` detected by the scanner, not by parsing), and a `Refresh IntelliSense` command (toolbar and command palette). Never on a timer, never on a keystroke.

## Completion engine

Runs in a web worker using Monaco's custom language worker plumbing. The worker holds its own copy of each loaded catalog. The main thread sends `(modelVersion, text, cursorOffset, languageId, databaseKey)` and receives a completion list. The provider is registered for `tsql` and `cosmos-sql`; trigger characters are `.`, `@`, and space after a keyword.

### Context resolution: a scanner, not a parser

- Statement boundary: nearest `GO` line, `;`, or blank line in each direction from the cursor. The scanner only ever looks at one statement plus `DECLARE` lines earlier in the batch.
- Tokens are the Monarch tokens already produced for colouring; the worker re-tokenises only the current statement.
- Context is decided by the nearest significant keyword before the cursor and the characters immediately before it:
  - after `FROM`, `JOIN`, `UPDATE`, `INSERT INTO`, `DELETE [FROM]`, `TRUNCATE TABLE`: tables, views, synonyms, schema-qualified, with `dbo.` dimmed as in the explorer
  - after `SELECT`, `WHERE`, `ON`, `GROUP BY`, `ORDER BY`, `HAVING`, `SET`, and after `,` inside those clauses: columns of every table referenced by this statement's FROM and JOIN clauses, each item labelled with its alias and type
  - after `alias.`: columns of that table only. Aliases come from a scan of the statement for `FROM x [AS] a` and `JOIN y [AS] b`; unaliased tables are addressable by name
  - after `EXEC` / `EXECUTE`: procedures; after a procedure name: its parameters with types
  - after `@`: variables from `DECLARE` lines in the batch and parameters of the containing procedure definition
  - after `database.`: schemas of that database (catalog loaded on demand, in the background; until it arrives the list is empty, not blocking); after `database.schema.`: objects
  - after `CAST(x AS`, `DECLARE @x`, `CONVERT(`: types
  - anywhere else: keywords and built-in functions
- Cosmos: after the FROM alias and `.` (conventionally `c.`): sampled paths of the bound container, nested completion as the user types further segments; after `FROM`: the container name and `c`; bare position: keywords and system functions.
- Keyword items insert in the casing set by `editor.keywordCase`. Default is lowercase for `tsql` and uppercase for `cosmos-sql`.

### Hover

Same worker, same scanner. Hovering an object name shows its kind, schema and column list; a column shows its type and nullability; a Cosmos path shows the types seen in the sample.

### Budgets

- Completion list returned to Monaco within 16ms of the trigger for a catalog of 5,000 objects and 100,000 columns. Measured in the worker and logged at debug level with the catalog size.
- Catalog deserialised and indexed in the worker in under 100ms for the same size.
- Tab open to first accepted keystroke under 50ms when Monaco is already loaded.
- Monaco chunk parse and first editor creation logged once per session.

## Off the keystroke path

- Diagnostics (syntax errors, unknown columns) are a later feature. If added, ScriptDom runs in the sidecar on a 500ms idle debounce after the model changes and pushes markers back asynchronously. ScriptDom's compatibility with Native AOT must be verified before it is adopted; if it fails, diagnostics stay out of scope.
- Formatting is a command, not a keystroke feature, and may call the sidecar.
- Execution: the tab sends the selected text or the whole batch to the sidecar; results arrive as batches of rows into the virtualised grid with fixed row heights. Messages and row counts arrive on the same stream. Cancellation is a sidecar call that the UI does not wait on.

## Settings

```
editor.intellisense        bool   default true (per app; a per-connection override is deferred)
editor.keywordCase         enum   lower | upper | preserve   default lower for tsql, upper for cosmos-sql
editor.catalogSampleDocs   int    default 50, range 10 to 500
editor.autoRefreshOnDdl    bool   default true
```

Settings changes apply to open tabs without restart. `editor.keywordCase` only affects new insertions.

## Out of scope for this change

Diagnostics, a formatter, snippets, execution plans, result editing, a language server of any kind, parsing with a real grammar on the keystroke path, intellisense for Synapse Spark.
