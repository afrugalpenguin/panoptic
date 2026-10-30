using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Azure.Core;
using Npgsql;
using Panoptic.Sidecar.Catalog;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Backends;

/// <summary>
/// PostgreSQL and Azure Database for PostgreSQL (docs/connectors/postgres.md): the explorer tree (one catalog query per
/// expand, from pg_catalog), queries and the IntelliSense catalog. A Postgres connection is bound to one database, so
/// each database has its own pooled data source.
/// </summary>
public sealed class PostgresBackend(Credentials credentials) : IQueryBackend
{
    /// <summary>Azure Database for PostgreSQL's Entra resource.</summary>
    private static readonly string[] EntraScope = ["https://ossrdbms-aad.database.windows.net/.default"];

    public const int DefaultPort = 5432;

    /// <summary>The database a connection opens when none is set: every server has it.</summary>
    public const string DefaultDatabase = "postgres";

    /// <summary>Listed last, as SQL Server's system databases are.</summary>
    private static readonly HashSet<string> SystemDatabases = ["postgres", "azure_maintenance", "azure_sys"];

    /// <summary>Folder, node kind and the pg_class relkinds it lists. Fixed here, never from the client.</summary>
    private static readonly Dictionary<string, (string Kind, string RelKinds)> RelationFolders = new()
    {
        ["tables"] = ("table", "'r','p'"),
        ["views"] = ("view", "'v'"),
        ["matviews"] = ("matview", "'m'"),
        ["sequences"] = ("sequence", "'S'"),
    };

    private static readonly Dictionary<string, (string Kind, char ProKind)> RoutineFolders = new()
    {
        ["functions"] = ("function", 'f'),
        ["procs"] = ("proc", 'p'),
    };

    /// <summary>System and temporary schemas, hidden from the tree.</summary>
    private const string UserSchemas =
        @"n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname NOT LIKE 'pg\_temp\_%' AND n.nspname NOT LIKE 'pg\_toast\_temp\_%'";

    private readonly ConcurrentDictionary<(string ConnectionId, string Database, string Settings), NpgsqlDataSource> _sources = new();

    public async Task<TreeNode[]> ChildrenAsync(ConnectionConfig c, string? secret, NodePath path, int start, CancellationToken ct)
    {
        var rel = path.From(start);
        var database = rel.Count > 0 ? rel[0].Value : c.Database;
        try
        {
            return await Children(c, secret, path, rel, ct);
        }
        catch (NpgsqlException ex)
        {
            throw PostgresErrors.ToRpc(ex, c, database);
        }
    }

    private async Task<TreeNode[]> Children(ConnectionConfig c, string? secret, NodePath path, IReadOnlyList<NodePath.Segment> rel, CancellationToken ct)
    {
        var shape = Nodes.Shape(rel);
        if (shape == "") return await Databases(c, secret, path, ct);

        var db = rel[0].Value;
        return shape switch
        {
            "db" =>
            [
                Nodes.Folder(path, "tables", "Tables"),
                Nodes.Folder(path, "views", "Views"),
                Nodes.Folder(path, "matviews", "Materialized views"),
                Nodes.Folder(path, "functions", "Functions"),
                Nodes.Folder(path, "procs", "Procedures"),
                Nodes.Folder(path, "sequences", "Sequences"),
            ],
            "db/f:tables" or "db/f:views" or "db/f:matviews" or "db/f:sequences" => await Relations(c, secret, db, path, rel[^1].Value, ct),
            "db/f:functions" or "db/f:procs" => await Routines(c, secret, db, path, rel[^1].Value, ct),
            "db/f:tables/o" =>
            [
                Nodes.Folder(path, "columns", "Columns"),
                Nodes.Folder(path, "keys", "Keys"),
                Nodes.Folder(path, "indexes", "Indexes"),
            ],
            "db/f:views/o" => [Nodes.Folder(path, "columns", "Columns")],
            "db/f:matviews/o" =>
            [
                Nodes.Folder(path, "columns", "Columns"),
                Nodes.Folder(path, "indexes", "Indexes"),
            ],
            "db/f:tables/o/f:columns" or "db/f:views/o/f:columns" or "db/f:matviews/o/f:columns" => await Columns(c, secret, db, path, rel[^2].Value, ct),
            "db/f:tables/o/f:keys" => await Keys(c, secret, db, path, rel[^2].Value, ct),
            "db/f:tables/o/f:indexes" or "db/f:matviews/o/f:indexes" => await Indexes(c, secret, db, path, rel[^2].Value, ct),
            _ => throw new RpcException(RpcException.InvalidParams, $"No children for {path}"),
        };
    }

