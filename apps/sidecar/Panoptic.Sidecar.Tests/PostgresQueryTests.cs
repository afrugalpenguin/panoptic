using Npgsql;
using Panoptic.Sidecar.Backends;
using Panoptic.Sidecar.Catalog;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Tests;

public class PostgresStatementTests
{
    private static string[] Texts(string script) => PostgresStatements.Split(script).Select(s => s.Text).ToArray();

    [Fact]
    public void Splits_on_top_level_semicolons_only()
    {
        Assert.Equal(["SELECT 1", "SELECT 2"], Texts("SELECT 1;\n  SELECT 2"));
        Assert.Equal(["SELECT ';' AS a", "SELECT \"x;y\""], Texts("SELECT ';' AS a; SELECT \"x;y\";"));
        Assert.Equal(["SELECT 'it''s; here'"], Texts("SELECT 'it''s; here'"));
        Assert.Equal(["SELECT E'a\\';b'", "SELECT 2"], Texts("SELECT E'a\\';b'; SELECT 2"));
        // Outside E'' a backslash is an ordinary character.
        Assert.Equal(["SELECT 'a\\'", "SELECT 2"], Texts("SELECT 'a\\'; SELECT 2"));
        Assert.Equal(["SELECT 1 /* a /* ; */ ; */", "SELECT 2"], Texts("SELECT 1 /* a /* ; */ ; */; SELECT 2"));
        Assert.Equal(["SELECT 1 -- ;\n, 2"], Texts("SELECT 1 -- ;\n, 2"));
    }

    [Fact]
    public void Dollar_quoted_bodies_are_one_statement_and_parameters_are_not_tags()
    {
        const string body = "DO $do$ BEGIN RAISE NOTICE 'a; $$ b'; END $do$";
        Assert.Equal([body, "SELECT 2"], Texts($"{body};\nSELECT 2;"));
        Assert.Equal(["CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql"], Texts("CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;"));
        Assert.Equal(["SELECT $1", "SELECT a$b$ FROM t"], Texts("SELECT $1; SELECT a$b$ FROM t"));
    }

    [Fact]
    public void Begin_atomic_bodies_keep_their_semicolons()
    {
        const string fn = "CREATE OR REPLACE FUNCTION f(x int) RETURNS int LANGUAGE sql\nBEGIN ATOMIC\n  SELECT CASE WHEN x > 0 THEN 1 ELSE 0 END;\n  SELECT 2;\nEND";
        var statements = PostgresStatements.Split($"{fn};\nSELECT 3;");

        Assert.Equal([fn, "SELECT 3"], statements.Select(s => s.Text));
        Assert.True(statements[0].Atomic);
        Assert.False(statements[1].Atomic);
        // BEGIN outside CREATE FUNCTION or PROCEDURE is a transaction, not a body.
        Assert.Equal(["BEGIN", "SELECT 1", "END"], Texts("BEGIN; SELECT 1; END;"));
    }

    [Fact]
    public void Comment_only_and_empty_statements_are_dropped()
    {
        Assert.Equal(["SELECT 1"], Texts(";;\n-- just a note\n;SELECT 1;\n/* trailing */"));
        Assert.Empty(Texts("  \n-- nothing\n"));
    }

    [Fact]
    public void Statements_keep_their_offset_and_first_keyword()
    {
        var statements = PostgresStatements.Split("SELECT 1;\n/* why */ COMMIT;\nRollback");

        Assert.Equal([0, 10, 28], statements.Select(s => s.Start));
        Assert.Equal(["select", "commit", "rollback"], statements.Select(s => s.FirstWord));
        Assert.Equal([false, true, true], statements.Select(PostgresStatements.EndsTransaction));
    }

    [Fact]
    public void A_position_maps_to_the_script_line_and_column()
    {
        const string script = "SELECT 1;\n\nSELECT o.idd\nFROM sales.\"order\" o";
        var second = PostgresStatements.Split(script)[1];

        Assert.Equal((3, 8), PostgresStatements.Locate(script, second, 8)); // "o.idd" starts at character 8
        Assert.Equal((4, 1), PostgresStatements.Locate(script, second, 14));
    }

    [Fact]
    public void Positions_count_characters_not_utf16_units()
    {
        // The server counts the emoji as one character; the editor's column counts its two UTF-16 units.
        const string script = "SELECT '\U0001F600', nope";
        var statement = PostgresStatements.Split(script)[0];

        Assert.Equal((1, 14), PostgresStatements.Locate(script, statement, 13));
    }
}

