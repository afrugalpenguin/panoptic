using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Panoptic.Sidecar.Backends;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Tests;

public class BatchSplitterTests
{
    [Fact]
    public void Splits_on_go_lines_case_insensitively()
    {
        var batches = BatchSplitter.Split("SELECT 1\nGO\nselect 2\n  go  \nSELECT 3");
        Assert.Equal(["SELECT 1", "select 2", "SELECT 3"], batches);
    }

    [Fact]
    public void Ignores_go_inside_words_strings_and_comments_and_drops_empty_batches()
    {
        var batches = BatchSplitter.Split("SELECT 'GO' AS x, gopher = 1\n-- GO\n/*\nGO\n*/\nGO\n\nGO\nSELECT 2");
        Assert.Equal(2, batches.Count);
        Assert.StartsWith("SELECT 'GO'", batches[0]);
        Assert.Equal("SELECT 2", batches[1]);
    }

    [Fact]
    public void Single_batch_without_go()
    {
        Assert.Equal(["SELECT 1;\nSELECT 2;"], BatchSplitter.Split("SELECT 1;\nSELECT 2;"));
    }
}

public class SqlValueTests
{
    private static string Json(object? value)
    {
        using var buffer = new MemoryStream();
        using (var w = new Utf8JsonWriter(buffer, JsonRpcDispatcher.WriterOptions)) SqlValues.Write(w, value);
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    [Theory]
    [InlineData(null, "null")]
    [InlineData(42, "42")]
    [InlineData(true, "true")]
    [InlineData("it's", "\"it's\"")]
    public void Writes_simple_values(object? value, string expected) => Assert.Equal(expected, Json(value));

    [Fact]
    public void Keeps_precision_for_big_integers_and_decimals()
    {
        Assert.Equal("9007199254740991", Json(9007199254740991L));
        Assert.Equal("\"9007199254740993\"", Json(9007199254740993L));
        Assert.Equal("\"12345678901234567890.123456\"", Json(12345678901234567890.123456m));
    }

    [Fact]
    public void Formats_dates_guids_and_binary()
    {
        Assert.Equal("\"2026-10-29 14:05:06.123\"", Json(new DateTime(2026, 10, 29, 14, 5, 6, 123)));
        Assert.Equal("\"2026-10-29 14:05:06.000 +01:00\"", Json(new DateTimeOffset(2026, 10, 29, 14, 5, 6, TimeSpan.FromHours(1))));
        Assert.Equal("\"6f9619ff-8b86-d011-b42d-00c04fc964ff\"", Json(Guid.Parse("6F9619FF-8B86-D011-B42D-00C04FC964FF")));
        Assert.Equal("\"0x0A0B\"", Json(new byte[] { 10, 11 }));
    }

    [Fact]
    public void Truncates_long_binary()
    {
        var json = Json(new byte[100]);
        Assert.StartsWith("\"0x0000", json);
        Assert.EndsWith("... (100 bytes)\"", json);
    }
}

public class ReadOnlyGuardTests
{
    [Fact]
    public async Task Stops_after_the_batch_that_drops_trancount_to_zero()
    {
        var ran = new List<string>();
        var counts = new Queue<int>([1, 0, 1]);

        var held = await QueryService.RunBatches(["a", "b", "c"], b => { ran.Add(b); return Task.CompletedTask; }, () => Task.FromResult(counts.Dequeue()));

        Assert.False(held);
        Assert.Equal(["a", "b"], ran);
    }

    [Fact]
    public async Task Runs_every_batch_while_the_transaction_stays_open()
    {
        var ran = new List<string>();

        var held = await QueryService.RunBatches(["a", "b"], b => { ran.Add(b); return Task.CompletedTask; }, () => Task.FromResult(2));

        Assert.True(held);
        Assert.Equal(["a", "b"], ran);
    }

    [Fact]
    public async Task Does_not_check_without_a_guard()
    {
        var ran = new List<string>();

        var held = await QueryService.RunBatches(["a", "b"], b => { ran.Add(b); return Task.CompletedTask; }, null);

        Assert.True(held);
        Assert.Equal(["a", "b"], ran);
    }