    public async Task TestAsync(ConnectionConfig c, string? secret, CancellationToken ct)
    {
        try
        {
            await using var conn = await Open(c, secret, c.Database, ct);
            await using var cmd = new NpgsqlCommand("SELECT 1", conn);
            await cmd.ExecuteScalarAsync(ct);
        }
        catch (NpgsqlException ex)
        {
            throw PostgresErrors.ToRpc(ex, c, c.Database ?? DefaultDatabase);
        }
    }

    public IReadOnlyList<string> AuthsFor(string kind) => [AuthKinds.Entra, AuthKinds.Password];

    public void Forget(string connectionId)
    {
        foreach (var key in _sources.Keys.Where(k => k.ConnectionId == connectionId))
            if (_sources.TryRemove(key, out var source)) source.Dispose();
    }

    // --- Queries ----------------------------------------------------------------------------------------

    public string EditorLanguage => "pgsql";

    private static readonly HashSet<string> SelectableFolders = ["tables", "views", "matviews"];

    /// <summary>selectTop on a table, view or materialized view (the tree offers it there); any other action opens empty.</summary>
    public string? TemplateFor(NodePath path, string action)
    {
        if (action != "selectTop") return "";
        if (path.Count < 2 || path[path.Count - 1].Type != "o" || path[path.Count - 2] is not { Type: "f" } folder || !SelectableFolders.Contains(folder.Value))
            return null;
        var parts = NodePath.SplitParts(path[path.Count - 1].Value);
        return $"SELECT *\nFROM {QualifiedName(parts[0], parts[1])}\nLIMIT 1000;";
    }

    /// <summary>
    /// Runs the script one statement at a time (<see cref="PostgresStatements"/>) and stops at the first error, so
    /// statements before it stay done, as in psql and SSMS. In a read-only environment the server enforces it: the
    /// session's default_transaction_read_only is on and the script runs inside a read-only transaction that is rolled
    /// back at the end, so any write fails with 25006. A COMMIT or ROLLBACK in the script ends that transaction; the run
    /// stops right after it and reports Committed, so nothing runs in a transaction the script could have made writable.
    /// </summary>
    public async Task ExecuteAsync(QueryTarget target, string? secret, string text, IQuerySink sink, CancellationToken ct)
    {
        await using var conn = await Open(target.Connection, secret, target.Database, ct);
        NoticeEventHandler notices = (_, e) =>
            sink.Message("info", e.Notice.InvariantSeverity == "WARNING" ? $"WARNING: {e.Notice.MessageText}" : e.Notice.MessageText);
        conn.Notice += notices;

        var readOnly = target.Environment.ReadOnly;
        var committed = false;
        var failed = false;
        PostgresStatements.Statement? current = null;
        try
        {
            var guardStart = readOnly ? await BeginReadOnly(conn, ct) : default;
            foreach (var statement in PostgresStatements.Split(text))
            {
                current = statement;
                await Run(conn, statement, sink, ct);
                if (readOnly && PostgresStatements.EndsTransaction(statement) && await GuardEnded(conn, guardStart, ct))
                {
                    committed = true;
                    break;
                }
            }
            if (readOnly && !committed) committed = await GuardEnded(conn, guardStart, ct);
        }
        catch (PostgresException ex) when (!ct.IsCancellationRequested)
        {
            failed = true;
            var error = ToQueryError(text, current, ex.SqlState, ex.MessageText, ex.Position, ex.Where, ex.Detail, ex.Hint);
            sink.Fail(error.Text, [error]);
        }
        finally
        {
            // ROLLBACK with no transaction open only warns; that is not the script's notice.
            conn.Notice -= notices;
            if (readOnly) await EndReadOnly(sink, target, conn, committed, failed);
        }
    }

