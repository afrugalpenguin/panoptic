using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Azure.Core;
using Microsoft.Data.SqlClient;
using Panoptic.Sidecar.Catalog;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Backends;

/// <summary>
/// SQL Server, Azure SQL and Synapse SQL pools. One catalog query per expand, never one per child. Each expand opens
/// a pooled connection in the target database (no USE, so it works on Azure SQL).
/// </summary>
public sealed class SqlBackend(Credentials credentials) : IQueryBackend
{
    private static readonly string[] SqlScope = ["https://database.windows.net/.default"];

    private static readonly Dictionary<string, (string Kind, string Types)> ObjectFolders = new()
    {
        ["tables"] = ("table", "'U'"),
        ["external"] = ("table", "'U'"),
        ["views"] = ("view", "'V'"),
        ["procs"] = ("proc", "'P','PC'"),
        ["functions"] = ("function", "'FN','IF','TF','FS','FT'"),
        ["synonyms"] = ("synonym", "'SN'"),
    };

    private static readonly HashSet<string> SystemDatabases = ["master", "model", "msdb", "tempdb"];

    private readonly ConcurrentDictionary<TokenCredential, Func<SqlAuthenticationParameters, CancellationToken, Task<SqlAuthenticationToken>>> _tokenCallbacks = new();

    public async Task<TreeNode[]> ChildrenAsync(ConnectionConfig c, string? secret, NodePath path, int start, CancellationToken ct)
    {
        var rel = path.From(start);
        try
        {
            return await Children(c, secret, path, rel, ct);
        }
        catch (SqlException ex)
        {
            throw SqlErrors.ToRpc(ex, c, rel.Count > 0 ? rel[0].Value : c.Database);
        }
    }

    private async Task<TreeNode[]> Children(ConnectionConfig c, string? secret, NodePath path, IReadOnlyList<NodePath.Segment> rel, CancellationToken ct)
    {
        var shape = Nodes.Shape(rel);

        if (shape == "") return await Databases(c, secret, path, ct);

        var db = rel[0].Value;
        var dbPath = path;
        return shape switch
        {
            "db" when c.Kind == ConnectionKinds.Synapse =>
            [
                Nodes.Folder(dbPath, "tables", "Tables"),
                Nodes.Folder(dbPath, "external", "External tables"),
                Nodes.Folder(dbPath, "views", "Views"),
                Nodes.Folder(dbPath, "programmability", "Programmability"),
            ],
            "db" =>
            [
                Nodes.Folder(dbPath, "tables", "Tables"),
                Nodes.Folder(dbPath, "views", "Views"),
                Nodes.Folder(dbPath, "programmability", "Programmability"),
                Nodes.Folder(dbPath, "synonyms", "Synonyms"),
            ],
            "db/f:programmability" =>
            [
                Nodes.Folder(path, "procs", "Stored procedures"),
                Nodes.Folder(path, "functions", "Functions"),
            ],
            "db/f:tables" or "db/f:external" or "db/f:views" or "db/f:synonyms" or "db/f:programmability/f:procs" or "db/f:programmability/f:functions" =>
                await Objects(c, secret, db, path, rel[^1].Value, ct),
            "db/f:external/o" =>
            [
                Nodes.Folder(path, "columns", "Columns"),
            ],
            "db/f:tables/o" =>
            [
                Nodes.Folder(path, "columns", "Columns"),
                Nodes.Folder(path, "keys", "Keys"),
                Nodes.Folder(path, "indexes", "Indexes"),
            ],
            "db/f:views/o" =>
            [
                Nodes.Folder(path, "columns", "Columns"),
                Nodes.Leaf(path.Child("def", "definition"), "definition", "Definition", "definition"),
            ],
            "db/f:programmability/f:procs/o" or "db/f:programmability/f:functions/o" =>
            [
                Nodes.Leaf(path.Child("def", "definition"), "definition", "Definition", "definition"),
            ],
            "db/f:tables/o/f:columns" or "db/f:external/o/f:columns" or "db/f:views/o/f:columns" => await Columns(c, secret, db, path, rel[^2].Value, ct),
            "db/f:tables/o/f:keys" => await Keys(c, secret, db, path, rel[^2].Value, ct),
            "db/f:tables/o/f:indexes" => await Indexes(c, secret, db, path, rel[^2].Value, ct),
            _ => throw new RpcException(RpcException.InvalidParams, $"No children for {path}"),
        };
    }

