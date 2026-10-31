# SQL Server connector

Covers SQL Server, Azure SQL Database and Azure Synapse SQL pools (dedicated and serverless).
All three speak TDS and share one backend: `apps/sidecar/Panoptic.Sidecar/Backends/SqlBackend.cs`,
using Microsoft.Data.SqlClient.

## Connection settings

| Setting | Notes |
| --- | --- |
| Server | `host`, `host,port` or `host\instance`, as in SSMS. Prefer `127.0.0.1` over `localhost` for local containers: `localhost` can resolve to IPv6 first and wait out the connect timeout. |
| Authentication | Microsoft Entra ID, SQL login, or Windows (SQL Server only, not Synapse). |
| User | SQL login only. |
| Password | SQL login only. Stored DPAPI-encrypted in the local store, never sent to the UI. |
| Database | Optional. Restricts the tree to one database; needed for contained users who cannot see `master`. |
| Tenant | Optional, Entra only. Defaults to the signed-in work account's tenant. |
| Trust server certificate | Skips certificate validation. For local and dev servers only. The explorer marks such connections **cert not checked**. |
| Certificate host name | Optional. The name the server's certificate must match when it isn't the server's (a private endpoint, an alias): SqlClient's `HostNameInCertificate`. Validation stays on. |
| Certificate file | Optional. A certificate to trust for this connection only (a private CA, or the server's own): SqlClient's `ServerCertificate`. Can't be combined with Trust server certificate. |

Connections always use `Encrypt=Mandatory`, a 15 s connect timeout and a 30 s command timeout.

### Entra sign-in

Entra connections get tokens for `https://database.windows.net/.default` from Azure.Identity
(`Credentials.cs`). The WAM broker is tried first, parented to the Panoptic window, and can
sign in silently with the account already signed in to Windows. If the broker fails, it falls
back to device-code flow, and the UI shows the code in a banner. Tokens are cached by MSAL in
the user profile, encrypted with DPAPI. One credential per tenant is shared by every SQL and
Cosmos connection.
Each Entra open gets its token before connecting, with up to 3 minutes to finish a sign-in
prompt, so a WAM or device-code sign-in is not cut off by the 15 s connect timeout. A sign-in
that takes longer fails with a sign-in timeout; cancelling the request cancels it.

## Tree

One catalog query per expand, never one per child. Each expand opens a pooled connection with
the target database as the initial catalog, so it works on Azure SQL, where `USE` is not allowed.

```
Server
  Databases (user databases first, then master, model, msdb, tempdb)
    Tables                sys.objects type U (external tables excluded)
      Columns             name (PK, type, identity/computed, null/not null)
      Keys                primary, unique and foreign keys
      Indexes             name (unique, clustered/nonclustered...)
    External tables       Synapse only: sys.tables.is_external = 1
    Views                 type V; Columns, Definition
    Programmability
      Stored procedures   types P, PC; Definition
      Functions           types FN, IF, TF, FS, FT; Definition
    Synonyms              type SN, with the base object (not shown for Synapse)
```

Node ids are opaque paths such as `conn:<id>/db:Orders/f:tables/o:sales%1FOrder` (no environment
segment, so moving a connection keeps its ids); the
schema and object name are joined with the unit-separator character so that names containing dots
or slashes round-trip safely. Only the sidecar parses them.

## IntelliSense catalog

Completions and hover in the query editor read a catalog of each database (docs/query-editor.md),
built in one round trip: schemas, tables, views, procedures, functions and synonyms from
`sys.objects`, their columns from `sys.columns`, parameters from `sys.parameters`, and `sys.types`.
Serverless Synapse pools get one statement per round trip, because they reject the batch.

The stamp is `MAX(modify_date)` and the object count over `sys.objects`. A query tab first gets
the cached catalog, checks the stamp in the background, and rebuilds only if it changed. Running
CREATE, ALTER or DROP, refreshing the database in the explorer, or clicking the IntelliSense status
in the tab rebuilds it straight away.

Catalogs are cached under `%LOCALAPPDATA%\Panoptic\catalog`, one DPAPI-encrypted file per
connection and database, named by a hash, so no server, database or object name is stored in
clear text.

## Read-only environments

In a read-only environment, a query runs inside a transaction that Panoptic rolls back when the
query ends (`Backends/SqlBackend.cs`). This is belt and braces, not a security boundary: **a login
with read-only permissions is the real control**, and is the only thing that stops a write. The
guard has two layers:

- **Scripts that would end the guard are refused before they run** (`Query/ReadOnlyScript.cs`):
  `COMMIT`, `ROLLBACK`, `SET IMPLICIT_TRANSACTIONS` and dynamic SQL (`EXEC(...)`,
  `sp_executesql`), whose text could hold either. Words in comments, strings and quoted
  identifiers don't count. This includes a balanced `BEGIN TRAN ... COMMIT`: a read-only run is
  already one transaction that is rolled back. Calling procedures with `EXEC` is allowed.
- **Procedures that commit are contained on the server.** The guard runs with
  `IMPLICIT_TRANSACTIONS ON` and opens two transaction levels, so a procedure's stray `COMMIT` only
  takes it to one, and any statement after a full commit opens a new transaction that is rolled
  back too.

What the guard does not cover:

- **A procedure written to commit every level** (for example `WHILE @@TRANCOUNT > 0 COMMIT`).
  What ran before that loop is committed. Panoptic notices after the batch, stops before the next
  one, reports the query as committed and shows an error.
- **Side effects outside the database transaction**, such as `xp_cmdshell`, `sp_send_dbmail`,
  linked-server calls that are not enlisted in the transaction, sequence values and identity
  increments.

Synapse serverless pools do not support transactions, so Panoptic refuses to run queries in a
read-only environment on one rather than run them unguarded. Use a read-only login there.

## Importing connections

**Import** (in the explorer toolbar, or on the empty start screen) reads saved connections from
other tools on this machine (`Import/ConnectionImporter.cs`). It reads local files only, never
writes to them, and never imports passwords: SQL-login connections ask for the password on first
connect. The dialog lists every file it examined with the number of connections read from each,
so a miss is visible rather than silent.

### SSMS 21 and later: saved connections (verified with SSMS 22)

`%APPDATA%\Microsoft\SQL Server Management Studio\RegSrvr17.xml` (older versions use
`RegSrvr.xml` or `RegSrvr16.xml`; every `RegSrvr*.xml` there is read, newest first). This is
the store behind both SSMS's saved connections and the Registered Servers panel.

It is SMLIF XML, so the importer matches on element local names rather than a fixed document
structure. Each `RegisteredServer` element has:

| Element | Used for |
| --- | --- |
| `Name` | Display name (falls back to `ServerName`) |
| `ServerName` | Server |
| `ServerType` | Only `DatabaseEngine` is imported |
| `ConnectionStringWithEncryptedPassword` | Database, user, trust-certificate; the encrypted password is ignored |
| `AuthenticationType` | Authentication (see the table below); preferred over the connection string |
| `ActiveDirectoryUserId` | The Entra account, for Entra connections |
| `Parent` / `Uri` | Group, e.g. `.../DatabaseEngineServerGroup/ServerGroup/UAT` |

Some servers have no `Parent` element. Their group comes from the enclosing document's alias
(`.../ServerGroup/UAT/RegisteredServer/<name>`). Groups become proposed environments, and nested
groups are joined as `Dev / Legacy`. Servers under other server types' trees (Analysis Services,
Reporting Services and so on) are skipped.

