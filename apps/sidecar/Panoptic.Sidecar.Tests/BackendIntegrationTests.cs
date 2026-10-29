using System.Diagnostics;
using Panoptic.Sidecar.Backends;
using Xunit.Abstractions;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Walks real backends started by scripts/dev-db.ps1. Opt-in: set PANOPTIC_TEST_SQL_PASSWORD (the SA
/// password from docker/.env) and/or PANOPTIC_TEST_COSMOS=1. Without them these tests return early.
/// </summary>
public class BackendIntegrationTests(ITestOutputHelper output)
{
    private const string CosmosEmulatorKey = "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";

    private static readonly Credentials NoEntra = new(_ => throw new InvalidOperationException("Entra not expected in tests"));

    private static ConnectionConfig DevSql => new("sql1", "dev sql", ConnectionKinds.Sql, "127.0.0.1,14333", AuthKinds.Sql, User: "sa", TrustServerCertificate: true);

    [Fact]
    public async Task Sql_tree_walks_from_databases_to_columns()
    {
        var password = Environment.GetEnvironmentVariable("PANOPTIC_TEST_SQL_PASSWORD");
        if (string.IsNullOrEmpty(password)) return;

        var backend = new SqlBackend(NoEntra);
        var root = NodePath.Parse("env:dev/conn:sql1");

        var dbs = await Expand(backend, DevSql, password, root);
        Assert.Contains(dbs, n => n.Label == "Orders");
        Assert.True(dbs.TakeWhile(n => n.Meta!["system"] == "false").Count() >= 2, "user databases come first");

        var orders = NodePath.Parse(dbs.Single(n => n.Label == "Orders").Id);
        var tables = await Expand(backend, DevSql, password, orders.Child("f", "tables"));
        Assert.True(tables.Length > 120);
        var order = NodePath.Parse(tables.Single(n => n.Label == "sales.Order").Id);

        var columns = await Expand(backend, DevSql, password, order.Child("f", "columns"));
        Assert.Contains(columns, c => c.Label == "OrderId (PK, bigint, identity, not null)");
        Assert.Contains(columns, c => c.Label == "Total (decimal(18, 2), not null)");

        var keys = await Expand(backend, DevSql, password, order.Child("f", "keys"));
        Assert.Contains(keys, k => k.Label == "FK_Order_Customer (foreign key)");

        var indexes = await Expand(backend, DevSql, password, order.Child("f", "indexes"));
        Assert.Contains(indexes, i => i.Label == "IX_Order_Customer (nonclustered)");

        var procs = await Expand(backend, DevSql, password, orders.Child("f", "programmability").Child("f", "procs"));
        Assert.Contains(procs, p => p.Label == "sales.GetCustomerOrders");

        var synonyms = await Expand(backend, DevSql, password, orders.Child("f", "synonyms"));
        Assert.Equal("[sales].[Order]", Assert.Single(synonyms).Meta!["baseObject"]);
    }

    [Fact]
    public async Task Sql_catalog_has_objects_columns_params_and_a_stable_stamp()
    {
        var password = Environment.GetEnvironmentVariable("PANOPTIC_TEST_SQL_PASSWORD");
        if (string.IsNullOrEmpty(password)) return;

        await using var conn = await new SqlBackend(NoEntra).OpenAsync(DevSql, password, "Orders", CancellationToken.None);
        var sw = Stopwatch.StartNew();
        var catalog = await Catalog.SqlCatalog.BuildAsync(conn, CancellationToken.None);
        output.WriteLine($"catalog: {catalog.Objects.Length} objects, {catalog.Objects.Sum(o => o.Columns?.Length ?? 0)} columns in {sw.ElapsedMilliseconds} ms");

        Assert.Contains("sales", catalog.Schemas);
        Assert.Contains("int", catalog.Types);
        var order = catalog.Objects.Single(o => o.Schema == "sales" && o.Name == "Order");
        Assert.Contains(order.Columns!, c => c.Name == "Total" && c.Type == "decimal(18, 2)" && !c.Nullable);
        Assert.NotEmpty(catalog.Objects.Single(o => o.Name == "GetCustomerOrders").Params!);
        Assert.Contains(catalog.Objects, o => o.Kind == Catalog.ObjectKinds.Synonym);
        Assert.Equal(catalog.Stamp, await Catalog.SqlCatalog.StampAsync(conn, CancellationToken.None));
    }

    [Fact]
    public async Task Sql_lists_databases_the_login_cannot_reach_through_master()
    {
        var password = Environment.GetEnvironmentVariable("PANOPTIC_TEST_SQL_PASSWORD");
        if (string.IsNullOrEmpty(password)) return;

        // A login that is a user in Inventory only, like an Entra user who exists as a contained
        // user in one client database: SSMS still lists every database, and so must Panoptic.
        var backend = new SqlBackend(NoEntra);
        const string limitedPassword = "Limited!Pass123";
        await using (var admin = await backend.OpenAsync(DevSql, password, "master", default))
        await using (var cmd = admin.CreateCommand())
        {
            cmd.CommandText = $"""
                IF SUSER_ID('panoptic_limited') IS NULL CREATE LOGIN panoptic_limited WITH PASSWORD = '{limitedPassword}', CHECK_POLICY = OFF;
                EXEC('USE Inventory; IF USER_ID(''panoptic_limited'') IS NULL CREATE USER panoptic_limited FOR LOGIN panoptic_limited;');
                """;
            await cmd.ExecuteNonQueryAsync();
        }

        var limited = DevSql with { User = "panoptic_limited" };
        var dbs = await Expand(backend, limited, limitedPassword, NodePath.Parse("env:dev/conn:sql1"));

        Assert.Contains(dbs, d => d.Label == "Inventory");
        Assert.Contains(dbs, d => d.Label == "Orders");
    }

    [Fact]
    public async Task Sql_login_failure_is_an_operation_error()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("PANOPTIC_TEST_SQL_PASSWORD"))) return;

        var ex = await Assert.ThrowsAsync<RpcException>(() => new SqlBackend(NoEntra).TestAsync(DevSql, "wrong", default));
        Assert.Equal(RpcException.OperationFailed, ex.Code);
        Assert.Contains("Login failed", ex.Message);
    }

    [Fact]
    public async Task Synapse_kind_adds_external_tables_folder()
    {
        var password = Environment.GetEnvironmentVariable("PANOPTIC_TEST_SQL_PASSWORD");
        if (string.IsNullOrEmpty(password)) return;

        // No Synapse emulator exists; this checks the folder shape and the external-table filter
        // against plain SQL Server, where the External tables folder is simply empty.
        var synapse = DevSql with { Kind = ConnectionKinds.Synapse };
        var db = NodePath.Parse("env:dev/conn:sql1").Child("db", "Orders");
        var backend = new SqlBackend(NoEntra);

        var folders = await Expand(backend, synapse, password, db);
        Assert.Equal(["Tables", "External tables", "Views", "Programmability"], folders.Select(f => f.Label));
        Assert.Empty(await Expand(backend, synapse, password, db.Child("f", "external")));
        Assert.True((await Expand(backend, synapse, password, db.Child("f", "tables"))).Length > 120);
    }

    [Fact]
    public async Task Cosmos_tree_walks_from_databases_to_items()
    {
        if (Environment.GetEnvironmentVariable("PANOPTIC_TEST_COSMOS") != "1") return;

        var conn = new ConnectionConfig("cos1", "emulator", ConnectionKinds.Cosmos, "https://localhost:8081", AuthKinds.Key, TrustServerCertificate: true);
        var backend = new CosmosBackend(NoEntra);
        var root = NodePath.Parse("env:dev/conn:cos1");

        await backend.TestAsync(conn, CosmosEmulatorKey, default);

        var dbs = await Expand(backend, conn, CosmosEmulatorKey, root);
        var dev = dbs.Single(n => n.Label == "panoptic-dev");

        var containers = await Expand(backend, conn, CosmosEmulatorKey, NodePath.Parse(dev.Id));
        var orders = containers.Single(n => n.Label == "orders");
        Assert.Equal("/tenantId", orders.Meta!["partitionKey"]);

        var children = await Expand(backend, conn, CosmosEmulatorKey, NodePath.Parse(orders.Id));
        Assert.Contains(children, c => c.Label == "Partition key: /tenantId");
        Assert.Contains(children, c => c.Kind == "indexingPolicy" && c.Meta!["json"].Contains("indexingMode"));
        Assert.Contains(children, c => c.Label.StartsWith("Throughput:"));

        var items = await Expand(backend, conn, CosmosEmulatorKey, NodePath.Parse(orders.Id).Child("f", "items"));
        Assert.Equal(25, items.Length);
    }

    private async Task<TreeNode[]> Expand(IBackend backend, ConnectionConfig conn, string secret, NodePath path)
    {
        var sw = Stopwatch.StartNew();
        var nodes = await backend.ChildrenAsync(conn, secret, path, 2, default);
        output.WriteLine($"{sw.ElapsedMilliseconds,5} ms  {nodes.Length,4} nodes  {path.Id}");
        return nodes;
    }
}
