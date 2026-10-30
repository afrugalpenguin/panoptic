using Npgsql;

namespace Panoptic.Sidecar.Catalog;

/// <summary>
/// Builds a Postgres database's catalog from pg_catalog in one round trip: the objects the explorer tree lists (no
/// partitions, system schemas or extension functions), their columns, and routine arguments.
/// </summary>
public static class PostgresCatalog
{
    /// <param name="Key">"c" and the pg_class oid for a relation, "p" and the pg_proc oid for a routine: oids are only
    /// unique within one catalog table.</param>
    public sealed record ObjectRow(string Key, string Name, string Schema, string Kind);
    public sealed record ColumnRow(string Key, string Name, string Type, bool Nullable);
    /// <param name="Mode">pg_proc.proargmodes: i in, o out, b inout, v variadic, t a RETURNS TABLE column.</param>
    public sealed record ArgRow(string Key, string Name, string Type, string Mode);

    private const string UserSchemas =
        @"n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND n.nspname NOT LIKE 'pg\_temp\_%' AND n.nspname NOT LIKE 'pg\_toast\_temp\_%'";

    private const string Relations = "pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace";
    private const string RelationsWhere = $"c.relkind IN ('r', 'p', 'f', 'v', 'm') AND NOT c.relispartition AND {UserSchemas}";
    private const string Routines = "pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace";
    private const string RoutinesWhere = $"""
        p.prokind IN ('f', 'p') AND {UserSchemas}
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
        """;

    /// <summary>
    /// Changes whenever an object is created, altered or dropped: each catalog's row count and the sum of its rows'
    /// xmin, which changes when any row is replaced (DDL writes a new row version; statistics updates are in place
    /// and leave it alone). Other sessions' temporary tables are left out.
    /// </summary>
    public const string StampSql = """
        SELECT concat_ws('|',
          (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM pg_class WHERE relpersistence <> 't'),
          (SELECT count(*) || ':' || coalesce(sum(a.xmin::text::bigint), 0) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid WHERE c.relpersistence <> 't'),
          (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM pg_proc),
          (SELECT count(*) || ':' || coalesce(sum(xmin::text::bigint), 0) FROM pg_namespace))
        """;

    private static readonly string Script = string.Join(";\n",
        StampSql,
        $"SELECT n.nspname FROM pg_namespace n WHERE {UserSchemas} ORDER BY 1",
        $"""
        SELECT 'c' || c.oid, c.relname, n.nspname, CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END
        FROM {Relations} WHERE {RelationsWhere}
        UNION ALL
        SELECT 'p' || p.oid, p.proname, n.nspname, CASE p.prokind WHEN 'p' THEN 'proc' ELSE 'fn' END
        FROM {Routines} WHERE {RoutinesWhere}
        """,
        $"""
        SELECT 'c' || c.oid, a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull
        FROM {Relations} JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE {RelationsWhere} AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY c.oid, a.attnum
        """,
        $"""
        SELECT 'p' || p.oid, coalesce(a.name, ''), format_type(a.type, NULL), coalesce(a.mode, 'i')
        FROM {Routines}
        CROSS JOIN LATERAL unnest(coalesce(p.proallargtypes, p.proargtypes::oid[]), p.proargmodes::text[], p.proargnames) WITH ORDINALITY AS a(type, mode, name, ord)
        WHERE {RoutinesWhere} AND a.type IS NOT NULL
        ORDER BY p.oid, a.ord
        """,
        """
        SELECT DISTINCT format_type(t.oid, NULL) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype IN ('b', 'd', 'e', 'r', 'm') AND t.typcategory <> 'A' AND n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\_%temp\_%'
        ORDER BY 1
        """);

    public static async Task<string> StampAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(StampSql, conn);
        return (string)(await cmd.ExecuteScalarAsync(ct))!;
    }

    public static async Task<DatabaseCatalog> BuildAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        var stamp = "";
        var schemas = new List<string>();
        var objects = new List<ObjectRow>();
        var columns = new List<ColumnRow>();
        var args = new List<ArgRow>();
        var types = new List<string>();
        await using var cmd = new NpgsqlCommand(Script, conn) { CommandTimeout = 120 };
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        var set = 0;
        do
        {
            while (await reader.ReadAsync(ct))
            {
                switch (set)
                {
                    case 0: stamp = reader.GetString(0); break;
                    case 1: schemas.Add(reader.GetString(0)); break;
                    case 2: objects.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3))); break;
                    case 3: columns.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetBoolean(3))); break;
                    case 4: args.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3))); break;
                    case 5: types.Add(reader.GetString(0)); break;
                }
            }
            set++;
        } while (await reader.NextResultAsync(ct));
        return Assemble(stamp, schemas, objects, columns, args, types);
    }

    /// <summary>
    /// Pure: joins the pg_catalog rows into the catalog shape. Member rows arrive ordered by object then position.
    /// A function's parameters are its inputs; its OUT and RETURNS TABLE arguments are the columns it returns. A
    /// procedure's parameters are all its arguments, OUT ones marked as output.
    /// </summary>
    public static DatabaseCatalog Assemble(string stamp, IEnumerable<string> schemas, IEnumerable<ObjectRow> objects,
        IEnumerable<ColumnRow> columns, IEnumerable<ArgRow> args, IEnumerable<string> types)
    {
        var columnsBy = columns.GroupBy(c => c.Key).ToDictionary(g => g.Key, g => g.Select(c => new ColumnRef(c.Name, c.Type, c.Nullable)).ToArray());
        var argsBy = args.GroupBy(a => a.Key).ToDictionary(g => g.Key, g => g.ToList());

        var list = objects
            .OrderBy(o => o.Schema, StringComparer.OrdinalIgnoreCase).ThenBy(o => o.Name, StringComparer.OrdinalIgnoreCase)
            .Select(o =>
            {
                if (o.Kind is ObjectKinds.Table or ObjectKinds.View)
                    return new CatalogObject(o.Name, o.Schema, o.Kind, columnsBy.GetValueOrDefault(o.Key, []), null);
                var all = argsBy.GetValueOrDefault(o.Key, []);
                var inputs = 0;
                ParamRef Param(ArgRow a) => new(a.Name.Length > 0 ? a.Name : $"${inputs}", a.Type, a.Mode is "o" or "b");
                if (o.Kind == ObjectKinds.Proc)
                    return new CatalogObject(o.Name, o.Schema, o.Kind, null, all.Select(a => { inputs++; return Param(a); }).ToArray());
                var parameters = all.Where(a => a.Mode is "i" or "b" or "v").Select(a => { inputs++; return Param(a) with { Output = false }; }).ToArray();
                var outputs = all.Where(a => a.Mode is "o" or "b" or "t").Select(a => new ColumnRef(a.Name, a.Type, true)).ToArray();
                return new CatalogObject(o.Name, o.Schema, o.Kind, outputs.Length > 0 ? outputs : null, parameters);
            })
            .ToArray();
        return new DatabaseCatalog(stamp, schemas.ToArray(), list, types.ToArray(), null);
    }
}
