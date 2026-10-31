using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Node meta "copyText", what Copy name copies. The UI offers Copy name only on nodes that have it, so a node without
/// copyText has no Copy name. No node carries a copyName action any more.
/// </summary>
public sealed class CopyTextTests : IDisposable
{
    private static readonly NodePath Connection = NodePath.Parse("conn:c");
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}", "store.bin");

    public void Dispose()
    {
        var dir = Path.GetDirectoryName(_path)!;
        if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
    }

    private static string? CopyText(TreeNode node) => node.Meta?.GetValueOrDefault("copyText");

    private static void NoCopyName(TreeNode node)
    {
        Assert.Null(CopyText(node));
        Assert.DoesNotContain("copyName", node.Actions);
    }

    // --- Cosmos ---------------------------------------------------------------------------------------

    [Fact]
    public void Cosmos_databases_containers_and_items_copy_their_id()
    {
        var db = CosmosBackend.DatabaseNode(Connection, "shop");
        Assert.Equal("shop", CopyText(db));
        var container = CosmosBackend.ContainerNode(NodePath.Parse(db.Id), "order-lines", ["/tenantId"]);
        Assert.Equal("order-lines", CopyText(container));
        Assert.False(container.Meta!.ContainsKey("dragText")); // not an identifier, so no drag; copy is unaffected
        Assert.Equal("a1", CopyText(CosmosBackend.ItemNode(NodePath.Parse(container.Id).Child("f", "items"), "a1")));
    }

    [Fact]
    public void Cosmos_scripts_copy_their_name_and_udfs_as_called()
    {
        var container = NodePath.Parse("conn:c/db:shop/c:orders");
        Assert.Equal("bulkDelete", CopyText(CosmosBackend.ScriptNode(container.Child("f", "sprocs"), "sproc", "bulkDelete")));
        Assert.Equal("stamp", CopyText(CosmosBackend.ScriptNode(container.Child("f", "triggers"), "trigger", "stamp")));
        var udf = CosmosBackend.ScriptNode(container.Child("f", "udfs"), "udf", "tax");
        Assert.Equal("udf.tax", CopyText(udf));
        Assert.Equal("udf.tax", udf.Meta!["dragText"]);
        Assert.Equal("udf.tax-2", CopyText(CosmosBackend.ScriptNode(container.Child("f", "udfs"), "udf", "tax-2")));
    }

    [Fact]
    public void Cosmos_partition_key_copies_its_path_and_the_other_container_children_copy_nothing()
    {
        var nodes = CosmosBackend.ContainerChildNodes(NodePath.Parse("conn:c/db:shop/c:orders"), "{}", "/pk", "400 RU/s");

        var pk = Assert.Single(nodes, n => n.Id.EndsWith("prop:partitionKey", StringComparison.Ordinal));
        Assert.Equal("Partition key: /pk", pk.Label);
        Assert.Equal("/pk", CopyText(pk));
        NoCopyName(Assert.Single(nodes, n => n.Id.EndsWith("prop:throughput", StringComparison.Ordinal)));
        NoCopyName(Assert.Single(nodes, n => n.Kind == "indexingPolicy"));
        var folders = nodes.Where(n => n.Kind == "folder").ToArray();
        Assert.Equal(4, folders.Length);
        Assert.All(folders, NoCopyName);
    }

    // --- SQL ------------------------------------------------------------------------------------------

    [Fact]
    public void Sql_objects_are_always_bracketed_with_close_brackets_doubled()
    {
        Assert.Equal("[dbo].[Orders]", SqlBackend.CopyName("dbo", "Orders"));
        Assert.Equal("[dbo].[a]]b]", SqlBackend.CopyName("dbo", "a]b"));
        Assert.Equal("[my schema].[Odd]]Name]", SqlBackend.CopyName("my schema", "Odd]Name"));
    }

    private TreeService Tree()
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("e", "Dev", "#000", false, []));
        store.SaveConnection("e", new ConnectionConfig("s", "sql", ConnectionKinds.Sql, "srv", AuthKinds.Sql, User: "sa"), "pw");
        store.SaveConnection("e", new ConnectionConfig("y", "syn", ConnectionKinds.Synapse, "srv", AuthKinds.Sql, User: "sa"), "pw");
        store.SaveConnection("e", new ConnectionConfig("d", "one db", ConnectionKinds.Sql, "srv", AuthKinds.Sql, User: "sa", Database: "Odd]Db"), "pw");
        return new TreeService(store, BackendRegistry.Create(new Credentials(_ => { })));
    }

    // These shapes are answered without connecting.
    [Theory]
    [InlineData("conn:s/db:Orders")]
    [InlineData("conn:s/db:Orders/f:programmability")]
    [InlineData("conn:s/db:Orders/f:tables/o:dbo%1FOrders")]
    [InlineData("conn:y/db:Pool")]
    [InlineData("conn:y/db:Pool/f:external/o:dbo%1Fx")]
    public async Task Sql_folders_have_no_copy_name(string nodeId)
    {
        var folders = await Tree().ChildrenAsync(nodeId, default);
        Assert.NotEmpty(folders);
        Assert.All(folders, f => Assert.Equal("folder", f.Kind));
        Assert.All(folders, NoCopyName);
    }

    [Fact]
    public async Task Sql_databases_are_bracketed_and_drag_text_is_unchanged()
    {
        // A connection with a fixed database lists it without connecting.
        var db = Assert.Single(await Tree().ChildrenAsync("conn:d", default));
        Assert.Equal("[Odd]]Db]", CopyText(db));
        Assert.Equal(SqlBackend.DragName("Odd]Db"), db.Meta!["dragText"]);
    }

    [Fact]
    public async Task Sql_definitions_have_no_copy_name_and_connections_copy_their_name()
    {
        var tree = Tree();
        foreach (var nodeId in new[] { "conn:s/db:Orders/f:views/o:dbo%1Fv", "conn:s/db:Orders/f:programmability/f:procs/o:dbo%1Fp" })
            NoCopyName(Assert.Single(await tree.ChildrenAsync(nodeId, default), n => n.Kind == "definition"));
        Assert.Equal("sql", CopyText((await tree.ChildrenAsync("env:e", default)).Single(n => n.Id == "conn:s")));
    }

    [SqlFact(NeedsWindows = false), Trait("Category", "SqlIntegration")]
    public async Task Sql_tree_nodes_carry_copy_text()
    {
        var backend = new SqlBackend(new Credentials(_ => { }));
        var conn = new ConnectionConfig("sql1", "dev", ConnectionKinds.Sql, "127.0.0.1,14333", AuthKinds.Sql, User: "sa", TrustServerCertificate: true);
        var root = NodePath.Parse("conn:sql1");
        Task<TreeNode[]> Expand(NodePath path) => backend.ChildrenAsync(conn, SqlFactAttribute.Password, path, 1, default);

        var orders = (await Expand(root)).Single(n => n.Label == "Orders");
        Assert.Equal("[Orders]", CopyText(orders));
        var dbPath = NodePath.Parse(orders.Id);
        Assert.All(await Expand(dbPath), NoCopyName);

        var tables = await Expand(dbPath.Child("f", "tables"));
        Assert.All(tables, t => Assert.Equal(SqlBackend.CopyName(t.Meta!["schema"], t.Meta!["name"]), CopyText(t)));
        var synonym = Assert.Single(await Expand(dbPath.Child("f", "synonyms")));
        Assert.Equal(SqlBackend.CopyName(synonym.Meta!["schema"], synonym.Meta!["name"]), CopyText(synonym));

        // A scratch table, so a column, key and index with ] in their names exist: uniquely named, in tempdb so it
        // cannot move the Orders catalog stamp another test checks, and dropped after.
        var name = $"copytext_{Guid.NewGuid():N}"[..18];
        await using (var create = await backend.OpenAsync(conn, SqlFactAttribute.Password, "tempdb", default))
        {
            await using var cmd = new Microsoft.Data.SqlClient.SqlCommand(
                $"CREATE TABLE dbo.[{name}] ([odd]]col] int NOT NULL CONSTRAINT [pk]]{name}] PRIMARY KEY, x int NULL INDEX [ix]]{name}]);", create);
            await cmd.ExecuteNonQueryAsync();
        }
        try
        {
            var table = root.Child("db", "tempdb").Child("f", "tables").Child("o", "dbo", name);
            Assert.All(await Expand(table), NoCopyName);
            var columns = await Expand(table.Child("f", "columns"));
            Assert.Equal(["[odd]]col]", "[x]"], columns.Select(CopyText));
            Assert.Equal("[odd]]col]", columns[0].Meta!["dragText"]); // drag text unchanged: odd]col needs brackets anyway
            Assert.Equal("x", columns[1].Meta!["dragText"]);
            Assert.Equal($"[pk]]{name}]", CopyText(Assert.Single(await Expand(table.Child("f", "keys")))));
            var indexes = await Expand(table.Child("f", "indexes"));
            Assert.Equal([$"[pk]]{name}]", $"[ix]]{name}]"], indexes.Select(CopyText));
        }
        finally
        {
            await using var drop = await backend.OpenAsync(conn, SqlFactAttribute.Password, "tempdb", default);
            await using var cmd = new Microsoft.Data.SqlClient.SqlCommand($"DROP TABLE IF EXISTS dbo.[{name}];", drop);
            await cmd.ExecuteNonQueryAsync();
        }
    }
}
