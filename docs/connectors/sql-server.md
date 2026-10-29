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
| Trust server certificate | Skips certificate validation. For local and dev servers only. |

Connections always use `Encrypt=Mandatory`, a 15 s connect timeout and a 30 s command timeout.

### Entra sign-in

Entra connections get tokens for `https://database.windows.net/.default` from Azure.Identity
(`Credentials.cs`). The WAM broker is tried first, parented to the Panoptic window, and can
sign in silently with the account already signed in to Windows. If the broker fails, it falls
back to device-code flow, and the UI shows the code in a banner. Tokens are cached by MSAL in
the user profile, encrypted with DPAPI. One credential per tenant is shared by every SQL and
Cosmos connection.

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

Node ids are opaque paths such as `env:<id>/conn:<id>/db:Orders/f:tables/o:sales%1FOrder`; the
schema and object name are joined with the unit-separator character so that names containing dots
or slashes round-trip safely. Only the sidecar parses them.

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

### Environments suggested from server names

Connection history has no groups, so the import dialog proposes environments from the user's own
naming convention (`apps/desktop/src/app/import-plan.ts`):

1. Each server is reduced to the part people vary: the first DNS label, lower-cased, without the
   port, the instance name or Synapse's `-ondemand` suffix.
2. For each server, the importer finds its **family prefix**: the longest prefix shared by at
   least three servers, and by at least half of the servers that share its first four characters.
   In `acmedwhuat`, `acmedwhsupport`, `acmedwhsandbox` and `acmedwhdev`, that is `acmedwh`. The
   half rule stops a sub-family (`acmedwhs`, shared by support, sandbox and stage) from winning.
3. Whatever follows the prefix is the environment: `uat` becomes UAT, `support` becomes Support,
   and `stage-us` becomes Stage US. Trailing digits are dropped (`uat2` is UAT). Common tokens get
   canonical names (prd/production/live are Prod, qa/tst are Test, development is Dev, uk/us/eu
   are upper case), and anything else is title-cased as written. So names on no list, such as
   Support or Sandbox, still group together.
4. The bare family name itself (`acmedwh`) is left unassigned rather than guessed to be prod.
5. Servers with no family fall back to keywords, matched as whole words or glued onto the end of
   the name (`orders-prod`, `billingprod`). Words that merely contain a keyword (`product`,
   `devonshire`) don't match. `localhost`, `127.0.0.1`, `.` and `(local)` are Local.

Suggested groups are merged across sources and ordered Dev, Test, UAT, Prod, then the rest
alphabetically, with unrecognised servers last under "Other connections". Prod starts red and
read-only. Groups saved in SSMS are kept by default; a checkbox regroups everything by naming
pattern instead. The user can rename or retarget any group before importing. Connections already
in Panoptic (same server, user and database) are shown as already added and skipped.