    /// <summary>
    /// One statement, with text format results (see <see cref="PostgresValues"/>). Npgsql parses a command's text for
    /// semicolons as the splitter does, except inside a BEGIN ATOMIC body, which it would split: that statement (a
    /// CREATE FUNCTION or PROCEDURE, so no rows) goes as a batch command, which Npgsql sends as written.
    /// </summary>
    private static async Task Run(NpgsqlConnection conn, PostgresStatements.Statement statement, IQuerySink sink, CancellationToken ct)
    {
        if (statement.Atomic)
        {
            await using var batch = new NpgsqlBatch(conn) { Timeout = 0, BatchCommands = { new NpgsqlBatchCommand(statement.Text) } };
            await batch.ExecuteNonQueryAsync(ct);
            return;
        }
        await using var cmd = new NpgsqlCommand(statement.Text, conn) { CommandTimeout = 0, AllResultTypesAreUnknown = true };
        var setsBefore = sink.SetCount;
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        do
        {
            if (reader.FieldCount > 0) await StreamSet(sink, reader, ct);
        } while (await reader.NextResultAsync(ct));
        await reader.CloseAsync();
        if (reader.RecordsAffected >= 0 && sink.SetCount == setsBefore)
            sink.Message("info", $"({reader.RecordsAffected} row{(reader.RecordsAffected == 1 ? "" : "s")} affected)");
    }

    private static async Task StreamSet(IQuerySink sink, NpgsqlDataReader reader, CancellationToken ct)
    {
        var index = sink.BeginSet();
        var columns = Enumerable.Range(0, reader.FieldCount).Select(i => new ResultColumn(reader.GetName(i), reader.GetDataTypeName(i))).ToArray();
        var types = Enumerable.Range(0, reader.FieldCount).Select(reader.GetDataTypeOID).ToArray();
        var batch = new List<object?[]>(sink.BatchSize);
        var first = true;

        while (await reader.ReadAsync(ct))
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < row.Length; i++) row[i] = reader.IsDBNull(i) ? null : PostgresValues.FromText(types[i], reader.GetString(i));
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

    /// <summary>Starts the read-only guard and returns its transaction's start time. The SELECT takes the transaction's
    /// snapshot, after which SET TRANSACTION READ WRITE is refused (25001). The SET is its own command so that it is
    /// not part of the transaction: a ROLLBACK in the script does not undo it.</summary>
    private static async Task<DateTime> BeginReadOnly(NpgsqlConnection conn, CancellationToken ct)
    {
        foreach (var sql in new[] { "SET default_transaction_read_only = on", "BEGIN READ ONLY" })
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        return await TransactionStart(conn, ct);
    }

    /// <summary>Whether the guard's transaction has ended: the connection's transaction is no longer the one that
    /// started at <paramref name="guardStart"/> (none is open and the check runs in its own, or the script began one).</summary>
    private static async Task<bool> GuardEnded(NpgsqlConnection conn, DateTime guardStart, CancellationToken ct) =>
        await TransactionStart(conn, ct) != guardStart;

    private static async Task<DateTime> TransactionStart(NpgsqlConnection conn, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("SELECT transaction_timestamp()", conn);
        return (DateTime)(await cmd.ExecuteScalarAsync(ct))!;
    }

    /// <summary>Rolls back the guard (and any transaction the script left open), and reports how the guard ended.</summary>
    private static async Task EndReadOnly(IQuerySink sink, QueryTarget target, NpgsqlConnection conn, bool committed, bool failed)
    {
        try
        {
            await using var cmd = new NpgsqlCommand("ROLLBACK", conn);
            await cmd.ExecuteNonQueryAsync(CancellationToken.None);
        }
        catch (Exception ex) when (!committed && ex is NpgsqlException or InvalidOperationException)
        {
            sink.Message("error", $"{target.Environment.Name} is read-only, but the rollback failed: {ex.Message}. "
                + "The transaction was read-only, so the server refused any writes, and it ends when the connection closes.");
            return;
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException)
        {
            // The connection is discarded next anyway.
        }

        if (committed)
        {
            sink.Committed();
            sink.Message("error", "A COMMIT or ROLLBACK in this script ended the read-only guard, so the run stopped there: "
                + "the statements after it were not run. The server refused writes until then.");
        }
        else
        {
            sink.RolledBack();
            sink.Message("info", SqlBackend.RolledBackMessage(target.Environment.Name, failed));
        }
    }

