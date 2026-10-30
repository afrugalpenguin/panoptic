# PostgreSQL connector

Status: in progress. The design is in [docs/plans/2026-10-30-postgres-design.md](../plans/2026-10-30-postgres-design.md) (ADR 0015); this page describes the connector as it lands, pull request by pull request (#116 to #119).

Covers PostgreSQL and Azure Database for PostgreSQL Flexible Server. Backend: `apps/sidecar/Panoptic.Sidecar/Backends/PostgresBackend.cs`, using Npgsql.

## Connection settings

| Setting | Notes |
| --- | --- |
| Server | `host` or `host:port`; port 5432 by default. |
| Database | The database to connect to first, `postgres` when empty. Every Postgres connection is bound to one database, so the tree opens each database on its own connection. When set, the tree shows only this database. |
| Authentication | Microsoft Entra ID, or username and password. Client certificates (#120), AWS RDS IAM (#121) and Kerberos (#122) are planned. |
| User | The login, or for Entra the Entra user principal name (or group name) that was added as a Postgres role. |
| Password | Username and password only. Stored DPAPI-encrypted in the local store, never sent to the UI. |
| Tenant | Optional, Entra only. |
| Trust server certificate | Encrypts without validating the certificate. For local and dev servers only. Otherwise the certificate and host name are verified. |

Entra connections get tokens for `https://ossrdbms-aad.database.windows.net/.default` through the same credential as SQL and Cosmos (WAM first, then device code); the token is sent as the password and refreshed before it expires.

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

System schemas (`pg_catalog`, `information_schema`, `pg_toast`) are not shown. Copy name quotes a name only when Postgres needs it: `public.customer`, but `public."Customer"`.

## Read-only environments

On a read-only environment every query runs in a read-only transaction that is rolled back at the end. The server refuses any write (SQLSTATE 25006), so nothing is written even for a moment. If a script ends that transaction itself with COMMIT, Panoptic says so.

## Coming from SQL Server

Panoptic's Postgres editor warns about the habits in the first table before you run, and offers a fix where there is one.

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