    public async Task TestAsync(ConnectionConfig c, string? secret, CancellationToken ct)
    {
        await using var conn = await Open(c, secret, c.Database, ct);
        await using var cmd = new SqlCommand("SELECT 1", conn);
        await cmd.ExecuteScalarAsync(ct);
    }

    public void Forget(string connectionId)
    {
        // Pooled connections are keyed by connection string, so changed settings get a new pool.
    }

    /// <summary>Windows auth reaches SQL Server only; Synapse is Entra or SQL logins.</summary>
    public IReadOnlyList<string> AuthsFor(string kind) =>
        kind == ConnectionKinds.Sql ? [AuthKinds.Entra, AuthKinds.Sql, AuthKinds.Windows] : [AuthKinds.Entra, AuthKinds.Sql];

    // --- Templates and names -----------------------------------------------------------------------------

    public string EditorLanguage => "sql";

    /// <summary>selectTop on an object node (the tree offers it on tables and views); any other action opens empty.</summary>
    public string? TemplateFor(NodePath path, string action)
    {
        if (action != "selectTop") return "";
        var last = path.Count > 0 ? path[path.Count - 1] : default;
        if (last.Type != "o") return null;
        var parts = NodePath.SplitParts(last.Value);
        return $"SELECT TOP (1000) *\nFROM {QuoteIdentifier(parts[0])}.{QuoteIdentifier(parts[1])};";
    }