    /// <summary>
    /// A server error as the UI gets it, with DETAIL and HINT lines as psql prints them. <paramref name="position"/> is
    /// a 1-based character offset into the failed statement, which becomes a script line and column. An error with no
    /// position (division by zero) gets the statement's first line. One inside a function names the function instead
    /// and gets no script line: its position would be in the function's body.
    /// </summary>
    public static QueryError ToQueryError(string script, PostgresStatements.Statement? statement, string state, string message, int position,
        string? where, string? detail, string? hint)
    {
        var text = message;
        if (!string.IsNullOrEmpty(detail)) text += $"\nDETAIL: {detail}";
        if (!string.IsNullOrEmpty(hint)) text += $"\nHINT: {hint}";
        if (statement is null) return new QueryError(0, null, text, state);
        if (position > 0)
        {
            var (line, column) = PostgresStatements.Locate(script, statement, position);
            return new QueryError(0, line, $"Line {line}: {text}", state, column);
        }
        if (!string.IsNullOrEmpty(where)) return new QueryError(0, null, $"{where.Split('\n')[0]}: {text}", state);
        var (startLine, _) = PostgresStatements.LineAndColumn(script, statement.Start);
        return new QueryError(0, startLine, $"Line {startLine}: {text}", state);
    }

    // --- IntelliSense catalog ---------------------------------------------------------------------------

    public async Task<string?> CatalogStampAsync(QueryTarget target, string? secret, CancellationToken ct)
    {
        await using var conn = await Open(target.Connection, secret, target.Database, ct);
        try
        {
            return await PostgresCatalog.StampAsync(conn, ct);
        }
        catch (PostgresException)
        {
            return null; // no cheap check here: the catalog is rebuilt once per session
        }
    }

    public async Task<DatabaseCatalog> CatalogAsync(QueryTarget target, string? secret, EditorSettings editor, CancellationToken ct)
    {
        await using var conn = await Open(target.Connection, secret, target.Database, ct);
        return await PostgresCatalog.BuildAsync(conn, ct);
    }

    // --- Names -----------------------------------------------------------------------------------------

    private static readonly HashSet<string> Keywords = [.. PostgresKeywords.All];

