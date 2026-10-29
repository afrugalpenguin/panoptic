using Microsoft.Data.SqlClient;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Catalog;

/// <summary>
/// Builds a SQL Server, Azure SQL or Synapse database's catalog from sys.* views: one round trip, or one per
/// statement on serverless Synapse pools, which reject some multi-statement batches.
/// </summary>
public static class SqlCatalog
{
    public sealed record ObjectRow(int ObjectId, string Name, string Schema, string Type);
    public sealed record MemberRow(int ObjectId, string Name, string Type, short MaxLength, byte Precision, byte Scale, bool Flag);

    /// <summary>Changes whenever an object is created, altered or dropped.</summary>
    public const string StampSql =
        "SELECT ISNULL(CONVERT(varchar(33), MAX(modify_date), 126), '') + '|' + CAST(COUNT(*) AS varchar(12)) FROM sys.objects";

    private static readonly string[] Statements =
    [
        StampSql,
        "SELECT name FROM sys.schemas WHERE schema_id < 16384 AND name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest') ORDER BY name",
        """
        SELECT o.object_id, o.name, s.name, o.type FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.type IN ('U', 'V', 'P', 'FN', 'IF', 'TF', 'SN') AND o.is_ms_shipped = 0
        """,
        """
        SELECT c.object_id, c.name, t.name, c.max_length, c.precision, c.scale, c.is_nullable FROM sys.columns c
        JOIN sys.types t ON t.user_type_id = c.user_type_id JOIN sys.objects o ON o.object_id = c.object_id
        WHERE o.type IN ('U', 'V', 'IF', 'TF') AND o.is_ms_shipped = 0 ORDER BY c.object_id, c.column_id
        """,
        """
        SELECT p.object_id, p.name, t.name, p.max_length, p.precision, p.scale, p.is_output FROM sys.parameters p
        JOIN sys.types t ON t.user_type_id = p.user_type_id JOIN sys.objects o ON o.object_id = p.object_id
        WHERE o.type IN ('P', 'FN', 'IF', 'TF') AND o.is_ms_shipped = 0 AND p.parameter_id > 0 ORDER BY p.object_id, p.parameter_id
        """,
        "SELECT name FROM sys.types ORDER BY name",
    ];

    public static async Task<string> StampAsync(SqlConnection conn, CancellationToken ct)
    {
        await using var cmd = new SqlCommand(StampSql, conn) { CommandTimeout = 30 };
        return (string)(await cmd.ExecuteScalarAsync(ct))!;
    }

    public static async Task<DatabaseCatalog> BuildAsync(SqlConnection conn, CancellationToken ct)
    {
        bool serverless;
        await using (var probe = new SqlCommand("SELECT CAST(SERVERPROPERTY('EngineEdition') AS int)", conn) { CommandTimeout = 30 })
            serverless = (int)(await probe.ExecuteScalarAsync(ct))! == 11;
        string[] batches = serverless ? Statements : [string.Join(";\n", Statements)];

        var stamp = "";
        var schemas = new List<string>();
        var objects = new List<ObjectRow>();
        var columns = new List<MemberRow>();
        var parameters = new List<MemberRow>();
        var types = new List<string>();
        var set = 0; // result sets arrive in Statements order, whether batched or not
        foreach (var text in batches)
        {
            await using var cmd = new SqlCommand(text, conn) { CommandTimeout = 120 };
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            do
            {
                while (await reader.ReadAsync(ct))
                {
                    switch (set)
                    {
                        case 0: stamp = reader.GetString(0); break;
                        case 1: schemas.Add(reader.GetString(0)); break;
                        case 2: objects.Add(new(reader.GetInt32(0), reader.GetString(1), reader.GetString(2), reader.GetString(3))); break;
                        case 3: columns.Add(Member(reader)); break;
                        case 4: parameters.Add(Member(reader)); break;
                        case 5: types.Add(reader.GetString(0)); break;
                    }
                }
                set++;
            } while (await reader.NextResultAsync(ct));
        }
        return Assemble(stamp, schemas, objects, columns, parameters, types);
    }

    private static MemberRow Member(SqlDataReader r) =>
        new(r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetInt16(3), r.GetByte(4), r.GetByte(5), r.GetBoolean(6));

    /// <summary>Pure: joins the sys.* rows into the catalog shape. Member rows arrive ordered by object then position.</summary>
    public static DatabaseCatalog Assemble(string stamp, IEnumerable<string> schemas, IEnumerable<ObjectRow> objects,
        IEnumerable<MemberRow> columns, IEnumerable<MemberRow> parameters, IEnumerable<string> types)
    {
        var columnsBy = columns.GroupBy(c => c.ObjectId).ToDictionary(g => g.Key,
            g => g.Select(c => new ColumnRef(c.Name, SqlBackend.FormatType(c.Type, c.MaxLength, c.Precision, c.Scale), c.Flag)).ToArray());
        var paramsBy = parameters.GroupBy(p => p.ObjectId).ToDictionary(g => g.Key,
            g => g.Select(p => new ParamRef(p.Name, SqlBackend.FormatType(p.Type, p.MaxLength, p.Precision, p.Scale), p.Flag)).ToArray());

        var list = objects
            .OrderBy(o => o.Schema, StringComparer.OrdinalIgnoreCase).ThenBy(o => o.Name, StringComparer.OrdinalIgnoreCase)
            .Select(o =>
            {
                var kind = Kind(o.Type);
                var hasColumns = kind is ObjectKinds.Table or ObjectKinds.View || (kind == ObjectKinds.Fn && columnsBy.ContainsKey(o.ObjectId));
                var hasParams = kind is ObjectKinds.Proc or ObjectKinds.Fn;
                return new CatalogObject(o.Name, o.Schema, kind,
                    hasColumns ? columnsBy.GetValueOrDefault(o.ObjectId, []) : null,
                    hasParams ? paramsBy.GetValueOrDefault(o.ObjectId, []) : null);
            })
            .ToArray();
        return new DatabaseCatalog(stamp, schemas.ToArray(), list, types.ToArray(), null);
    }

    private static string Kind(string type) => type.Trim() switch
    {
        "U" => ObjectKinds.Table,
        "V" => ObjectKinds.View,
        "P" => ObjectKinds.Proc,
        "SN" => ObjectKinds.Synonym,
        _ => ObjectKinds.Fn,
    };
}
