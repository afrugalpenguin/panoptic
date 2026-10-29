using Azure.Core;
using Microsoft.Data.SqlClient;

namespace Panoptic.Sidecar.Backends;

/// <summary>
/// SQL Server, Azure SQL and Synapse SQL pools. One catalog query per expand, never one per child. Each expand opens
/// a pooled connection in the target database (no USE, so it works on Azure SQL).
/// </summary>
public sealed class SqlBackend(Credentials credentials) : IBackend
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

    public async Task<TreeNode[]> ChildrenAsync(ConnectionConfig c, string? secret, NodePath path, int start, CancellationToken ct)
    {
        var rel = path.From(start);
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

    private async Task<TreeNode[]> Databases(ConnectionConfig c, string? secret, NodePath path, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(c.Database))
            return [DatabaseNode(path, c.Database, system: false)];

        const string sql = """
            SELECT name FROM sys.databases
            WHERE state = 0 AND HAS_DBACCESS(name) = 1
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
        Nodes.Branch(path.Child("db", name), "database", name, "database", new() { ["system"] = system ? "true" : "false" });

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
            var meta = new Dictionary<string, string> { ["schema"] = o.Schema, ["name"] = o.Name };
            if (kind == "synonym")
            {
                meta["baseObject"] = o.Base;
                return Nodes.Leaf(id, kind, $"{o.Schema}.{o.Name}", kind, meta);
            }
            return Nodes.Branch(id, kind, $"{o.Schema}.{o.Name}", kind, meta);
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
                col.Pk ? "key" : "column", new() { ["name"] = col.Name, ["type"] = col.Type });
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
            return Nodes.Leaf(path.Child("key", k.Name), "key", $"{k.Name} ({type})", "key");
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
                $"{i.Name} ({(i.Unique ? "unique, " : "")}{i.Type.ToLowerInvariant().Replace('_', ' ')})", "index")).ToArray();
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

    private async Task<SqlConnection> Open(ConnectionConfig c, string? secret, string? database, CancellationToken ct)
    {
        var builder = new SqlConnectionStringBuilder
        {
            DataSource = c.Endpoint,
            InitialCatalog = database ?? c.Database ?? "",
            ConnectTimeout = 15,
            Encrypt = SqlConnectionEncryptOption.Mandatory,
            TrustServerCertificate = c.TrustServerCertificate,
            ApplicationName = "Panoptic",
        };

        SqlConnection conn;
        switch (c.Auth)
        {
            case AuthKinds.Sql:
                builder.UserID = c.User ?? "";
                builder.Password = secret ?? "";
                conn = new SqlConnection(builder.ConnectionString);
                break;
            case AuthKinds.Entra:
                var credential = credentials.For(c.TenantId);
                conn = new SqlConnection(builder.ConnectionString)
                {
                    AccessTokenCallback = async (_, token) =>
                    {
                        var t = await credential.GetTokenAsync(new TokenRequestContext(SqlScope), token);
                        return new SqlAuthenticationToken(t.Token, t.ExpiresOn);
                    },
                };
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
            throw new RpcException(RpcException.OperationFailed, ex.Message);
        }
    }
}