public class PostgresQueryErrorTests
{
    private const string Script = "SELECT 1;\n\nSELECT o.idd\nFROM sales.\"order\" o";
    private static readonly PostgresStatements.Statement Second = PostgresStatements.Split(Script)[1];

    [Fact]
    public void A_positioned_error_gets_its_line_and_column()
    {
        var e = PostgresBackend.ToQueryError(Script, Second, "42703", "column o.idd does not exist", 8, null, null, "Perhaps you meant to reference the column \"o.id\".");

        Assert.Equal(new QueryError(0, 3, "Line 3: column o.idd does not exist\nHINT: Perhaps you meant to reference the column \"o.id\".", "42703", 8), e);
    }

    [Fact]
    public void An_error_without_a_position_gets_its_statement_line()
    {
        var e = PostgresBackend.ToQueryError(Script, Second, "22012", "division by zero", 0, null, "x", null);

        Assert.Equal(new QueryError(0, 3, "Line 3: division by zero\nDETAIL: x", "22012"), e);
    }

    [Fact]
    public void An_error_inside_a_function_names_it_and_has_no_line()
    {
        var e = PostgresBackend.ToQueryError(Script, Second, "P0001", "boom", 0, "PL/pgSQL function sales.f(integer) line 3 at RAISE\nSQL statement \"...\"", null, null);

        Assert.Equal(new QueryError(0, null, "PL/pgSQL function sales.f(integer) line 3 at RAISE: boom", "P0001"), e);
    }
}

public class PostgresValueTests
{
    [Theory]
    [InlineData(16u, "t", true)]
    [InlineData(16u, "f", false)]
    [InlineData(23u, "-42", -42L)]
    [InlineData(20u, "9007199254740993", 9007199254740993L)]
    [InlineData(701u, "2.5", 2.5)]
    [InlineData(701u, "NaN", "NaN")]
    [InlineData(700u, "Infinity", "Infinity")]
    [InlineData(1700u, "123456789012345678901234567890.12", "123456789012345678901234567890.12")]
    [InlineData(1186u, "1 mon 2 days", "1 mon 2 days")]
    [InlineData(1007u, "{1,2}", "{1,2}")]
    [InlineData(3802u, "{\"a\": 1}", "{\"a\": 1}")]
    [InlineData(17u, "\\xdeadbeef", "0xDEADBEEF")]
    public void Values_render_as_numbers_booleans_or_the_server_text(uint type, string text, object expected)
    {
        Assert.Equal(expected, PostgresValues.FromText(type, text));
    }

    [Fact]
    public void Long_bytea_is_cut_like_sql_binary_and_null_stays_null()
    {
        var text = "\\x" + new string('a', 80);

        Assert.Equal($"0x{new string('A', 64)}... (40 bytes)", PostgresValues.FromText(17, text));
        Assert.Null(PostgresValues.FromText(23, null));
    }
}

public class PostgresCatalogTests
{
    [Fact]
    public void Assembles_relations_functions_and_procedures()
    {
        var catalog = PostgresCatalog.Assemble("s", ["public", "sales"],
            [
                new("p2", "close_order", "sales", ObjectKinds.Proc),
                new("c1", "order", "sales", ObjectKinds.Table),
                new("p1", "totals", "public", ObjectKinds.Fn),
                new("p3", "now_ish", "public", ObjectKinds.Fn),
            ],
            [new("c1", "order_id", "bigint", false), new("c1", "total", "numeric(18,2)", true)],
            [
                new("p1", "p_from", "date", "i"),
                new("p1", "", "integer", "i"),
                new("p1", "day", "date", "t"),
                new("p1", "total", "numeric", "t"),
                new("p2", "p_order_id", "bigint", "i"),
                new("p2", "p_closed", "boolean", "o"),
            ],
            ["integer", "text"]);

        Assert.Equal(["now_ish", "totals", "close_order", "order"], catalog.Objects.Select(o => o.Name));
        var order = catalog.Objects.Single(o => o.Name == "order");
        Assert.Equal([new ColumnRef("order_id", "bigint", false), new ColumnRef("total", "numeric(18,2)", true)], order.Columns!);
        Assert.Null(order.Params);

        var totals = catalog.Objects.Single(o => o.Name == "totals");
        Assert.Equal([new ParamRef("p_from", "date", false), new ParamRef("$2", "integer", false)], totals.Params!);
        Assert.Equal(["day", "total"], totals.Columns!.Select(c => c.Name));

        var nowIsh = catalog.Objects.Single(o => o.Name == "now_ish");
        Assert.Empty(nowIsh.Params!);
        Assert.Null(nowIsh.Columns);

        var close = catalog.Objects.Single(o => o.Name == "close_order");
        Assert.Equal([new ParamRef("p_order_id", "bigint", false), new ParamRef("p_closed", "boolean", true)], close.Params!);
        Assert.Equal(["public", "sales"], catalog.Schemas);
    }
}

