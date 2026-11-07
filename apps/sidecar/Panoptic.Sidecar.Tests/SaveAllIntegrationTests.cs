using Panoptic.Sidecar.Backends;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Save all rows (#287) against the real drivers: every row of a result larger than the grid's row limit reaches the
/// file, as the grid would show each value. Runs straight on the backends, so on Linux CI too.
/// </summary>
public sealed class SaveAllIntegrationTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");

    public SaveAllIntegrationTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private static readonly EnvironmentConfig Dev = new("dev", "Dev", "#000", false, []);

    private async Task<string[]> Save(IQueryBackend backend, QueryTarget target, string? secret, string text)
    {
        var path = Path.Combine(_dir, "all.csv");
        FileSink sink;
        using (sink = new FileSink(path, "csv")) await backend.ExecuteAsync(target, secret, text, sink, CancellationToken.None);
        Assert.Null(sink.Error);
        return File.ReadAllLines(path);
    }

    [SqlFact, Trait("Category", "SqlIntegration")]
    public async Task Sql_server_writes_every_row()
    {
        var connection = new ConnectionConfig("sql1", "dev", ConnectionKinds.Sql, "127.0.0.1,14333", AuthKinds.Sql, User: "sa", TrustServerCertificate: true);
        var text = "SELECT TOP (1500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n, CAST(1.5 AS decimal(10,2)) AS d FROM sys.all_objects a CROSS JOIN sys.all_objects b";

        var lines = await Save(new SqlBackend(new Credentials(_ => { })), new QueryTarget(Dev, connection, "master", null), SqlFactAttribute.Password, text);

        Assert.Equal(1501, lines.Length);
        Assert.Equal(["n,d", "1,1.50"], lines[..2]);
        Assert.Equal("1500,1.50", lines[^1]);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Postgres_writes_every_row()
    {
        var connection = new ConnectionConfig("pg1", "dev pg", ConnectionKinds.Postgres, "127.0.0.1:15432", AuthKinds.Password, User: "postgres", TrustServerCertificate: true);

        var lines = await Save(new PostgresBackend(new Credentials(_ => { })), new QueryTarget(Dev, connection, "orders", null), PgFactAttribute.Password,
            "SELECT g AS n, 'x' || g AS label FROM generate_series(1, 1500) AS g");

        Assert.Equal(1501, lines.Length);
        Assert.Equal(["n,label", "1,x1"], lines[..2]);
        Assert.Equal("1500,x1500", lines[^1]);
    }
}