    [Fact]
    public void Rollback_message_does_not_claim_changes_when_the_run_failed()
    {
        Assert.Equal("Prod is read-only: this query's database changes were rolled back.", SqlBackend.RolledBackMessage("Prod", failed: false));
        Assert.Equal("Prod is read-only: nothing was committed.", SqlBackend.RolledBackMessage("Prod", failed: true));
    }
}

public class QueryTemplateTests
{
    [Fact]
    public void Select_top_quotes_schema_and_name_from_the_node_path()
    {
        var path = NodePath.Root.Child("env", "e").Child("conn", "c").Child("db", "Orders").Child("f", "tables").Child("o", "sales", "Odd]Name");
        Assert.Equal("SELECT TOP (1000) *\nFROM [sales].[Odd]]Name];", QueryTemplates.SelectTop(ConnectionKinds.Sql, path));
    }

    [Fact]
    public void Select_top_for_a_cosmos_container()
    {
        var path = NodePath.Parse("env:e/conn:c/db:shop/c:orders");
        Assert.Equal("SELECT TOP 1000 * FROM c", QueryTemplates.SelectTop(ConnectionKinds.Cosmos, path));
    }

    [Fact]
    public void Select_top_is_not_offered_above_an_object()
    {
        Assert.Null(QueryTemplates.SelectTop(ConnectionKinds.Sql, NodePath.Parse("env:e/conn:c/db:Orders")));
    }
}

/// <summary>Runs queries against the Docker dev databases (scripts/dev-db.ps1). Opt-in, like BackendIntegrationTests.</summary>
public sealed class QueryIntegrationTests : IDisposable
{
    private const string CosmosEmulatorKey = "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}", "store.bin");
    private readonly ConcurrentQueue<(string Method, string Params)> _notes = new();

    public void Dispose()
    {
        var dir = Path.GetDirectoryName(_path)!;
        if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
    }

    private static string? SqlPassword => Environment.GetEnvironmentVariable("PANOPTIC_TEST_SQL_PASSWORD");

