using System.Text.Json;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Save all rows (#287): past the row limit, a single read-only query runs again and every row goes straight to a
/// file. Only a lone SELECT may run twice; anything that could change data is refused.
/// </summary>
public sealed class SingleReadQueryTests
{
    [Theory]
    [InlineData("sql", "select * from dbo.Orders")]
    [InlineData("sql", "  -- the big one\r\nSELECT o.* FROM dbo.Orders o WHERE o.Note = 'insert; update'  ;  ")]
    [InlineData("sql", "WITH recent AS (SELECT * FROM dbo.Orders) SELECT * FROM recent")]
    [InlineData("sql", "select [into], [update] from dbo.Odd")]
    [InlineData("pgsql", "select * from sales.orders;")]
    [InlineData("cosmos", "SELECT * FROM c WHERE c.status = 'open'")]
    public void A_lone_select_may_run_again(string language, string text)
    {
        Assert.Null(SingleReadQuery.Refusal(language, text));
    }

    [Theory]
    [InlineData("sql", "", "nothing to run")]
    [InlineData("sql", "insert into t values (1)", "only a single SELECT")]
    [InlineData("sql", "update t set a = 1", "only a single SELECT")]
    [InlineData("sql", "exec dbo.Report", "only a single SELECT")]
    [InlineData("sql", "select * into #copy from dbo.Orders", "INTO")]
    [InlineData("sql", "select 1; select 2", "one statement")]
    [InlineData("sql", "select 1\nGO\nselect 2", "one statement")]
    [InlineData("pgsql", "with gone as (delete from t returning *) select * from gone", "DELETE")]
    [InlineData("pgsql", "select * from t for update", "UPDATE")]
    [InlineData("pgsql", "select pg_sleep(1); drop table t", "one statement")]
    public void Anything_that_could_change_data_or_is_more_than_one_statement_is_refused(string language, string text, string expected)
    {
        Assert.Contains(expected, SingleReadQuery.Refusal(language, text));
    }
}

public sealed class FileSinkTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");

    public FileSinkTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private static readonly ResultColumn[] Columns = [new("Id", "int"), new("Name", "nvarchar"), new("Amount", "decimal"), new("Name", "nvarchar"), new("", "bit")];

    private string Write(string format)
    {
        var path = Path.Combine(_dir, $"out.{format}");
        using (var sink = new FileSink(path, format))
        {
            var set = sink.BeginSet();
            sink.Rows(set, Columns, [[1, "Alice", 12.50m, "=SUM(A1)", true], [2, "Bob, \"B\"", -3m, null, false]]);
            sink.Rows(set, null, [[3, "-x", 0m, "+44 1234", null]]);
            Assert.Equal(3, sink.RowCount(set));
        }
        return File.ReadAllText(path);
    }

    [Fact]
    public void Csv_matches_the_grids_export_with_formula_text_disarmed()
    {
        Assert.Equal(
            "Id,Name,Amount,Name,\r\n" +
            "1,Alice,12.50,'=SUM(A1),true\r\n" +
            "2,\"Bob, \"\"B\"\"\",-3,,false\r\n" +
            "3,'-x,0,'+44 1234,\r\n",
            Write("csv"));
    }

    [Fact]
    public void Json_is_an_array_of_objects_with_duplicate_and_empty_names_made_unique()
    {
        var rows = JsonDocument.Parse(Write("json")).RootElement;

        Assert.Equal(3, rows.GetArrayLength());
        var first = rows[0];
        Assert.Equal(1, first.GetProperty("Id").GetInt32());
        Assert.Equal("12.50", first.GetProperty("Amount").GetString());
        Assert.Equal("=SUM(A1)", first.GetProperty("Name_2").GetString());
        Assert.True(first.GetProperty("column5").GetBoolean());
        Assert.Equal(JsonValueKind.Null, rows[2].GetProperty("column5").ValueKind);
    }

    [Fact]
    public void Only_the_first_result_set_is_written_and_there_is_no_row_limit()
    {
        var path = Path.Combine(_dir, "one.csv");
        using (var sink = new FileSink(path, "csv"))
        {
            Assert.Equal(int.MaxValue, sink.MaxRows);
            sink.Rows(sink.BeginSet(), [new ResultColumn("n", "int")], [[1]]);
            sink.Rows(sink.BeginSet(), [new ResultColumn("other", "int")], [[2]]);
        }
        Assert.Equal("n\r\n1\r\n", File.ReadAllText(path));
    }
}