public class PostgresTemplateTests
{
    private static readonly PostgresBackend Backend = new(new Credentials(_ => { }));

    private static readonly NodePath Db = NodePath.Parse("env:e/conn:p/db:orders");

    [Theory]
    [InlineData("tables", new[] { "sales", "order" }, "SELECT *\nFROM sales.\"order\"\nLIMIT 1000;")]
    [InlineData("views", new[] { "sales", "open_orders" }, "SELECT *\nFROM sales.open_orders\nLIMIT 1000;")]
    [InlineData("matviews", new[] { "sales", "daily_totals" }, "SELECT *\nFROM sales.daily_totals\nLIMIT 1000;")]
    [InlineData("functions", new[] { "public", "order_count", "integer" }, null)]
    [InlineData("sequences", new[] { "sales", "invoice_no" }, null)]
    public void Select_top_is_offered_on_tables_views_and_materialized_views(string folder, string[] parts, string? expected)
    {
        var node = NodePath.Parse(Db.Child("f", folder).Child("o", parts).Id);

        Assert.Equal(expected, Backend.TemplateFor(node, "selectTop"));
        Assert.Null(Backend.TemplateFor(Db, "selectTop"));
    }

    [Fact]
    public void New_query_opens_empty_in_the_pgsql_language()
    {
        Assert.Equal("", Backend.TemplateFor(NodePath.Parse("env:e/conn:p/db:orders"), "newQuery"));
        Assert.Equal("pgsql", Backend.EditorLanguage);
    }
}

/// <summary>What a query streamed, for tests that call a backend directly (no store, so they also run on Linux CI).</summary>
public sealed class RecordingSink : IQuerySink
{
    public List<List<object?[]>> Sets { get; } = [];
    public List<ResultColumn[]?> Columns { get; } = [];
    public List<int> Batches { get; } = [];
    public List<(string Kind, string Text)> Messages { get; } = [];
    public List<QueryError> Errors { get; } = [];
    public string? Error { get; private set; }
    public bool IsRolledBack { get; private set; }
    public bool IsCommitted { get; private set; }

    public int BatchSize => 500;
    public int SetCount => Sets.Count;

    public int BeginSet()
    {
        Sets.Add([]);
        Columns.Add(null);
        return Sets.Count - 1;
    }

    public int RowCount(int set) => Sets[set].Count;

    public void Rows(int set, ResultColumn[]? columns, IReadOnlyList<object?[]> rows)
    {
        if (columns is not null) Columns[set] = columns;
        Sets[set].AddRange(rows);
        Batches.Add(rows.Count);
    }

    public void Message(string kind, string text) => Messages.Add((kind, text));

    public void Fail(string error, IReadOnlyList<QueryError>? errors = null)
    {
        Error = error;
        if (errors is not null) Errors.AddRange(errors);
    }

    public void RolledBack() => IsRolledBack = true;
    public void Committed() => IsCommitted = true;
    public void AddCharge(double charge) { }
}

public sealed class PostgresQueryIntegrationTests
{
    private static readonly PostgresBackend Backend = new(new Credentials(_ => throw new InvalidOperationException("Entra not expected in tests")));

    private static readonly ConnectionConfig DevPg = new("pg1", "dev pg", ConnectionKinds.Postgres, "127.0.0.1:15432", AuthKinds.Password,
        User: "postgres", TrustServerCertificate: true);

    private static QueryTarget Target(bool readOnly = false, string database = "orders") =>
        new(new EnvironmentConfig("dev", "Dev", "#000", readOnly, []), DevPg, database, null);

