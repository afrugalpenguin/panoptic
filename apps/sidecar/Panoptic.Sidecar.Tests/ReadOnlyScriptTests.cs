using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// What a read-only SQL Server run refuses before it starts: statements that end or escape the rollback guard.
/// Comments, strings and quoted identifiers never count.
/// </summary>
public class ReadOnlyScriptTests
{
    [Theory]
    [InlineData("COMMIT", "COMMIT", 1)]
    [InlineData("INSERT t VALUES (1);\ncommit transaction", "COMMIT", 2)]
    [InlineData("SELECT 1\nGO\n\nROLLBACK TRAN", "ROLLBACK", 4)]
    [InlineData("SET IMPLICIT_TRANSACTIONS OFF", "SET IMPLICIT_TRANSACTIONS", 1)]
    [InlineData("EXEC('DELETE FROM t')", "EXEC(...)", 1)]
    [InlineData("DECLARE @s nvarchar(100) = N'x';\nEXECUTE\n  (@s)", "EXEC(...)", 2)]
    [InlineData("EXEC sp_executesql N'DELETE FROM t'", "sp_executesql", 1)]
    [InlineData("EXEC sys.sp_executesql @stmt = @s", "sp_executesql", 1)]
    public void Refuses_statements_that_end_or_escape_the_guard(string script, string statement, int line)
    {
        var found = ReadOnlyScript.FindForbidden(script);

        Assert.NotNull(found);
        Assert.Equal(statement, found.Statement);
        Assert.Equal(line, found.Line);
    }

    [Theory]
    [InlineData("SELECT * FROM t")]
    [InlineData("SET TRANSACTION ISOLATION LEVEL READ COMMITTED; SELECT 1")]
    [InlineData("SELECT 'COMMIT' AS c, N'it''s a ROLLBACK' AS d")]
    [InlineData("SELECT 1 -- COMMIT\n/* ROLLBACK */ SELECT 2")]
    [InlineData("/* outer /* COMMIT */ still a comment */ SELECT 1")]
    [InlineData("SELECT [commit], \"rollback\" FROM t")]
    [InlineData("EXEC dbo.GetOrders @CustomerId = 1")]
    [InlineData("EXEC sp_help 'dbo.Customer'")]
    [InlineData("DECLARE @rc int; EXEC @rc = dbo.GetOrders")]
    [InlineData("BEGIN TRAN; UPDATE t SET x = 1")]
    [InlineData("SELECT committed_at, rollback_count FROM t")]
    public void Allows_scripts_that_stay_inside_the_guard(string script)
    {
        Assert.Null(ReadOnlyScript.FindForbidden(script));
    }
}