### SSMS 18 to 20: connection history

`%APPDATA%\Microsoft\SQL Server Management Studio\<version>\UserSettings.xml` (for example
`20.0`), under `SqlStudio/SSMS/ConnectionOptions/ServerTypes`. Each `ServerConnectionItem` holds
one or more `ServerConnectionSettings` with `Instance`, `UserName`, `AuthenticationMethod` and
`Database`, plus an `Advanced` key/value list in which `TSC` is trust-server-certificate. Entries
are de-duplicated by server, auth, user and database.

SSMS 22's own `22.0\UserSettings.xml` holds no connection history; SSMS 22 keeps it in
`RegSrvr17.xml`. SSMS also writes `UserSettings-<date>Backup.xml` copies, which can be truncated
and are not read.

### Authentication values

`AuthenticationType` (RegSrvr) and `AuthenticationMethod` (UserSettings) are the index of the
choice in SSMS's Connect dialog:

| Value | Meaning | Panoptic |
| --- | --- | --- |
| 0 | Windows | Windows |
| 1 | SQL Server authentication | SQL login |
| 2 and above | A Microsoft Entra variant (MFA is 5) | Entra (WAM covers all of them) |

Connection strings without these fields fall back to their keywords: `Authentication=Active
Directory ...` is Entra, `Integrated Security`/`Trusted_Connection` is Windows, a `User ID` alone
is a SQL login, and nothing is Windows.

