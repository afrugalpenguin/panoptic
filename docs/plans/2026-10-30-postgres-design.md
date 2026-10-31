# PostgreSQL support: design

Decided 30 Oct 2026 (ADR 0015). Postgres joins SQL Server, Cosmos and Synapse as a v1 backend, at parity with SQL Server: tree, query editor, Select top 1000, copy name, read-only guard and IntelliSense. Users coming from SQL Server also get a lint that catches T-SQL habits.

Delivered as five pull requests, each based on main after the previous one merges:

| PR | Issue | Scope |
| --- | --- | --- |
| 1 | #115 | This design, ADR 0015, plan.md, docs/connectors/postgres.md |
| 2 | #116 | Tree, auth, errors, connection dialog, dev container, CI job |
| 3 | #117 | Query execution, read-only guard, error position, catalog, `pgsql` highlighting |
| 4 | #118 | `pgsql` dialect in the IntelliSense engine |
| 5 | #119 | T-SQL habits lint with quick fixes |

Later, as their own issues: client certificate auth (#120), AWS RDS IAM (#121), Kerberos / GSSAPI (#122).

## Sidecar

- `PostgresBackend : IQueryBackend` in `apps/sidecar/Panoptic.Sidecar/Backends/`, on Npgsql (the only new dependency). PR 2 implements `IBackend` only; TreeService strips query actions from a backend that is not an `IQueryBackend`, so PR 2 ships no half-working query actions.
- Registered in `BackendRegistry` as `ConnectionKinds.Postgres = "postgres"`. Nothing else names the kind; `BackendContractTests` keeps it that way.
- One `NpgsqlDataSource` per connection and database, cached and pooled like the SQL backend's clients and dropped by `Forget`. A Postgres connection is bound to one database, so each database expand uses that database's data source.

### Connection model

The existing `ConnectionConfig` is unchanged:

| Field | Postgres meaning |
| --- | --- |
| `Endpoint` | `host[:port]`, port 5432 by default |
| `Database` | Initial database, `postgres` when empty. When set by the user, the tree is restricted to it, as for SQL. |
| `User` | Login name. For Entra, optional: the Entra principal (user principal name or group name); blank means the `upn` (or `preferred_username`) claim of the signed-in account's token |
| `TenantId` | Entra only |
| `TrustServerCertificate` | `SSL Mode=Require` without certificate validation. Otherwise `VerifyFull`. |

### Auth

- `entra`: `Credentials.For(tenantId)` gets a token for `https://ossrdbms-aad.database.windows.net/.default` (Azure Database for PostgreSQL Flexible Server). Npgsql's periodic password provider supplies it as the password, so new physical connections get a fresh token before expiry.
- `password`: a new `AuthKinds.Password`. The password is a secret in the DPAPI store, like a SQL login's.
- The sidecar validates the pair: each backend declares the auth kinds it accepts (`IBackend.AuthsFor`), so `postgres` accepts only `entra` and `password`, and `config.saveConnection` and `connection.test` reject anything else whatever the UI sent (`TreeService.Validate`). Keeping the list on the backend keeps a new backend to one class plus its registry line.

### Tree

One catalog query per expand, from `pg_catalog` (not `information_schema`, which is slow on large catalogs). The 300 ms expand budget applies.

```
Connection
  Databases                    pg_database, without templates or datallowconn = false
    db
      Tables                   pg_class relkind r, p; partitions (relispartition) hidden
        schema.name
          Columns              name type, null / not null (format_type)
          Keys                 pg_constraint p, u, f
          Indexes              pg_index
      Views                    relkind v; Columns
      Materialized views       relkind m; Columns, Indexes
      Functions                pg_proc prokind f, labelled schema.name(arg types)
      Procedures               pg_proc prokind p, labelled the same way
      Sequences                relkind S, without identity columns' own sequences
```

Functions an extension installed are left out (there can be hundreds), and so are child partitions.

`pg_catalog`, `information_schema`, `pg_toast` and `pg_temp_*` are hidden.

### Node actions

- New query on connections and databases; Select top 1000 on tables, views and materialized views: `SELECT * FROM schema.name LIMIT 1000;`.
- Copy name and drag text quote only where Postgres needs it: a name with uppercase letters, characters other than lowercase letters, digits and underscores, a leading digit, or a reserved keyword is double-quoted with embedded quotes doubled. `public.customer` stays bare; `Sales."Order Lines"` is quoted. Folders have no copy name.

### Errors

`PostgresErrors.cs` maps exceptions to `NodeError`, like `SqlErrors` and `CosmosErrors`, with the SQLSTATE as `Code`:

| SQLSTATE | Summary | Retryable |
| --- | --- | --- |
| 28P01, 28000 | Sign-in failed (with an Entra hint for Entra connections) | no |
| 3D000 | Database does not exist | no |
| 42501 | Permission denied, on that node only | no |
| 57P03 | Server is starting up | yes |
| none (socket, timeout) | Could not reach the server | yes |

Anything else shows the server's message.

## Queries (PR 3)

- `ExecuteAsync` splits the text into statements itself (`PostgresStatements`: quotes, `E''` strings, `"names"`, dollar quoting, nested comments, and `BEGIN ATOMIC` bodies, which Npgsql's own parser would split) and runs them one at a time, stopping at the first error; there are no GO batches. Statements autocommit one by one, as in psql and SSMS (as built: one command would have run them in an implicit transaction, and an error position would be relative to one statement anyway). Each result set streams through `IQuerySink` in `BatchSize` pages; each statement's `RecordsAffected` becomes a rows-affected message. Server notices (`RAISE NOTICE`) become info messages. Cancellation sends a server cancel request.
- Values: results are read in text format, so every type arrives as the server's own text; integers, floats and booleans become JSON numbers and booleans, `bytea` becomes `0x` hex, and everything else (`uuid`, `inet`, `interval`, enums, ranges, `json`, arrays as `{a,b}`, extension types) stays text.
- Read-only guard: on a read-only environment the session runs `SET default_transaction_read_only = on` and the script runs inside `BEGIN READ ONLY`, rolled back at the end. A write fails on the server with 25006, so nothing is written. A `SELECT` runs first inside it, after which `SET TRANSACTION READ WRITE` is refused (25001). If the script ends that transaction itself (COMMIT, ROLLBACK, END, ABORT, PREPARE), the sidecar sees it (`transaction_timestamp()` changed; Npgsql does not track a script's COMMIT) and stops the run right after that statement, before anything can run in a transaction the script made writable, then reports `Committed()`, the same contract as SQL.
- Error position: `PostgresException.Position` is a 1-based character offset into the failed statement. The sidecar converts it to a script line and column. `QueryError` gains optional `State` (SQLSTATE) and `Column`, and `query.message` carries them. Errors inside a function body have no position: they name the function and carry no line, like SQL procedure errors.
- Catalog: `CatalogAsync` reads schemas, tables, views, columns and functions from `pg_catalog` into `DatabaseCatalog`. `CatalogStampAsync` returns the row count and the sum of `xmin` over `pg_class`, `pg_attribute`, `pg_proc` and `pg_namespace` (other sessions' temporary tables left out), which changes on create, drop and alter but not on statistics updates (as built: a sum, not the newest `xmin`, so it does not depend on transaction ids only growing); if that query fails it returns null and the catalog is rebuilt once per session.
- The `pgsql` Monaco language (keywords, builtins, double-quoted names, dollar quoting, `E''` strings, `::` casts). Postgres query tabs open in it. IntelliSense stays off for them until the dialect lands (PR 4), so the catalog is not fetched yet.

## UI

- Connection dialog: a Postgres kind with Server (`host[:port]`), Database (placeholder `postgres`), Authentication (Microsoft Entra ID, Username and password), User, Password (password auth only), Tenant (Entra only) and Trust server certificate (off by default).
- The explorer already has the `PG` badge (`apps/desktop/src/app/kinds.ts`).

### IntelliSense dialect (PR 4)

The engine (scanner, tokenizer, lint, error locator) takes a dialect, `tsql` or `pgsql`. For `pgsql`: double-quoted names instead of brackets, dollar quoting (`$$` and `$tag$`), `E''` strings, `::` casts, statements split on `;` only, Postgres keywords and builtins. Completions, hover, lint, error location and the did-you-mean quick fix all run through it. Postgres errors with a column get an exact marker without the token finder. Did-you-mean runs for 42P01 (undefined table), 42703 (undefined column) and 42883 (undefined function).

As built: unqualified names resolve to `public` first, and names are double-quoted on insert unless plain lower case. There is no `USE`, and a qualifier that is not a schema is never read as a database (Postgres cannot query across databases), so no other catalog is fetched. The did-you-mean request carries the SQLSTATE and the dotted name written at the server's position; it runs only for messages that say "does not exist", because 42P01 is also "missing FROM-clause entry for table", where the alias is wrong, not the table. 42883 suggests functions and procedures. The unknown-name lint keeps its own not-a-column word list per dialect, so the Postgres keywords do not mute T-SQL warnings; it skips `pg_catalog`, `information_schema`, unqualified `pg_*` names, the type after `::` and the field in `extract(... from ...)`. Postgres tabs refresh their catalog after DDL, as SQL tabs do.

### T-SQL habits lint (PR 5)

Warnings before running, in the `pgsql` editor only, through the existing lint and quick-fix machinery:

| T-SQL | Postgres | Quick fix |
| --- | --- | --- |
| `SELECT TOP 10 ...` | `... LIMIT 10` | yes |
| `[Name]` | `"Name"`, with a note that unquoted names fold to lower case | yes |
| `GETDATE()` | `now()` | yes |
| `ISNULL(a, b)` | `coalesce(a, b)` | yes |
| `LEN(x)` | `length(x)` | yes |
| `'a' + x` | `'a' \|\| x`, only when one side is a string literal | yes |
| `@variable` | explained: variables live in `DO` blocks and functions | no |
| `#temp` | explained: `CREATE TEMP TABLE` | no |
| `WITH (NOLOCK)` | explained: readers never block writers in Postgres | no |
| `GO` | explained: not a Postgres batch separator | no |

## Testing

- Sidecar unit tests: identifier quoting, SQLSTATE mapping, position to line and column, value rendering, the auth allowlist.
- Sidecar integration tests against a `postgres:17` container with TLS on (the image's self-signed certificate; `docker/compose.dev.yml`, `127.0.0.1:15432`, seeded by `scripts/dev-db.ps1` from `docker/seed-postgres.sql`), run by a `sidecar-pg` CI job like `sidecar-sql`: every tree level and partition hiding, Select top, notices and rows affected, cancel, a write refused under the read-only guard, the COMMIT escape reporting `Committed()`, error position, the catalog stamp changing after DDL.
- vitest: dialect cases for the scanner, tokenizer, lint and locator; the habits lint.
- The running app against the dev container. Entra is checked by the maintainer against Azure; no real server details go in the repository.

## Out of scope

Admin surfaces (roles, replication, vacuum settings), editing table data, and the three auth methods above until their issues are picked up.