    /// <summary>A T-SQL delimited identifier: [name], with ] doubled.</summary>
    public static string QuoteIdentifier(string identifier) => $"[{identifier.Replace("]", "]]")}]";

    /// <summary>What Copy name copies for a schema object (node meta "copyText"): always bracketed, as SSMS copies it.
    /// Databases, columns, keys and indexes copy their name alone, bracketed the same way (QuoteIdentifier).</summary>
    public static string CopyName(string schema, string name) => $"{QuoteIdentifier(schema)}.{QuoteIdentifier(name)}";

    private static readonly Regex RegularIdentifier = new(@"^[A-Za-z_][A-Za-z0-9_@$#]*\z");
    private static readonly HashSet<string> Keywords = [.. TsqlKeywords.All];

    /// <summary>
    /// A name as dragging it into the editor inserts it (node meta "dragText"): bracketed only when it is not a regular
    /// identifier or is a keyword. The rule drag-text.ts in the UI used before this moved here.
    /// </summary>
    public static string DragName(string name) =>
        RegularIdentifier.IsMatch(name) && !Keywords.Contains(name.ToUpperInvariant()) ? name : QuoteIdentifier(name);

    // --- Queries ----------------------------------------------------------------------------------------

    /// <summary>
    /// Runs the text batch by batch (GO separates batches). In read-only environments it runs inside a transaction
    /// that is rolled back at the end, in two layers:
    /// <list type="bullet">
    /// <item>Scripts with COMMIT, ROLLBACK, SET IMPLICIT_TRANSACTIONS or dynamic SQL are refused before they run
    /// (<see cref="ReadOnlyScript"/>).</item>
    /// <item>The guard runs with IMPLICIT_TRANSACTIONS ON, so its transaction starts two levels deep: a procedure's
    /// unbalanced COMMIT only takes it to one, and any statement after a full commit opens a new transaction that
    /// is rolled back too.</item>
    /// </list>
    /// That is a guard, not a permission boundary. A procedure written to commit every level still commits what ran
    /// before it (reported as Committed, and the remaining batches are skipped), and side effects outside the
    /// transaction (xp_cmdshell, sp_send_dbmail, linked servers, identity and sequence values) are never rolled back.
    /// </summary>
    public async Task ExecuteAsync(QueryTarget target, string? secret, string text, IQuerySink sink, CancellationToken ct)
    {
        if (target.ReadOnly && ReadOnlyScript.FindForbidden(text) is { } forbidden)
            throw new RpcException(RpcException.InvalidParams,
                $"{target.Environment!.Name} is read-only, and line {forbidden.Line} has {forbidden.Statement}, which would end Panoptic's rollback guard. "
                + "A read-only run is already one transaction that is rolled back, so remove it, or clear the environment's read-only flag.");

        await using var conn = await OpenAsync(target.Connection, secret, target.Database, ct);
        conn.InfoMessage += (_, e) =>
        {
            foreach (SqlError error in e.Errors) sink.Message("info", error.Message);
        };

        if (target.ReadOnly)
        {
            await using var probe = new SqlCommand("SELECT CAST(SERVERPROPERTY('EngineEdition') AS int)", conn) { CommandTimeout = 30 };
            if ((int)(await probe.ExecuteScalarAsync(ct))! == 11) // Synapse serverless: no transactions to roll back
                throw new RpcException(RpcException.InvalidParams,
                    $"{target.Environment!.Name} is read-only, but Synapse serverless pools do not support transactions, so Panoptic cannot roll queries back here. Use a read-only login, or clear the environment's read-only flag.");
        }

        if (target.ReadOnly)
        {
            await using var implicitOn = new SqlCommand("SET IMPLICIT_TRANSACTIONS ON", conn) { CommandTimeout = 30 };
            await implicitOn.ExecuteNonQueryAsync(ct);
        }
        await using var tx = target.ReadOnly ? conn.BeginTransaction() : null;
        if (tx is not null)
        {
            // SqlClient's BeginTransaction opens one level; a second means one stray COMMIT cannot end the guard.
            await using var nest = new SqlCommand("BEGIN TRANSACTION", conn, tx) { CommandTimeout = 30 };
            await nest.ExecuteNonQueryAsync(ct);
        }
        var committed = false;
        var failed = false;
        var batchLine = 1;
        try
        {
            // Lazy, so batchLine is the line of the batch RunBatches is about to execute.
            var batches = BatchSplitter.SplitWithLines(text).Select(b =>
            {
                batchLine = b.Line;
                return b.Text;
            });
            var guardHeld = await RunBatches(batches, async batch =>
            {
                await using var cmd = new SqlCommand(batch, conn, tx) { CommandTimeout = 0 };
                var setsBefore = sink.SetCount;
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                do
                {
                    if (reader.FieldCount > 0) await StreamSet(sink, reader, ct);
                } while (await reader.NextResultAsync(ct));

                reader.Close();
                if (reader.RecordsAffected >= 0 && sink.SetCount == setsBefore)
                    sink.Message("info", $"({reader.RecordsAffected} row{(reader.RecordsAffected == 1 ? "" : "s")} affected)");
            }, tx is null ? null : () => TranCount(conn, tx, ct));
            if (!guardHeld) committed = true;
        }
        catch (SqlException ex) when (!ct.IsCancellationRequested)
        {
            failed = true;
            var errors = QueryErrors(ex.Errors.Cast<SqlError>(), batchLine);
            var line = errors.Count > 0 ? errors[0].Line : null;
            sink.Fail(line is not null ? $"Line {line}: {ex.Message}" : ex.Message, errors);
        }
        finally
        {
            // IMPLICIT_TRANSACTIONS needs no reset: the pool's sp_reset_connection clears it on reuse.
            if (tx is not null) await EndReadOnly(sink, target, conn, tx, committed, failed);
        }
    }

    private static List<QueryError> QueryErrors(IEnumerable<SqlError> errors, int batchLine) =>
        errors.Select(e => ToQueryError(e.Number, e.LineNumber, e.Procedure, e.Message, batchLine)).ToList();

    /// <summary>
    /// One server error as the UI gets it. SQL Server numbers lines from the start of the batch, so the batch's script
    /// line is added. An error inside a procedure or trigger carries that module's line, not the script's: it is
    /// named instead and gets no script line.
    /// </summary>
    public static QueryError ToQueryError(int number, int lineNumber, string? procedure, string message, int batchLine)
    {
        if (!string.IsNullOrEmpty(procedure))
            return new QueryError(number, null, lineNumber > 0 ? $"Procedure {procedure}, line {lineNumber}: {message}" : $"Procedure {procedure}: {message}");
        if (lineNumber <= 0) return new QueryError(number, null, message);
        var line = batchLine + lineNumber - 1;
        return new QueryError(number, line, $"Line {line}: {message}");
    }

    /// <summary>
    /// Runs the batches in order. With <paramref name="tranCount"/> (read-only environments), checks it after each
    /// batch and stops as soon as it is 0: a COMMIT or ROLLBACK in the script has ended the guard transaction, so
    /// the remaining batches would run outside it. Returns false if it stopped for that reason. Statements after
    /// the COMMIT in the same batch have already run by then; the check is per batch, not per statement.
    /// </summary>
    public static async Task<bool> RunBatches(IEnumerable<string> batches, Func<string, Task> execute, Func<Task<int>>? tranCount)
    {
        foreach (var batch in batches)
        {
            await execute(batch);
            if (tranCount is not null && await tranCount() == 0) return false;
        }
        return true;
    }

    /// <summary>
    /// @@TRANCOUNT on the query's connection, or 0 once SqlClient has seen the guard transaction end. The second
    /// matters for "COMMIT; BEGIN TRAN": the count is back to 1, but the transaction is the script's, not ours.
    /// </summary>
    private static async Task<int> TranCount(SqlConnection conn, SqlTransaction tx, CancellationToken ct)
    {
        if (tx.Connection is null) return 0;
        await using var cmd = new SqlCommand("SELECT @@TRANCOUNT", conn, tx) { CommandTimeout = 30 };
        return (int)(await cmd.ExecuteScalarAsync(ct))!;
    }

    /// <summary>Rolls back the guard transaction, and says so only if it was still open and the rollback worked.</summary>
    private static async Task EndReadOnly(IQuerySink sink, QueryTarget target, SqlConnection conn, SqlTransaction tx, bool committed, bool failed)
    {
        // Zombied: the script (or an error that aborted the transaction) ended it on the server, and SqlClient's
        // Rollback is then a silent no-op, so it proves nothing.
        if (tx.Connection is null) committed = true;
        if (committed)
        {
            sink.Committed();
            sink.Message("error", "A COMMIT or ROLLBACK in this script (or an error that aborted the transaction) ended the read-only guard: "
                + "changes made before it may be committed, statements after it in the same batch ran outside the guard, and later batches were not run.");
            try
            {
                // A transaction the script began after its COMMIT is not ours to keep open.
                await using var cleanup = new SqlCommand("IF @@TRANCOUNT > 0 ROLLBACK", conn) { CommandTimeout = 30 };
                await cleanup.ExecuteNonQueryAsync(CancellationToken.None);
            }
            catch (Exception) { /* the connection is discarded next anyway */ }
            return;
        }
        try
        {
            await tx.RollbackAsync(CancellationToken.None);
            sink.RolledBack();
            sink.Message("info", RolledBackMessage(target.Environment!.Name, failed));
        }
        catch (Exception ex) when (ex is InvalidOperationException or SqlException)
        {
            sink.Message("error", $"{target.Environment!.Name} is read-only, but the rollback failed: {ex.Message}. Changes may have been committed.");
        }
    }

    /// <summary>
    /// What a successful guard rollback reports. A failed run may have stopped before changing anything, and which
    /// statements ran before the error is not known here, so it only says what is certain: nothing was committed.
    /// </summary>
    public static string RolledBackMessage(string environment, bool failed) =>
        failed ? $"{environment} is read-only: nothing was committed." : $"{environment} is read-only: this query's database changes were rolled back.";

    private static async Task StreamSet(IQuerySink sink, SqlDataReader reader, CancellationToken ct)
    {
        var index = sink.BeginSet();
        var columns = Enumerable.Range(0, reader.FieldCount).Select(i => new ResultColumn(reader.GetName(i), reader.GetDataTypeName(i))).ToArray();
        var batch = new List<object?[]>(sink.BatchSize);
        var first = true;

        while (await reader.ReadAsync(ct))
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < row.Length; i++) row[i] = ReadValue(reader, i);
            batch.Add(row);
            if (batch.Count == sink.BatchSize)
            {
                sink.Rows(index, first ? columns : null, batch);
                batch.Clear();
                first = false;
            }
        }
        if (batch.Count > 0 || first) sink.Rows(index, first ? columns : null, batch);
    }

    private static object? ReadValue(SqlDataReader reader, int i)
    {
        if (reader.IsDBNull(i)) return null;
        try
        {
            return reader.GetValue(i);
        }
        catch (OverflowException)
        {
            // decimal(38, x) values beyond System.Decimal: fall back to the SQL type's own text.
            return reader.GetSqlValue(i).ToString();
        }
    }

    // --- IntelliSense catalog ---------------------------------------------------------------------------

    public async Task<string?> CatalogStampAsync(QueryTarget target, string? secret, CancellationToken ct)
    {
        await using var conn = await OpenAsync(target.Connection, secret, target.Database, ct);
        return await SqlCatalog.StampAsync(conn, ct);
    }

    public async Task<DatabaseCatalog> CatalogAsync(QueryTarget target, string? secret, EditorSettings editor, CancellationToken ct)
    {
        await using var conn = await OpenAsync(target.Connection, secret, target.Database, ct);
        return await SqlCatalog.BuildAsync(conn, ct);
    }

    // --- Tree queries -----------------------------------------------------------------------------------

    private async Task<TreeNode[]> Databases(ConnectionConfig c, string? secret, NodePath path, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(c.Database))
            return [DatabaseNode(path, c.Database, system: false)];

        // Every online database, as SSMS lists them. No HAS_DBACCESS filter: on Azure SQL, Entra users
        // are usually contained users inside each database rather than logins in master, so from master
        // HAS_DBACCESS says no to every client database even though connecting to one directly works.
        // A database the user really can't open reports that when it is expanded.
        const string sql = """
            SELECT name FROM sys.databases
            WHERE state = 0
            ORDER BY name
            """;
        var names = await Query(c, secret, null, sql, null, r => r.GetString(0), ct);
        return names
            .OrderBy(n => SystemDatabases.Contains(n))
            .ThenBy(n => n, StringComparer.OrdinalIgnoreCase)
            .Select(n => DatabaseNode(path, n, SystemDatabases.Contains(n)))
            .ToArray();
    }

    private static TreeNode DatabaseNode(NodePath path, string name, bool system) =>
        Nodes.Branch(path.Child("db", name), "database", name, "database",
            new() { ["system"] = system ? "true" : "false", ["dragText"] = DragName(name), ["copyText"] = QuoteIdentifier(name) }, Nodes.Queryable);

    private async Task<TreeNode[]> Objects(ConnectionConfig c, string? secret, string db, NodePath path, string folder, CancellationToken ct)
    {
        var (kind, types) = ObjectFolders[folder];
        // Tables and external tables are both type U; sys.tables.is_external tells them apart.
        var externalFilter = folder switch
        {
            "tables" => "AND NOT EXISTS (SELECT 1 FROM sys.tables t WHERE t.object_id = o.object_id AND t.is_external = 1)",
            "external" => "AND EXISTS (SELECT 1 FROM sys.tables t WHERE t.object_id = o.object_id AND t.is_external = 1)",
            _ => "",
        };
        // Types and filters come from the fixed tables above, never from the client.
        var sql = $"""
            SELECT s.name, o.name, ISNULL(sn.base_object_name, '')
            FROM sys.objects o
            JOIN sys.schemas s ON s.schema_id = o.schema_id
            LEFT JOIN sys.synonyms sn ON sn.object_id = o.object_id
            WHERE o.type IN ({types}) AND o.is_ms_shipped = 0 {externalFilter}
            ORDER BY s.name, o.name
            """;
        var rows = await Query(c, secret, db, sql, null, r => (Schema: r.GetString(0), Name: r.GetString(1), Base: r.GetString(2)), ct);
        return rows.Select(o =>
        {
            var id = path.Child("o", o.Schema, o.Name);
            var meta = new Dictionary<string, string>
            {
                ["schema"] = o.Schema,
                ["name"] = o.Name,
                ["dragText"] = $"{DragName(o.Schema)}.{DragName(o.Name)}",
                ["copyText"] = CopyName(o.Schema, o.Name),
            };
            if (kind == "synonym")
            {
                meta["baseObject"] = o.Base;
                return Nodes.Leaf(id, kind, $"{o.Schema}.{o.Name}", kind, meta);
            }
            return Nodes.Branch(id, kind, $"{o.Schema}.{o.Name}", kind, meta, kind is "table" or "view" ? Nodes.Selectable : Nodes.Browse);
        }).ToArray();
    }

    private const string ObjectIdSql = "OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@name))";

    private async Task<TreeNode[]> Columns(ConnectionConfig c, string? secret, string db, NodePath path, string obj, CancellationToken ct)
    {
        var sql = $"""
            SELECT c.name, t.name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity, c.is_computed,
                   CAST(CASE WHEN EXISTS (
                       SELECT 1 FROM sys.index_columns ic
                       JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                       WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id)
                   THEN 1 ELSE 0 END AS bit)
            FROM sys.columns c
            JOIN sys.types t ON t.user_type_id = c.user_type_id
            WHERE c.object_id = {ObjectIdSql}
            ORDER BY c.column_id
            """;
        var rows = await Query(c, secret, db, sql, ObjectParams(obj), r => new
        {
            Name = r.GetString(0),
            Type = FormatType(r.GetString(1), r.GetInt16(2), r.GetByte(3), r.GetByte(4)),
            Nullable = r.GetBoolean(5),
            Identity = r.GetBoolean(6),
            Computed = r.GetBoolean(7),
            Pk = r.GetBoolean(8),
        }, ct);

        return rows.Select(col =>
        {
            var details = new List<string>();
            if (col.Pk) details.Add("PK");
            details.Add(col.Type);
            if (col.Identity) details.Add("identity");
            if (col.Computed) details.Add("computed");
            details.Add(col.Nullable ? "null" : "not null");
            return Nodes.Leaf(path.Child("col", col.Name), "column", $"{col.Name} ({string.Join(", ", details)})",
                col.Pk ? "key" : "column", new() { ["name"] = col.Name, ["type"] = col.Type, ["dragText"] = DragName(col.Name), ["copyText"] = QuoteIdentifier(col.Name) });
        }).ToArray();
    }

    private async Task<TreeNode[]> Keys(ConnectionConfig c, string? secret, string db, NodePath path, string obj, CancellationToken ct)
    {
        var sql = $"""
            SELECT k.name, k.type_desc FROM sys.key_constraints k WHERE k.parent_object_id = {ObjectIdSql}
            UNION ALL
            SELECT f.name, 'FOREIGN_KEY_CONSTRAINT' FROM sys.foreign_keys f WHERE f.parent_object_id = {ObjectIdSql}
            ORDER BY 2 DESC, 1
            """;
        var rows = await Query(c, secret, db, sql, ObjectParams(obj), r => (Name: r.GetString(0), Type: r.GetString(1)), ct);
        return rows.Select(k =>
        {
            var type = k.Type switch
            {
                "PRIMARY_KEY_CONSTRAINT" => "primary key",
                "UNIQUE_CONSTRAINT" => "unique",
                _ => "foreign key",
            };
            return Nodes.Leaf(path.Child("key", k.Name), "key", $"{k.Name} ({type})", "key", new() { ["copyText"] = QuoteIdentifier(k.Name) });
        }).ToArray();
    }

    private async Task<TreeNode[]> Indexes(ConnectionConfig c, string? secret, string db, NodePath path, string obj, CancellationToken ct)
    {
        var sql = $"""
            SELECT i.name, i.type_desc, i.is_unique
            FROM sys.indexes i
            WHERE i.object_id = {ObjectIdSql} AND i.name IS NOT NULL
            ORDER BY i.index_id
            """;
        var rows = await Query(c, secret, db, sql, ObjectParams(obj), r => (Name: r.GetString(0), Type: r.GetString(1), Unique: r.GetBoolean(2)), ct);
        return rows.Select(i =>
            Nodes.Leaf(path.Child("ix", i.Name), "index",
                $"{i.Name} ({(i.Unique ? "unique, " : "")}{i.Type.ToLowerInvariant().Replace('_', ' ')})", "index",
                new() { ["copyText"] = QuoteIdentifier(i.Name) })).ToArray();
    }

    private static SqlParameter[] ObjectParams(string obj)
    {
        var parts = NodePath.SplitParts(obj);
        return [new SqlParameter("@schema", parts[0]), new SqlParameter("@name", parts[1])];
    }

    public static string FormatType(string type, short maxLength, byte precision, byte scale) => type switch
    {
        "varchar" or "char" or "varbinary" or "binary" => $"{type}({(maxLength == -1 ? "max" : maxLength)})",
        "nvarchar" or "nchar" => $"{type}({(maxLength == -1 ? "max" : maxLength / 2)})",
        "decimal" or "numeric" => $"{type}({precision}, {scale})",
        "datetime2" or "time" or "datetimeoffset" => $"{type}({scale})",
        _ => type,
    };

    private async Task<List<T>> Query<T>(ConnectionConfig c, string? secret, string? db, string sql, SqlParameter[]? parameters,
        Func<SqlDataReader, T> map, CancellationToken ct)
    {
        await using var conn = await Open(c, secret, db, ct);
        await using var cmd = new SqlCommand(sql, conn) { CommandTimeout = 30 };
        if (parameters is not null) cmd.Parameters.AddRange(parameters);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var results = new List<T>();
        while (await reader.ReadAsync(ct)) results.Add(map(reader));
        return results;
    }

    public Task<SqlConnection> OpenAsync(ConnectionConfig c, string? secret, string? database, CancellationToken ct) => Open(c, secret, database, ct);

    /// <summary>The connection string for one database, without credentials.</summary>
    public static SqlConnectionStringBuilder Settings(ConnectionConfig c, string? database) => new()
    {
        DataSource = c.Endpoint,
        InitialCatalog = database ?? c.Database ?? "",
        ConnectTimeout = 15,
        Encrypt = SqlConnectionEncryptOption.Mandatory,
        TrustServerCertificate = c.TrustServerCertificate,
        // Validate a server known by another name, or with a private CA, without trusting everything (issue #261).
        HostNameInCertificate = c.CertificateHostName?.Trim() ?? "",
        ServerCertificate = c.CertificateFile?.Trim() ?? "",
        ApplicationName = "Panoptic",
    };

    private async Task<SqlConnection> Open(ConnectionConfig c, string? secret, string? database, CancellationToken ct)
    {
        var builder = Settings(c, database);

        SqlConnection conn;
        switch (c.Auth)
        {
            case AuthKinds.Sql:
                builder.UserID = c.User ?? "";
                builder.Password = secret ?? "";
                conn = new SqlConnection(builder.ConnectionString);
                break;
            case AuthKinds.Windows when c.Kind == ConnectionKinds.Sql:
                builder.IntegratedSecurity = true;
                conn = new SqlConnection(builder.ConnectionString);
                break;
            case AuthKinds.Entra:
                await SignInAsync(credentials.For(c.TenantId), SignInBudget, c, database, ct);
                conn = new SqlConnection(builder.ConnectionString) { AccessTokenCallback = TokenCallbackFor(c.TenantId) };
                break;
            default:
                throw new RpcException(RpcException.InvalidParams, $"SQL Server does not support auth '{c.Auth}'");
        }

        try
        {
            await conn.OpenAsync(ct);
            return conn;
        }
        catch (SqlException ex)
        {
            await conn.DisposeAsync();
            throw SqlErrors.ToRpc(ex, c, database);
        }
    }

    /// <summary>
    /// How long an Entra open waits for sign-in. SqlClient gives the token callback only what is left of the 15 s
    /// connect timeout, too short to read a device code, open the page and sign in. Three minutes covers that and a
    /// WAM prompt with MFA, while a prompt nobody answers still fails rather than holding the expand open for good.
    /// </summary>
    public static readonly TimeSpan SignInBudget = TimeSpan.FromMinutes(3);

    /// <summary>
    /// Gets the token before OpenAsync, under the request's cancellation and <paramref name="budget"/> instead of the
    /// connect timeout. It lands in MSAL's cache, so the callback SqlClient then calls is a silent cache hit. When the
    /// token is already cached this is that same silent lookup, once more. Cancelling the request surfaces as
    /// OperationCanceledException (which FallbackCredential does not count as a WAM failure); running out of budget
    /// as a sign-in node error.
    /// </summary>
    public static async Task SignInAsync(TokenCredential credential, TimeSpan budget, ConnectionConfig c, string? database, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(budget);
        try
        {
            await credential.GetTokenAsync(new TokenRequestContext(SqlScope), cts.Token).AsTask().WaitAsync(cts.Token);
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested && !ct.IsCancellationRequested)
        {
            throw SqlErrors.SignInTimedOut(c, database, budget);
        }
    }

    /// <summary>
    /// One callback per tenant credential. SqlClient keys its pool on the callback instance as well as the connection
    /// string, so a new lambda per open meant a new pool, and a fresh TCP, TLS and Entra login, on every expand.
    /// </summary>
    public Func<SqlAuthenticationParameters, CancellationToken, Task<SqlAuthenticationToken>> TokenCallbackFor(string? tenantId) =>
        _tokenCallbacks.GetOrAdd(credentials.For(tenantId), TokenCallback);

    /// <summary>
    /// SqlClient cancels <c>token</c> when the connect timeout runs out. WaitAsync stops waiting then even if the
    /// credential does not observe it (a WAM dialog or device-code poll), so OpenAsync cannot hang on sign-in.
    /// Open signs in first (<see cref="SignInAsync"/>), so this is normally a cache hit and the timeout a backstop.
    /// </summary>
    public static Func<SqlAuthenticationParameters, CancellationToken, Task<SqlAuthenticationToken>> TokenCallback(TokenCredential credential) =>
        async (_, token) =>
        {
            try
            {
                var t = await credential.GetTokenAsync(new TokenRequestContext(SqlScope), token).AsTask().WaitAsync(token);
                return new SqlAuthenticationToken(t.Token, t.ExpiresOn);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                throw new TimeoutException("Entra sign-in did not finish within the connection timeout. Complete any sign-in prompt, then retry.");
            }
        };
}