    private QueryService Service(bool readOnly = false)
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("dev", "Dev", "#000", readOnly, []));
        store.SaveConnection("dev", new ConnectionConfig("sql1", "dev", ConnectionKinds.Sql, "127.0.0.1,14333", AuthKinds.Sql, User: "sa", TrustServerCertificate: true), SqlPassword ?? "");
        store.SaveConnection("dev", new ConnectionConfig("cos1", "emu", ConnectionKinds.Cosmos, "https://localhost:8081", AuthKinds.Key, TrustServerCertificate: true), CosmosEmulatorKey);
        var credentials = new Credentials(_ => { });
        var sql = new SqlBackend(credentials);
        var cosmos = new CosmosBackend(credentials);
        var tree = new TreeService(store, new Dictionary<string, IBackend> { ["sql"] = sql, ["cosmos"] = cosmos });
        return new QueryService(store, tree, sql, cosmos, (method, write) =>
        {
            using var buffer = new MemoryStream();
            using (var w = new Utf8JsonWriter(buffer)) write(w);
            _notes.Enqueue((method, Encoding.UTF8.GetString(buffer.ToArray())));
        });
    }

    private List<JsonElement> Notes(string method) =>
        _notes.Where(n => n.Method == method).Select(n => JsonDocument.Parse(n.Params).RootElement).ToList();

    [SqlFact(NeedsWindows = true), Trait("Category", "SqlIntegration")]
    public async Task Sql_streams_result_sets_in_batches_with_messages()
    {
        var summary = await Service().ExecuteAsync(new QueryRequest("q1", "env:dev/conn:sql1/db:Orders",
            "PRINT 'hello'\nSELECT TOP (1200) o.object_id FROM sys.all_objects o\nGO\nSELECT CAST(NULL AS int) AS n, CAST(1.5 AS decimal(10,2)) AS d"), default);

        Assert.Null(summary.Error);
        Assert.Equal([1200, 1], summary.ResultSets.Select(r => r.RowCount));
        var batches = Notes("query.rows").Where(n => n.GetProperty("index").GetInt32() == 0).ToList();
        Assert.Equal(3, batches.Count); // 500 + 500 + 200
        Assert.Equal("object_id", batches[0].GetProperty("columns")[0].GetProperty("name").GetString());
        var last = Notes("query.rows").Last().GetProperty("rows")[0];
        Assert.Equal(JsonValueKind.Null, last[0].ValueKind);
        Assert.Equal("1.50", last[1].GetString());
        Assert.Contains(Notes("query.message"), m => m.GetProperty("text").GetString() == "hello");
    }

    [SqlFact(NeedsWindows = true), Trait("Category", "SqlIntegration")]
    public async Task Sql_error_keeps_earlier_results_and_reports_the_error()
    {
        var summary = await Service().ExecuteAsync(new QueryRequest("q2", "env:dev/conn:sql1/db:Orders", "SELECT 1 AS ok\nGO\nSELECT * FROM dbo.DoesNotExist"), default);

        Assert.Single(summary.ResultSets);
        Assert.Contains("DoesNotExist", summary.Error);
    }

    [SqlFact(NeedsWindows = true), Trait("Category", "SqlIntegration")]
    public async Task Sql_reports_rows_affected()
    {
        await Service().ExecuteAsync(new QueryRequest("q3", "env:dev/conn:sql1/db:Orders",
            "DECLARE @t TABLE (x int); INSERT @t VALUES (1), (2), (3);"), default);

        Assert.Contains(Notes("query.message"), m => m.GetProperty("text").GetString() == "(3 rows affected)");
    }

    [SqlFact(NeedsWindows = true), Trait("Category", "SqlIntegration")]
    public async Task Read_only_environment_rolls_back_changes()
    {
        var service = Service(readOnly: true);

        var summary = await service.ExecuteAsync(new QueryRequest("q4", "env:dev/conn:sql1/db:Orders",
            "UPDATE dbo.Customer SET Name = N'changed' WHERE CustomerId = 1"), default);
        Assert.True(summary.RolledBack);

        await service.ExecuteAsync(new QueryRequest("q5", "env:dev/conn:sql1/db:Orders", "SELECT Name FROM dbo.Customer WHERE CustomerId = 1"), default);
        Assert.NotEqual("changed", Notes("query.rows").Last().GetProperty("rows")[0][0].GetString());
    }

    [SqlFact(NeedsWindows = true), Trait("Category", "SqlIntegration")]
    public async Task Read_only_failed_query_says_nothing_was_committed()
    {
        var summary = await Service(readOnly: true).ExecuteAsync(new QueryRequest("q6", "env:dev/conn:sql1/db:Orders", "SELECT * FROM dbo.NoSuchTable"), default);

        Assert.NotNull(summary.Error);
        Assert.True(summary.RolledBack);
        var texts = Notes("query.message").Select(m => m.GetProperty("text").GetString()).ToList();
        Assert.Contains("Dev is read-only: nothing was committed.", texts);
        Assert.DoesNotContain(texts, t => t!.Contains("rolled back"));
    }

    /// <summary>Runs <paramref name="script"/> ({T} stands for a scratch table) in a read-only environment; returns the summary and the rows left in {T}.</summary>
    private async Task<(QuerySummary Summary, int[] Rows)> RunReadOnly(string script)
    {
        var table = $"dbo.zz_ro_guard_{Guid.NewGuid():N}";
        await Service().ExecuteAsync(new QueryRequest("setup", "env:dev/conn:sql1/db:Orders", $"CREATE TABLE {table} (x int)"), default);
        try
        {
            var summary = await Service(readOnly: true).ExecuteAsync(new QueryRequest("ro", "env:dev/conn:sql1/db:Orders", script.Replace("{T}", table)), default);
            await Service().ExecuteAsync(new QueryRequest("check", "env:dev/conn:sql1/db:Orders", $"SELECT x FROM {table} ORDER BY x"), default);
            var rows = Notes("query.rows").Last(n => n.GetProperty("queryId").GetString() == "check").GetProperty("rows").EnumerateArray().Select(r => r[0].GetInt32()).ToArray();
            return (summary, rows);
        }
        finally
        {
            await Service().ExecuteAsync(new QueryRequest("cleanup", "env:dev/conn:sql1/db:Orders", $"DROP TABLE {table}"), default);
        }
    }

    [SqlFact(NeedsWindows = true), Trait("Category", "SqlIntegration")]
    public async Task Read_only_balanced_begin_commit_stays_inside_the_guard()
    {
        // The script's BEGIN TRAN nests (@@TRANCOUNT 2) and its COMMIT only takes it back to 1.
        var (summary, rows) = await RunReadOnly("BEGIN TRAN; INSERT {T} VALUES (1); COMMIT; INSERT {T} VALUES (2)");

        Assert.Null(summary.Error);
        Assert.True(summary.RolledBack);
        Assert.False(summary.Committed);
        Assert.Empty(rows);
    }

    [SqlFact(NeedsWindows = true), Trait("Category", "SqlIntegration")]
    public async Task Read_only_commit_is_reported_and_stops_later_batches()
    {
        var (summary, rows) = await RunReadOnly("INSERT {T} VALUES (1); COMMIT\nGO\nINSERT {T} VALUES (2)");

        Assert.Null(summary.Error);
        Assert.True(summary.Committed);
        Assert.False(summary.RolledBack);
        Assert.Equal([1], rows); // committed by the script; the batch after it did not run
        Assert.Contains(Notes("query.message"), m => m.GetProperty("kind").GetString() == "error" && m.GetProperty("text").GetString()!.Contains("ended the read-only guard"));
    }

    [SqlFact(NeedsWindows = true), Trait("Category", "SqlIntegration")]
    public async Task Read_only_commit_then_begin_tran_is_still_caught()
    {
        // @@TRANCOUNT is back to 1 after this batch, but the open transaction is the script's.
        var (summary, rows) = await RunReadOnly("INSERT {T} VALUES (1); COMMIT; BEGIN TRAN; INSERT {T} VALUES (2)\nGO\nINSERT {T} VALUES (3)");

        Assert.Null(summary.Error);
        Assert.True(summary.Committed);
        Assert.False(summary.RolledBack);
        Assert.Equal([1], rows);
    }

    [SqlFact(NeedsWindows = true), Trait("Category", "SqlIntegration")]
    public async Task Cancel_stops_a_running_query()
    {
        var service = Service();

        var run = service.ExecuteAsync(new QueryRequest("q6", "env:dev/conn:sql1/db:Orders", "WAITFOR DELAY '00:00:30'; SELECT 1"), default);
        await Task.Delay(1000);
        Assert.True(service.Cancel("q6"));
        var summary = await run.WaitAsync(TimeSpan.FromSeconds(10));

        Assert.True(summary.Cancelled);
    }

    [CosmosFact, Trait("Category", "CosmosIntegration")]
    public async Task Cosmos_flattens_documents_into_columns_and_reports_charge()
    {
        var summary = await Service().ExecuteAsync(new QueryRequest("q7", "env:dev/conn:cos1/db:panoptic-dev/c:orders", "SELECT * FROM c"), default);

        Assert.Null(summary.Error);
        Assert.Equal(25, summary.ResultSets.Single().RowCount);
        Assert.True(summary.RequestCharge > 0);
        var columns = Notes("query.rows").Last().GetProperty("columns").EnumerateArray().Select(c => c.GetProperty("name").GetString()).ToList();
        Assert.Equal("id", columns[0]);
        Assert.Contains("lines", columns);
        Assert.DoesNotContain("_rid", columns);
    }

    [Fact]
    public async Task Cosmos_query_needs_a_container()
    {
        var summary = await Service().ExecuteAsync(new QueryRequest("q8", "env:dev/conn:cos1/db:panoptic-dev", "SELECT * FROM c"), default);

        Assert.Contains("container", summary.Error);
    }
}