    /// <summary>
    /// Quotes a name only where Postgres needs it, like quote_ident(): a lowercase ASCII letter or underscore, then
    /// lowercase letters, digits and underscores, and not a keyword, stays bare. Anything else (uppercase, which an
    /// unquoted name would fold to lowercase, spaces, other characters) is double-quoted with quotes doubled.
    /// </summary>
    public static string QuoteIdentifier(string name) =>
        IsPlainIdentifier(name) && !Keywords.Contains(name) ? name : $"\"{name.Replace("\"", "\"\"")}\"";

    private static bool IsPlainIdentifier(string name) =>
        name.Length > 0 && name[0] is (>= 'a' and <= 'z') or '_' && name.All(ch => ch is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '_');

    public static string QualifiedName(string schema, string name) => $"{QuoteIdentifier(schema)}.{QuoteIdentifier(name)}";

    // --- Tree queries ----------------------------------------------------------------------------------

    private async Task<TreeNode[]> Databases(ConnectionConfig c, string? secret, NodePath path, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(c.Database))
            return [DatabaseNode(path, c.Database, system: false)];

        const string sql = "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn";
        var names = await Query(c, secret, null, sql, null, r => r.GetString(0), ct);
        return names
            .OrderBy(n => SystemDatabases.Contains(n))
            .ThenBy(n => n, StringComparer.OrdinalIgnoreCase)
            .Select(n => DatabaseNode(path, n, SystemDatabases.Contains(n)))
            .ToArray();
    }

    private static TreeNode DatabaseNode(NodePath path, string name, bool system) =>
        Nodes.Branch(path.Child("db", name), "database", name, "database",
            new() { ["system"] = system ? "true" : "false", ["dragText"] = QuoteIdentifier(name), ["copyText"] = QuoteIdentifier(name) }, Nodes.Queryable);

    private async Task<TreeNode[]> Relations(ConnectionConfig c, string? secret, string db, NodePath path, string folder, CancellationToken ct)
    {
        var (kind, relKinds) = RelationFolders[folder];
        // Partitions are listed under nothing: the partitioned table stands for them. An identity column's sequence
        // (a sequence with an internal dependency) belongs to its column, so it is not listed either.
        var sql = $"""
            SELECT n.nspname, c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ({relKinds}) AND NOT c.relispartition AND {UserSchemas}
              AND (c.relkind <> 'S' OR NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'i'))
            ORDER BY n.nspname, c.relname
            """;
        var rows = await Query(c, secret, db, sql, null, r => (Schema: r.GetString(0), Name: r.GetString(1)), ct);
        return rows.Select(o =>
        {
            var id = path.Child("o", o.Schema, o.Name);
            var meta = ObjectMeta(o.Schema, o.Name, QualifiedName(o.Schema, o.Name));
            return kind == "sequence"
                ? Nodes.Leaf(id, kind, $"{o.Schema}.{o.Name}", kind, meta)
                : Nodes.Branch(id, kind, $"{o.Schema}.{o.Name}", kind, meta, Nodes.Selectable);
        }).ToArray();
    }

    private async Task<TreeNode[]> Routines(ConnectionConfig c, string? secret, string db, NodePath path, string folder, CancellationToken ct)
    {
        var (kind, proKind) = RoutineFolders[folder];
        // Functions an extension installed (pgcrypto, PostGIS) are left out: there can be hundreds.
        var sql = $"""
            SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.prokind = '{proKind}' AND {UserSchemas}
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
            ORDER BY n.nspname, p.proname, 3
            """;
        var rows = await Query(c, secret, db, sql, null, r => (Schema: r.GetString(0), Name: r.GetString(1), Args: r.GetString(2)), ct);
        // Overloads share a name, so the label and id carry the argument types; copy name is the name alone.
        return rows.Select(o => Nodes.Leaf(path.Child("o", o.Schema, o.Name, o.Args), kind, $"{o.Schema}.{o.Name}({o.Args})", kind,
            ObjectMeta(o.Schema, o.Name, QualifiedName(o.Schema, o.Name)))).ToArray();
    }

    private static Dictionary<string, string> ObjectMeta(string schema, string name, string qualified) => new()
    {
        ["schema"] = schema,
        ["name"] = name,
        ["dragText"] = qualified,
        ["copyText"] = qualified,
    };

    /// <summary>The relation an object node names, by schema and name as parameters, so nothing needs quoting.</summary>
    private const string RelationOid =
        "(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2)";

    private async Task<TreeNode[]> Columns(ConnectionConfig c, string? secret, string db, NodePath path, string obj, CancellationToken ct)
    {
        var sql = $"""
            SELECT a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity <> '', a.attgenerated <> '',
                   EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = a.attrelid AND k.contype = 'p' AND a.attnum = ANY (k.conkey))
            FROM pg_attribute a
            WHERE a.attrelid = {RelationOid} AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum
            """;
        var rows = await Query(c, secret, db, sql, ObjectParams(obj), r => new
        {
            Name = r.GetString(0),
            Type = r.GetString(1),
            NotNull = r.GetBoolean(2),
            Identity = r.GetBoolean(3),
            Generated = r.GetBoolean(4),
            Pk = r.GetBoolean(5),
        }, ct);

        return rows.Select(col =>
        {
            var details = new List<string>();
            if (col.Pk) details.Add("PK");
            details.Add(col.Type);
            if (col.Identity) details.Add("identity");
            if (col.Generated) details.Add("generated");
            details.Add(col.NotNull ? "not null" : "null");
            var quoted = QuoteIdentifier(col.Name);
            return Nodes.Leaf(path.Child("col", col.Name), "column", $"{col.Name} ({string.Join(", ", details)})",
                col.Pk ? "key" : "column", new() { ["name"] = col.Name, ["type"] = col.Type, ["dragText"] = quoted, ["copyText"] = quoted });
        }).ToArray();
    }

    private async Task<TreeNode[]> Keys(ConnectionConfig c, string? secret, string db, NodePath path, string obj, CancellationToken ct)
    {
        var sql = $"""
            SELECT k.conname, k.contype::text
            FROM pg_constraint k
            WHERE k.conrelid = {RelationOid} AND k.contype IN ('p', 'u', 'f')
            ORDER BY array_position(ARRAY['p', 'u', 'f'], k.contype::text), k.conname
            """;
        var rows = await Query(c, secret, db, sql, ObjectParams(obj), r => (Name: r.GetString(0), Type: r.GetString(1)), ct);
        return rows.Select(k =>
        {
            var type = k.Type switch
            {
                "p" => "primary key",
                "u" => "unique",
                _ => "foreign key",
            };
            return Nodes.Leaf(path.Child("key", k.Name), "key", $"{k.Name} ({type})", "key", new() { ["copyText"] = QuoteIdentifier(k.Name) });
        }).ToArray();
    }

    private async Task<TreeNode[]> Indexes(ConnectionConfig c, string? secret, string db, NodePath path, string obj, CancellationToken ct)
    {
        var sql = $"""
            SELECT ic.relname, am.amname, i.indisunique
            FROM pg_index i
            JOIN pg_class ic ON ic.oid = i.indexrelid
            JOIN pg_am am ON am.oid = ic.relam
            WHERE i.indrelid = {RelationOid}
            ORDER BY ic.relname
            """;
        var rows = await Query(c, secret, db, sql, ObjectParams(obj), r => (Name: r.GetString(0), Method: r.GetString(1), Unique: r.GetBoolean(2)), ct);
        return rows.Select(i =>
            Nodes.Leaf(path.Child("ix", i.Name), "index", $"{i.Name} ({(i.Unique ? "unique, " : "")}{i.Method})", "index",
                new() { ["copyText"] = QuoteIdentifier(i.Name) })).ToArray();
    }

    private static NpgsqlParameter[] ObjectParams(string obj)
    {
        var parts = NodePath.SplitParts(obj);
        return [new NpgsqlParameter { Value = parts[0] }, new NpgsqlParameter { Value = parts[1] }];
    }

    private async Task<List<T>> Query<T>(ConnectionConfig c, string? secret, string? db, string sql, NpgsqlParameter[]? parameters,
        Func<NpgsqlDataReader, T> map, CancellationToken ct)
    {
        await using var conn = await Open(c, secret, db, ct);
        await using var cmd = new NpgsqlCommand(sql, conn);
        if (parameters is not null) cmd.Parameters.AddRange(parameters);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var results = new List<T>();
        while (await reader.ReadAsync(ct)) results.Add(map(reader));
        return results;
    }

    // --- Connections -----------------------------------------------------------------------------------

    /// <summary>Splits <c>host</c>, <c>host:port</c> or <c>[ipv6]:port</c>. Throws on an unusable endpoint.</summary>
    public static (string Host, int Port) ParseEndpoint(string endpoint)
    {
        var text = endpoint.Trim();
        string host;
        string? port = null;
        if (text.StartsWith('['))
        {
            var close = text.IndexOf(']');
            if (close < 0) throw BadEndpoint(endpoint);
            host = text[1..close];
            var rest = text[(close + 1)..];
            if (rest.Length > 0)
            {
                if (!rest.StartsWith(':')) throw BadEndpoint(endpoint);
                port = rest[1..];
            }
        }
        else
        {
            var colon = text.IndexOf(':');
            // More than one colon without brackets is a bare IPv6 address with no port.
            if (colon >= 0 && colon == text.LastIndexOf(':'))
            {
                host = text[..colon];
                port = text[(colon + 1)..];
            }
            else host = text;
        }
        if (host.Length == 0 || host.Any(ch => char.IsWhiteSpace(ch) || char.IsControl(ch))) throw BadEndpoint(endpoint);
        if (port is null) return (host, DefaultPort);
        return int.TryParse(port, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var p) && p is > 0 and <= 65535
            ? (host, p)
            : throw BadEndpoint(endpoint);
    }

    private static RpcException BadEndpoint(string endpoint) =>
        new(RpcException.InvalidParams, $"Invalid Postgres server '{endpoint}'. Use host or host:port.");

    /// <summary>The connection string for one database. The password or token is supplied separately.</summary>
    public static NpgsqlConnectionStringBuilder Settings(ConnectionConfig c, string? database, string? user)
    {
        var (host, port) = ParseEndpoint(c.Endpoint);
        return new NpgsqlConnectionStringBuilder
        {
            Host = host,
            Port = port,
            Database = string.IsNullOrWhiteSpace(database) ? (string.IsNullOrWhiteSpace(c.Database) ? DefaultDatabase : c.Database) : database,
            Username = user,
            // Always encrypted. Trust server certificate encrypts without validating (local and dev servers only);
            // otherwise the certificate chain and host name are verified.
            SslMode = c.TrustServerCertificate ? SslMode.Require : SslMode.VerifyFull,
            Timeout = 15,
            CommandTimeout = 30,
            ApplicationName = "Panoptic",
        };
    }

    private async Task<NpgsqlConnection> Open(ConnectionConfig c, string? secret, string? database, CancellationToken ct)
    {
        string? user = c.User;
        Func<NpgsqlConnectionStringBuilder, CancellationToken, ValueTask<string>>? tokens = null;
        switch (c.Auth)
        {
            case AuthKinds.Password:
                if (string.IsNullOrWhiteSpace(user)) throw new RpcException(RpcException.InvalidParams, "User is required");
                break;
            case AuthKinds.Entra:
                var credential = credentials.For(c.TenantId);
                var token = await SignInAsync(credential, SignInBudget, c, database, ct);
                if (string.IsNullOrWhiteSpace(user)) user = EntraUser(token.Token)
                    ?? throw new RpcException(RpcException.InvalidParams, "Enter the Entra user name (the role's name on the server): it could not be read from the sign-in.");
                tokens = async (_, t) => (await credential.GetTokenAsync(new TokenRequestContext(EntraScope), t)).Token;
                break;
            default:
                throw new RpcException(RpcException.InvalidParams, $"Postgres does not support auth '{c.Auth}'");
        }

        var settings = Settings(c, database, user);
        var key = (c.Id, settings.Database!, $"{settings.ConnectionString};auth={c.Auth};tenant={c.TenantId}");
        var source = _sources.GetOrAdd(key, _ =>
        {
            var builder = new NpgsqlDataSourceBuilder(settings.ConnectionString);
            if (tokens is not null) builder.UsePasswordProvider(_ => throw new NotSupportedException("Postgres connections open asynchronously."), tokens);
            else builder.ConnectionStringBuilder.Password = secret ?? "";
            return builder.Build();
        });
        return await source.OpenConnectionAsync(ct);
    }

    /// <summary>
    /// How long an Entra open waits for sign-in, as for SQL Server (<see cref="SqlBackend.SignInBudget"/>): the 15 s
    /// connect timeout is too short to finish a WAM or device-code prompt.
    /// </summary>
    public static readonly TimeSpan SignInBudget = SqlBackend.SignInBudget;

    /// <summary>Gets a token before connecting, under the request's cancellation and <paramref name="budget"/>, so the
    /// password provider Npgsql then calls is a silent MSAL cache hit.</summary>
    public static async Task<AccessToken> SignInAsync(TokenCredential credential, TimeSpan budget, ConnectionConfig c, string? database, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(budget);
        try
        {
            return await credential.GetTokenAsync(new TokenRequestContext(EntraScope), cts.Token).AsTask().WaitAsync(cts.Token);
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested && !ct.IsCancellationRequested)
        {
            throw SqlErrors.SignInTimedOut(c, database, budget);
        }
    }

    /// <summary>
    /// The signed-in user's name from an Entra access token (upn, then preferred_username, then unique_name), which is
    /// what Azure Database for PostgreSQL expects as the user name. Null when the token has none, as for a service
    /// principal. The token is only decoded, not validated: the server validates it.
    /// </summary>
    public static string? EntraUser(string accessToken)
    {
        var parts = accessToken.Split('.');
        if (parts.Length < 2) return null;
        try
        {
            var payload = parts[1].Replace('-', '+').Replace('_', '/');
            payload = payload.PadRight(payload.Length + (4 - payload.Length % 4) % 4, '=');
            using var doc = JsonDocument.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(payload)));
            foreach (var claim in new[] { "upn", "preferred_username", "unique_name" })
                if (doc.RootElement.TryGetProperty(claim, out var value) && value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 0 } name)
                    return name;
        }
        catch (Exception ex) when (ex is FormatException or JsonException)
        {
        }
        return null;
    }
}
