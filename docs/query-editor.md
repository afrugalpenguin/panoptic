# Query editor spec

Decided 29 Oct 2026. Pairs with docs/explorer-ux.md; the same principles apply.

## Principles

- Nothing on the keystroke path computes anything expensive. The editor reads from a precomputed catalog snapshot; everything slow happens earlier, elsewhere, off the main thread.
- The sidecar is never called per keystroke. No LSP over IPC. Completions, hover and alias resolution are answered in the UI process from data it already holds.
- Monaco is loaded late and loaded thin. First paint of the app never waits on it.
- The editor does not own results. Rows stream from the sidecar into a virtualised grid.
- Every budget below is measured and logged, not assumed (M0).

## Monaco

- Import `monaco-editor/esm/vs/editor/editor.api` plus only these contributions: suggest, hover, find, bracket matching, folding, comment toggling, multi-cursor, drop into editor, code actions (the quick fix in "Error location"). No languages other than the two defined below. Never import the `monaco-editor` barrel.
- The Monaco chunk is a separate Vite chunk. Fetch starts when a connection row is selected in the explorer; the editor instance is created when the first query tab opens. Subsequent tabs reuse the loaded module and create a model each.
- Syntax colouring: Monaco's built-in Monarch `sql` tokenizer for T-SQL (registered as language id `tsql`, keyword list extended with T-SQL additions), and a hand-written Monarch definition for Cosmos SQL (language id `cosmos-sql`). Colouring never uses a parser.
- Font follows `explorer.rowFont` for the monospace choice (Consolas / Cascadia Mono). Theme uses the same palette as the tree; the tab strip env colour band already exists and applies to query tabs.
- Dragging an explorer row into the editor inserts its name at the drop point: SQL objects schema-qualified (`dbo.Orders`, brackets only where needed), columns and databases by name, Cosmos containers by name and UDFs as `udf.name`. Rows with nothing to insert (folders, connections, Cosmos names that are not identifiers) don't start a drag. The Tauri window has `dragDropEnabled` off, because WebView2 otherwise swallows HTML5 drag and drop.
- A query tab is bound to a connection and a database. The database is a dropdown in the tab toolbar; `USE x` in the batch also switches the catalog for the statements after it.

### Quoting names

The explorer's Copy name and the editor quote SQL names differently on purpose. Both double a `]` inside brackets. Copy and drag text come from the backends in node meta (`copyText`, `dragText`); IntelliSense quotes its completions in the UI by the drag rule.

| Where | Node | Rule | Plain name | Name with `]` |
| --- | --- | --- | --- | --- |
| Copy name | table, view, procedure, function, synonym | always bracketed, schema-qualified, as SSMS copies | `[dbo].[Orders]` | `[dbo].[a]]b]` |
| Copy name | database, column, key, index | always bracketed, name alone | `[Orders]`, `[Id]`, `[PK_Orders]` | `[odd]]col]` |
| Copy name | Definition, folders | none: no Copy name | | |
| Drag into the editor, IntelliSense | objects (schema-qualified), databases, columns | bracketed only when not a regular identifier or a keyword | `dbo.Orders`, `Id` | `dbo.[a]]b]`, `[odd]]col]` |

Keys and indexes cannot be dragged. Cosmos has no identifier quoting: Copy name copies the id of a database, container or item, the name of a stored procedure or trigger, `udf.<name>` for a UDF and the path of a partition key (`/a, /b` for a hierarchical key). Folders, throughput and indexing policy have no Copy name.

## Catalog

The sidecar owns a metadata catalog per server and per database. It is the only source completions read from.

### SQL Server family

- Built with batched queries over `sys.schemas`, `sys.objects` (tables, views, procedures, functions, synonyms), `sys.columns` with `sys.types`, `sys.parameters`, `sys.indexes` (names only). One round trip per database where the dialect allows it, two where it does not (serverless pools).
- Stamp: `max(modify_date)` over `sys.objects` plus the object count. The catalog is only rebuilt when the stamp changes.
- Cached on disk under the app data folder as one file per server/database, written by the sidecar. A reopened tab reads the disk cache first so completions are available before the connection has authenticated; the status bar shows `IntelliSense: cached` until the stamp has been checked, then `IntelliSense: current` or rebuilds in the background.

### Cosmos DB