### Azure Data Studio and VS Code

`%APPDATA%\azuredatastudio\User\settings.json` (`datasource.connections` and
`datasource.connectionGroups`; only `MSSQL` providers) and `%APPDATA%\Code\User\settings.json`
(`mssql.connections`, and `mssql.connectionGroups` when present). Comments and trailing commas
are allowed. `authenticationType` maps `SqlLogin` to SQL login, `Integrated` to Windows, and
anything Azure or ActiveDirectory to Entra.

### Environments suggested from names and folders

Import is usually a one-off, so the aim is to get about 90% of connections into the right
environment automatically, with the rest one click away (`apps/desktop/src/app/import-plan.ts`).

1. **Local servers:** `localhost`, `127.0.0.1`, `.` and `(local)` are Local.
2. **A rule table**, applied to the server name, then the database name, then the display name.
   Each rule matches its words as a separate word in any position (`orders-uat`, `uat-orders`,
   `sql-orders-prd-01`, `orders.uat.corp`), and most also match when glued onto the end of a
   word (`ordersuat`). They never match mid-word, so `product`, `devonshire` and `testament` don't
   count. Spellings are normalised, but distinct environments stay distinct:

   | Environment | Words |
   | --- | --- |
   | Pre-prod | pre-prod, preprod |
   | Non-prod | non-prod, nonprod |
   | Prod | prod, prd, production |
   | Staging | staging, stage, stg |
   | UAT | uat |
   | SIT | sit |
   | QA | qa |
   | Test | test, tst |
   | Dev | dev, develop, development |
   | Sandbox | sandbox, sbx |
   | DR, Demo, Perf, Training, Hotfix, Lower | the word itself (training also matches train) |

3. **Regions** are appended: `-uk`, `-us`, `-eu`, `uksouth`, `eastus` and so on give "Prod UK" or
   "UAT UK South".
4. **Fallback for glued house words** not in the table: the longest prefix shared by at least three
   servers, and by at least half of the servers that share its first four characters, is the family
   name, and whatever follows it is the environment. So `<family>support` and `<family>sandbox`
   group as Support and Sandbox. The half rule stops a sub-family (three names that happen to
   continue with the same letter) from winning.
5. Anything else goes to "Other connections".

Folders saved in SSMS are kept as they are by default. The "Group by server naming pattern"
checkbox regroups everything: folders whose names match the rule table ("Production", "Lower
environments") still decide, and connections in other folders (client or app folders) are grouped
by their names. Groups are ordered Local, Dev, Test, QA, SIT, UAT, Staging, Pre-prod, Prod, then the
rest alphabetically, with "Other connections" last. Prod (including Prod UK and the like) starts red
and read-only.

In the preview, every connection has a **Move to** menu, and every group can be renamed or pointed
at an existing environment. Connections already in Panoptic (same server, user and database) are
shown as already added and skipped.
