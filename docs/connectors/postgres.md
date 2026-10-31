# PostgreSQL connector

Status: shipped. The tree, sign-in and connection dialog (#116), queries with the read-only guard (#117), IntelliSense (#118) and the T-SQL habits warnings (#119) are all in. Client certificates (#120), AWS RDS IAM (#121) and Kerberos (#122) sign-in are still open. The design is in [docs/plans/2026-10-30-postgres-design.md](../plans/2026-10-30-postgres-design.md) (ADR 0015).

Covers PostgreSQL and Azure Database for PostgreSQL Flexible Server. Backend: `apps/sidecar/Panoptic.Sidecar/Backends/PostgresBackend.cs`, using Npgsql.

## Connection settings

| Setting | Notes |
| --- | --- |
| Server | `host` or `host:port`; port 5432 by default. |
| Database | The database to connect to first, `postgres` when empty. Every Postgres connection is bound to one database, so the tree opens each database on its own connection. When set, the tree shows only this database. |
| Authentication | Microsoft Entra ID, or username and password. Client certificates (#120), AWS RDS IAM (#121) and Kerberos (#122) are planned. |
| User | The login. For Entra, optional: the Entra name of the Postgres role (a user principal name, or a group's name to sign in through the group). Left blank, it is the name of the account you sign in with. |
| Password | Username and password only. Stored DPAPI-encrypted in the local store, never sent to the UI. |
| Tenant | Optional, Entra only. |
| Trust server certificate | Encrypts without validating the certificate. For local and dev servers only. Otherwise the certificate and host name are verified. Connections are always encrypted, so a server without TLS cannot be reached. The explorer marks such connections **cert not checked**. |
| Certificate host name | Optional. The name the server's certificate must match when it isn't the endpoint's (a private endpoint, an alias). Only the TLS target name changes; the chain and name are still verified. |
| Certificate file | Optional. A CA (or the server's own certificate) trusted for this connection only, as Npgsql's `RootCertificate` with full verification. Can't be combined with Trust server certificate. |

Entra connections get tokens for `https://ossrdbms-aad.database.windows.net/.default` through the same credential as SQL and Cosmos (WAM first, then device code), with the same 3 minute allowance for a sign-in prompt. The token is sent as the password; every new physical connection asks the credential again, so an expired token is replaced from MSAL's cache.

Connections use a 15 s connect timeout and a 30 s command timeout. Each database gets its own pooled data source, dropped when the connection is edited or deleted.

## Tree

```
Connection
  Databases
    db
      Tables                 schema.name; partitions are hidden under their parent
        Columns, Keys, Indexes
      Views                  Columns
      Materialized views     Columns, Indexes
      Functions              schema.name(arg types), so overloads stay apart
      Procedures
      Sequences
```

Databases are listed without templates or databases that refuse connections, with `postgres` (and Azure's `azure_sys` and `azure_maintenance`) last. System schemas (`pg_catalog`, `information_schema`, `pg_toast`, temporary schemas) are not shown. Functions an extension installed are left out, and so are the sequences behind identity columns. Copy name and drag quote a name only when Postgres needs it, using the server's own rule (`quote_ident`): `public.customer`, but `public."Customer"` and `sales."order"` (`order` is a keyword).

## Errors

Failures show on the node with the SQLSTATE as the code:

| Code | Shown as |
| --- | --- |
| 28P01 | Sign-in failed (for Entra: check the user is the Entra name of a role on the server) |
| 28000 | The server refused this connection (firewall rules or the user's role) |
| 3D000 | Database does not exist, or the user cannot see it |
| 42501 | Permission denied |
| 57P03, 53300 | Starting up, or no free connections (retryable) |
| `network` | Server not found or not reachable (retryable) |
| `tls` | The server's certificate could not be verified |

## Queries

New query on a connection or database, and Select top 1000 on a table, view or materialized view (`SELECT * FROM schema.name LIMIT 1000;`), open a tab in the Postgres language. The database picker lists the connection's databases.

- **One statement at a time.** The script is split on semicolons (not inside strings, `"names"`, `$$` bodies, comments or a `BEGIN ATOMIC` body) and each statement runs on its own, so statements before an error stay done, as in psql and SSMS. The run stops at the first error. There is no `GO`.
- **Results** show values as Postgres writes them: `interval '1 mon 2 days'`, arrays as `{1,2}`, ranges as `[1,5)`, `json` and `jsonb` as their text, `timestamptz` with its offset. `bytea` shows as `0x` hex. Numbers and booleans are numbers and booleans.
- **Messages:** `RAISE NOTICE` output, `WARNING:` notices, and `(n rows affected)` for statements that return no rows.
- **Errors** are marked at the exact line and column the server reports, with its `DETAIL:` and `HINT:` lines. An error inside a function names the function instead.
- **Cancel** sends a cancel request to the server.

## IntelliSense

Completion, hover and the unknown-name warnings work as they do for SQL Server, read in Postgres terms:

- Names are double-quoted when inserted unless they are plain lower case, because unquoted names fold to lower case (`"Order"`, `"Full Name"`, but `customer`). An unqualified name resolves to `public` first, and `public` objects show their schema dimmed, as `dbo` does for SQL Server.
- `"names"`, `$$` and `$tag$` bodies, `E'...'` strings and comments are read as such, so nothing inside a function body is completed or checked. Statements end at semicolons only. There is no `USE`, and a qualifier that is not a schema is never taken for another database.
- Types complete after `::` and `CAST(x AS`; procedures and their parameters after `CALL`.
- The warnings skip `pg_catalog`, `information_schema` and unqualified `pg_*` names, the type after `::`, the field in `extract(year from ...)`, and tables made earlier in the script (`CREATE TEMP TABLE`, `CREATE OR REPLACE VIEW`, `CREATE MATERIALIZED VIEW IF NOT EXISTS`, ...).
- Did you mean: when a run fails with an undefined table (42P01), column (42703) or function (42883), the closest catalog name is added to the message and offered as a quick fix on the mark. A "missing FROM-clause entry" error shares 42P01 and gets no suggestion: the alias is what is wrong, not the table.

## Read-only environments

On a read-only environment the session's `default_transaction_read_only` is on and the script runs inside a read-only transaction that is rolled back at the end. The server refuses any write (SQLSTATE 25006), so nothing is written even for a moment, and `SET TRANSACTION READ WRITE` is refused too (25001). If the script ends that transaction itself (COMMIT, ROLLBACK, END, ABORT), the run stops right after it, so nothing runs in a transaction the script could have made writable, and the result says the guard was bypassed.

## Coming from SQL Server

Panoptic's Postgres editor underlines the habits in this table before you run, all but `IDENTITY` and `sp_help`, anywhere in the script, while IntelliSense is on. `TOP`, `[names]`, `GETDATE()`/`SYSDATETIME()`, `ISNULL`, `LEN` and `+` on text have a quick fix (the light bulb, or Ctrl+.); `TOP n` moves to a `LIMIT n` at the end of its query, or of its subquery. `@variables`, `#temp`, `NOLOCK` and `GO` are explained, with nothing to fix automatically.

It stays quiet where the T-SQL reading would be wrong: array subscripts and `ARRAY[...]` are not names, `+` next to `'1 day'` or `date '2020-01-01'` is arithmetic, `x ISNULL` is Postgres's own operator, and a `getdate`, `isnull` or `len` function the database defines (a port's compatibility shim) is called as written. A `TOP` with `PERCENT`, `WITH TIES`, a variable, or a query that already has a `LIMIT` gets the explanation without a fix.

| T-SQL | PostgreSQL |
| --- | --- |
| `SELECT TOP 10 * FROM t` | `SELECT * FROM t LIMIT 10` |
| `[Order Lines]` | `"Order Lines"` |
| `GETDATE()`, `SYSDATETIME()` | `now()` (start of the transaction), `clock_timestamp()` (actual time) |
| `ISNULL(a, b)` | `coalesce(a, b)` |
| `LEN(x)` | `length(x)` |
| `'a' + x` | `'a' \|\| x` (`concat()` treats NULL as empty) |
| `IDENTITY(1,1)` | `GENERATED ALWAYS AS IDENTITY` |
| `DECLARE @n int` | No script variables; use a `DO $$ ... $$` block or a function |
| `#temp` | `CREATE TEMP TABLE temp_name (...)` |
| `WITH (NOLOCK)` | Not needed: readers never block writers |
| `GO` | Not a separator; statements end with `;` |
| `sp_help t` | `\d t` in psql; in Panoptic, expand the table |

Concepts that differ:

- **Names fold to lower case.** `SELECT * FROM Customer` reads `customer`. A table created as `"Customer"` must always be written with the quotes. Most Postgres schemas use lower_snake_case to avoid this.
- **Databases do not see each other.** There is no `otherdb.schema.table`; a query reaches only the database the connection is on. Schemas play the role SQL Server databases often play.
- **The default schema is `public`,** found through `search_path`, rather than `dbo`.
- **DDL is transactional.** `CREATE`, `ALTER` and `DROP` inside a transaction roll back with it.
- **An error ends the transaction.** After any error inside a transaction, every statement fails until `ROLLBACK`.
- **Plans:** `EXPLAIN` shows the estimated plan; `EXPLAIN ANALYZE` runs the query and shows actual times. On a write, `EXPLAIN ANALYZE` really performs it.
- **Case-sensitive comparisons.** `=` and `LIKE` on text are case-sensitive by default; use `ILIKE` or `lower()`.