    private static async Task<RecordingSink> Run(string text, bool readOnly = false, CancellationToken ct = default)
    {
        var sink = new RecordingSink();
        await Backend.ExecuteAsync(Target(readOnly), PgFactAttribute.Password, text, sink, ct);
        return sink;
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Streams_each_statement_as_a_set_with_typed_values()
    {
        var sink = await Run("""
            SELECT g AS n FROM generate_series(1, 1200) AS g;
            SELECT NULL::int AS empty, 1.50::numeric(10,2) AS d, true AS b, interval '1 mon 2 days' AS i, ARRAY[1,2] AS a,
                   'open'::sales.order_status AS s, '{"a":1}'::jsonb AS j, int4range(1, 5) AS r, decode('ff00', 'hex') AS bin,
                   date '2026-10-30' AS day
            """);

        Assert.Null(sink.Error);
        Assert.Equal([1200, 1], sink.Sets.Select(s => s.Count));
        Assert.Equal([500, 500, 200, 1], sink.Batches);
        Assert.Equal(("n", "integer"), (sink.Columns[0]![0].Name, sink.Columns[0]![0].Type));
        Assert.Equal(1200L, sink.Sets[0][^1][0]);
        Assert.Equal(new object?[] { null, "1.50", true, "1 mon 2 days", "{1,2}", "open", "{\"a\": 1}", "[1,5)", "0xFF00", "2026-10-30" }, sink.Sets[1][0]);
        Assert.Equal("sales.order_status", sink.Columns[1]![5].Type);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Notices_and_rows_affected_are_messages()
    {
        var sink = await Run("""
            CREATE TEMP TABLE t (x int);
            INSERT INTO t VALUES (1), (2), (3);
            UPDATE t SET x = x WHERE x = 1;
            DO $$ BEGIN RAISE NOTICE 'hello'; RAISE WARNING 'careful'; END $$;
            """);

        Assert.Null(sink.Error);
        Assert.Equal([("info", "(3 rows affected)"), ("info", "(1 row affected)"), ("info", "hello"), ("info", "WARNING: careful")], sink.Messages);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task An_error_stops_the_run_and_carries_its_line_column_and_state()
    {
        var sink = await Run("SELECT 1 AS ok;\n\nSELECT o.idd\nFROM sales.\"order\" o;\nSELECT 3");

        var error = Assert.Single(sink.Errors);
        Assert.Equal(("42703", 3, 8), (error.State, error.Line, error.Column));
        Assert.StartsWith("Line 3: column o.idd does not exist", error.Text);
        Assert.Single(sink.Sets); // the first statement's result is kept; the third never ran
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task An_error_inside_a_function_has_no_script_line()
    {
        var sink = await Run("""
            CREATE FUNCTION pg_temp.boom() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$;

            SELECT pg_temp.boom();
            """);

        var error = Assert.Single(sink.Errors);
        Assert.Null(error.Line);
        Assert.Equal("P0001", error.State);
        Assert.StartsWith("PL/pgSQL function pg_temp", error.Text);
        Assert.EndsWith(": boom", error.Text);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task A_begin_atomic_function_is_created_whole()
    {
        var sink = await Run("""
            CREATE FUNCTION pg_temp.two() RETURNS int LANGUAGE sql
            BEGIN ATOMIC
              SELECT 1;
              SELECT CASE WHEN true THEN 2 END;
            END;
            SELECT pg_temp.two() AS two;
            """);

        Assert.Null(sink.Error);
        Assert.Equal(2L, Assert.Single(Assert.Single(sink.Sets))[0]);
    }

    /// <summary>Runs <paramref name="script"/> ({T} is a scratch table) read-only; returns what it reported and the rows left in {T}.</summary>
    private static async Task<(RecordingSink Sink, long[] Rows)> RunReadOnly(string script)
    {
        var table = $"public.zz_ro_guard_{Guid.NewGuid():N}";
        Assert.Null((await Run($"CREATE TABLE {table} (x int)")).Error);
        try
        {
            var sink = await Run(script.Replace("{T}", table), readOnly: true);
            var check = await Run($"SELECT x FROM {table} ORDER BY x");
            return (sink, check.Sets.Single().Select(r => (long)r[0]!).ToArray());
        }
        finally
        {
            await Run($"DROP TABLE {table}");
        }
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Read_only_refuses_writes_on_the_server_and_rolls_back()
    {
        var (sink, rows) = await RunReadOnly("SELECT 1; INSERT INTO {T} VALUES (1)");

        Assert.Equal("25006", Assert.Single(sink.Errors).State);
        Assert.True(sink.IsRolledBack);
        Assert.False(sink.IsCommitted);
        Assert.Contains(("info", "Dev is read-only: nothing was committed."), sink.Messages);
        Assert.Empty(rows);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Read_only_cannot_be_switched_to_read_write()
    {
        var (sink, rows) = await RunReadOnly("SET TRANSACTION READ WRITE; INSERT INTO {T} VALUES (1)");

        Assert.Equal("25001", Assert.Single(sink.Errors).State);
        Assert.Empty(rows);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Read_only_reads_report_rolled_back()
    {
        var sink = await Run("SELECT count(*) FROM sales.\"order\"", readOnly: true);

        Assert.Null(sink.Error);
        Assert.True(sink.IsRolledBack);
        Assert.Equal(200L, sink.Sets.Single().Single()[0]);
        Assert.Contains(("info", "Dev is read-only: this query's database changes were rolled back."), sink.Messages);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Read_only_commit_escape_is_reported_and_stops_the_run()
    {
        // The SET makes the next transaction writable; the run stops at the COMMIT, before the INSERT can use it.
        var (sink, rows) = await RunReadOnly("SET default_transaction_read_only = off; COMMIT; INSERT INTO {T} VALUES (1)");

        Assert.Null(sink.Error);
        Assert.True(sink.IsCommitted);
        Assert.False(sink.IsRolledBack);
        Assert.Contains(sink.Messages, m => m.Kind == "error" && m.Text.Contains("ended the read-only guard"));
        Assert.Empty(rows);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Read_only_rollback_and_chain_is_caught_too()
    {
        var (sink, rows) = await RunReadOnly("ROLLBACK AND CHAIN; INSERT INTO {T} VALUES (1)");

        Assert.True(sink.IsCommitted);
        Assert.Empty(rows);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Cancel_stops_a_running_query()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1));

        var run = Run("SELECT pg_sleep(30)", ct: cts.Token);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => run.WaitAsync(TimeSpan.FromSeconds(10)));
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Catalog_lists_the_tree_objects_with_columns_and_arguments()
    {
        var catalog = await Backend.CatalogAsync(Target(), PgFactAttribute.Password, new EditorSettings(), default);

        Assert.Contains("sales", catalog.Schemas);
        Assert.DoesNotContain("pg_catalog", catalog.Schemas);
        var order = catalog.Objects.Single(o => o is { Schema: "sales", Name: "order" });
        Assert.Equal(ObjectKinds.Table, order.Kind);
        Assert.Equal(["order_id", "customer_id", "status", "placed_utc", "total"], order.Columns!.Select(c => c.Name));
        Assert.Equal("numeric(18,2)", order.Columns![4].Type);
        Assert.Contains(catalog.Objects, o => o is { Name: "daily_totals", Kind: ObjectKinds.View });
        Assert.DoesNotContain(catalog.Objects, o => o.Name == "change_log_2026"); // partitions are not listed
        var counts = catalog.Objects.Where(o => o.Name == "order_count").ToList();
        Assert.Equal([1, 2], counts.Select(o => o.Params!.Length).Order());
        Assert.Equal(new ParamRef("p_status", "sales.order_status", false), counts.Single(o => o.Params!.Length == 2).Params![1]);
        Assert.Equal(ObjectKinds.Proc, catalog.Objects.Single(o => o.Name == "close_order").Kind);
        Assert.Contains("integer", catalog.Types);
        Assert.Equal(await Backend.CatalogStampAsync(Target(), PgFactAttribute.Password, default), catalog.Stamp);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Catalog_stamp_changes_after_ddl()
    {
        var before = await Backend.CatalogStampAsync(Target(), PgFactAttribute.Password, default);
        var table = $"public.zz_stamp_{Guid.NewGuid():N}";
        await Run($"CREATE TABLE {table} (x int)");
        try
        {
            var created = await Backend.CatalogStampAsync(Target(), PgFactAttribute.Password, default);
            await Run($"ALTER TABLE {table} ADD COLUMN y int");
            var altered = await Backend.CatalogStampAsync(Target(), PgFactAttribute.Password, default);

            Assert.NotEqual(before, created);
            Assert.NotEqual(created, altered);
            Assert.Equal(altered, await Backend.CatalogStampAsync(Target(), PgFactAttribute.Password, default));
        }
        finally
        {
            await Run($"DROP TABLE {table}");
        }
    }
}