- Catalog is the container list with partition key paths, the fixed system function and keyword list, and property paths inferred from a document sample per container: `SELECT TOP n * FROM c` with `n = editor.catalogSampleDocs`, paths flattened to dotted form with array indices collapsed to `[]`, each path carrying the set of JSON types seen. The catalog is per database: one build samples every container in it (up to four at a time), in the background. It is first requested when a query tab is bound to the database (opening the tab or picking the database), not when the explorer expands a container. Cosmos has no cheap stamp check, so the first request in a session serves the disk-cached copy, if any, and re-samples; later requests that session use the in-memory result. Saving or removing a connection, or removing an environment, clears all in-memory results, so the next request re-samples. Stamp is the sample time; manual refresh re-samples.

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

- Unknown-name warnings ("Error location") are the only diagnostics. They run in the IntelliSense worker on a 500ms debounce after the text or cursor changes, from the catalog snapshot, and never call the sidecar. Syntax errors and full validation would need a real grammar (ScriptDom in the sidecar, if it works under Native AOT) and remain a later feature.
- Formatting is a command, not a keystroke feature, and may call the sidecar.
- Execution: the tab sends the selected text or the whole batch to the sidecar; results arrive as batches of rows into the virtualised grid with fixed row heights. Messages and row counts arrive on the same stream. Cancellation is a sidecar call that the UI does not wait on.

## Error location

SQL Server reports 208 (invalid object name), 4104 (multi-part identifier could not be bound) and 2812 (could not find stored procedure) at the line where the statement starts, and 207 (invalid column name) at the column's own line. Panoptic finds the name itself. Everything below runs in the UI from data it already holds; nothing is a sidecar call.

- **The sidecar's part.** Each server error is its own `query.message`, with its `number` and its `line` counted from the start of the text that was sent (SQL Server counts from the start of the GO batch; the sidecar adds the batch's line). An error raised inside a procedure or trigger carries that module's line, so it is named instead (`Procedure dbo.p, line 3: ...`) and has no `line`.
- **Pinning the error to the name.** For those four numbers (matched on the number, never on the message text), the UI reads the identifier quoted in the message, takes the statements covering the reported line (split at GO lines and semicolons only, because a statement may contain blank lines) and searches their tokens for a dotted name ending in the identifier's parts, case-insensitively. Strings and comments are tokens of their own, so they never match. For 4104 the last part alone is enough, as the alias written may differ. When there is exactly one match, the squiggle and the gutter icon go on the name and the row reads `Line 41: Invalid object name 'contracts' (statement starts at line 26).` With no match or several, they go on the reported line and the row keeps it. Lines are the editor's: a run of a selection adds the selection's starting line. If the text was edited while the query ran, the error is not placed.
- **Did you mean.** For 208 and 2812 the worker looks the name up among the tables, views and synonyms (or procedures) of the current database's catalog: the same name in another schema or differing only in case, then a name that starts with the typed one (shortest first), then the nearest within two edits. For 207 it looks among the columns of the statement's FROM and JOIN tables that resolve in the catalog, or only the qualifier's table for `alias.column`. Names of three or more parts get no suggestion. At most one is offered: it is appended to the row (`Did you mean dbo.Contracts?`) and offered as a quick fix on the squiggle that replaces the name. No suggestion leaves the row unchanged.
- **Messages rows.** Every error row with a place is clickable and moves the cursor to it: selecting the name when located, else the start of the reported line. The marks follow edits until the next run clears them.
- **Warnings before running.** On a 500ms debounce, the worker checks the statement at the cursor and adds warning squiggles (never errors) for tables and views the catalog lacks, and for columns the named table lacks. It skips names it cannot be sure of: CTE names, `#temp` and `##temp` tables, table variables, objects created or selected INTO earlier in the batch, names of three or more parts, system views, table-valued functions, and an UPDATE or DELETE target that is another table's alias. Qualified columns are checked against their table; bare columns only when the statement reads one table and has no subquery, and never a word that could be an alias, keyword, function, type or date part. A warning on valid SQL is worse than a missed one; the server reports the rest. `editor.warnUnknownNames` turns the warnings off.

## Settings

```
editor.intellisense        bool   default true (per app; a per-connection override is deferred)
editor.keywordCase         enum   lower | upper | preserve   default lower for tsql, upper for cosmos-sql
editor.catalogSampleDocs   int    default 50, range 10 to 500
editor.autoRefreshOnDdl    bool   default true
editor.warnUnknownNames    bool   default true   (off with IntelliSense)
```

Settings changes apply to open tabs without restart. `editor.keywordCase` only affects new insertions.

## Out of scope for this change

Syntax diagnostics, a formatter, snippets, execution plans, result editing, a language server of any kind, parsing with a real grammar on the keystroke path, intellisense for Synapse Spark.
