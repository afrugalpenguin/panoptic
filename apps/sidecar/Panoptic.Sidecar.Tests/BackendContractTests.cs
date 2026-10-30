using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Panoptic.Sidecar.Backends;
using Panoptic.Sidecar.Catalog;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// A third backend kind, standing in for a future Postgres backend. Everything it does lives in this class; the only
/// other line it needs is its registration (see <see cref="BackendContractTests"/>). No service, RPC method or switch
/// statement knows the kind "fake".
/// </summary>
public sealed class FakeBackend : IQueryBackend
{
    public const string Kind = "fake";

    public Task<TreeNode[]> ChildrenAsync(ConnectionConfig connection, string? secret, NodePath path, int start, CancellationToken ct) =>
        Task.FromResult<TreeNode[]>(Nodes.Shape(path.From(start)) switch
        {
            "" => [Nodes.Branch(path.Child("db", "main"), "database", "main", "database", actions: Nodes.Queryable)],
            "db" => [Nodes.Branch(path.Child("t", "widgets"), "table", "widgets", "table", actions: ["selectTop", "newQuery", "refresh", "copyName", "copyPath"])],
            _ => [],
        });

    public Task TestAsync(ConnectionConfig connection, string? secret, CancellationToken ct) => Task.CompletedTask;

    public void Forget(string connectionId) { }

    public IReadOnlyDictionary<string, string> ActionLabels { get; } = new Dictionary<string, string> { ["copyPath"] = "Copy path" };

    public Task<string?> InvokeAsync(ConnectionConfig connection, string? secret, NodePath path, int start, string actionId, CancellationToken ct) =>
        Task.FromResult<string?>(actionId switch
        {
            "copyName" => Quote(path[path.Count - 1].Value),
            "copyPath" => string.Join('.', path.From(start).Select(s => Quote(s.Value))),
            _ => Nodes.InvokeDefault(actionId),
        });

    public string EditorLanguage => "fakesql";

    public string? TemplateFor(NodePath path, string action) => action switch
    {
        "selectTop" when path[path.Count - 1].Type == "t" => $"SELECT * FROM {Quote(path[path.Count - 1].Value)} LIMIT 1000",
        "selectTop" => null,
        _ => "-- fake",
    };

    /// <summary>1200 numbered rows, sent the sink's batch size at a time, and one message.</summary>
    public Task ExecuteAsync(QueryTarget target, string? secret, string text, IQuerySink sink, CancellationToken ct)
    {
        if (target.Environment.ReadOnly && text.StartsWith("write", StringComparison.OrdinalIgnoreCase))
            throw new RpcException(RpcException.InvalidParams, $"{target.Environment.Name} is read-only.");
        var set = sink.BeginSet();
        var columns = new[] { new ResultColumn("n", "int") };
        var all = Enumerable.Range(1, 1200).Select(n => new object?[] { n }).ToArray();
        for (var i = 0; i < all.Length; i += sink.BatchSize)
            sink.Rows(set, i == 0 ? columns : null, all[i..Math.Min(i + sink.BatchSize, all.Length)]);
        sink.Message("info", $"ran in {target.Database}");
        return Task.CompletedTask;
    }

    public Task<string?> CatalogStampAsync(QueryTarget target, string? secret, CancellationToken ct) => Task.FromResult<string?>(null);

    public Task<DatabaseCatalog> CatalogAsync(QueryTarget target, string? secret, EditorSettings editor, CancellationToken ct) =>
        Task.FromResult(new DatabaseCatalog("", ["public"], [new CatalogObject("widgets", "public", ObjectKinds.Table, [new ColumnRef("n", "int", false)], null)], ["int"], null));

    private static string Quote(string identifier) => $"\"{identifier.Replace("\"", "\"\"")}\"";
}

/// <summary>
/// A backend that only browses (no <see cref="IQueryBackend"/>). It claims query actions anyway, to prove the sidecar
/// strips them centrally.
/// </summary>
public sealed class BrowseOnlyBackend : IBackend
{
    public Task<TreeNode[]> ChildrenAsync(ConnectionConfig connection, string? secret, NodePath path, int start, CancellationToken ct) =>
        Task.FromResult<TreeNode[]>([Nodes.Branch(path.Child("x", "thing"), "thing", "Thing", "thing", actions: Nodes.Selectable)]);

    public Task TestAsync(ConnectionConfig connection, string? secret, CancellationToken ct) => Task.CompletedTask;

    public void Forget(string connectionId) { }
}

/// <summary>
/// Proves the backend contract: a backend registered in <see cref="BackendRegistry"/>'s map is listed, queried,
/// templated, catalogued and given actions through the real services and RPC methods, wired as Program.cs wires them.
/// </summary>
public sealed class BackendContractTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");
    private readonly ConcurrentQueue<(string Method, string Params)> _notes = new();
    private readonly Channel<CatalogNotice> _catalogNotices = Channel.CreateUnbounded<CatalogNotice>();
    private int _id;

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private JsonRpcDispatcher Sidecar(bool readOnly = false)
    {
        var store = new ConfigStore(Path.Combine(_dir, "store.bin"));
        store.SaveEnvironment(new EnvironmentConfig("e", "Lab", "#000", readOnly, []));
        store.SaveConnection("e", new ConnectionConfig("f", "Fake one", FakeBackend.Kind, "fake://host", AuthKinds.Key), "secret");
        store.SaveConnection("e", new ConnectionConfig("b", "Browser", "browse", "browse://host", AuthKinds.Key), "secret");

        var backends = BackendRegistry.Create(new Credentials(_ => { }));
        backends[FakeBackend.Kind] = new FakeBackend(); // the registration line
        backends["browse"] = new BrowseOnlyBackend();

        var tree = new TreeService(store, backends);
        var query = new QueryService(store, tree, (method, write) =>
        {
            using var buffer = new MemoryStream();
            using (var w = new Utf8JsonWriter(buffer)) write(w);
            _notes.Enqueue((method, Encoding.UTF8.GetString(buffer.ToArray())));
        });
        var catalog = new CatalogService(p => tree.ResolveTarget(p.NodeId, p.Database), new CatalogCache(Path.Combine(_dir, "catalog")),
            new CatalogSources(store, tree), (_, notice) => _catalogNotices.Writer.TryWrite(notice));
        return new JsonRpcDispatcher(Methods.Create(new SidecarInfo(1, "0.1.0", "test"), store, tree, query, catalog));
    }

    private async Task<JsonElement> Call(JsonRpcDispatcher sidecar, string method, object parameters)
    {
        var request = JsonSerializer.Serialize(new { jsonrpc = "2.0", id = ++_id, method, @params = parameters });
        var response = JsonDocument.Parse((await sidecar.HandleAsync(request))!).RootElement;
        Assert.False(response.TryGetProperty("error", out var error), error.ToString());
        return response.GetProperty("result").Clone();
    }

    private List<JsonElement> Notes(string method) =>
        _notes.Where(n => n.Method == method).Select(n => JsonDocument.Parse(n.Params).RootElement).ToList();

    private const string Widgets = "env:e/conn:f/db:main/t:widgets";

    [Fact]
    public async Task Tree_lists_the_new_kind_through_the_registry()
    {
        var sidecar = Sidecar();

        var connection = (await Call(sidecar, "tree.children", new { nodeId = "env:e" })).EnumerateArray().First(n => n.GetProperty("id").GetString() == "env:e/conn:f");
        Assert.Equal(FakeBackend.Kind, connection.GetProperty("meta").GetProperty("connectionKind").GetString());
        var database = Assert.Single((await Call(sidecar, "tree.children", new { nodeId = "env:e/conn:f" })).EnumerateArray());
        Assert.Equal("env:e/conn:f/db:main", database.GetProperty("id").GetString());
        var table = Assert.Single((await Call(sidecar, "tree.children", new { nodeId = database.GetProperty("id").GetString() })).EnumerateArray());
        Assert.Equal(Widgets, table.GetProperty("id").GetString());
        Assert.Contains("copyPath", table.GetProperty("actions").EnumerateArray().Select(a => a.GetString()));
    }

    [Fact]
    public async Task Templates_language_and_scope_come_from_the_backend()
    {
        var sidecar = Sidecar();

        var select = await Call(sidecar, "query.template", new { nodeId = Widgets, action = "selectTop" });
        Assert.Equal("SELECT * FROM \"widgets\" LIMIT 1000", select.GetProperty("text").GetString());
        Assert.Equal("fakesql", select.GetProperty("language").GetString());
        var scope = select.GetProperty("scope");
        Assert.Equal("env:e/conn:f", scope.GetProperty("connection").GetString());
        Assert.Equal("main", scope.GetProperty("database").GetString());
        Assert.Equal("main", scope.GetProperty("label").GetString());
        Assert.Equal("Fake one", scope.GetProperty("connectionLabel").GetString());

        Assert.Equal("-- fake", (await Call(sidecar, "query.template", new { nodeId = "env:e/conn:f", action = "newQuery" })).GetProperty("text").GetString());
        Assert.Equal("Fake one", (await Call(sidecar, "query.scope", new { nodeId = "env:e/conn:f" })).GetProperty("label").GetString());
    }

    [Fact]
    public async Task Query_streams_rows_in_batches_and_returns_a_summary()
    {
        var sidecar = Sidecar();

        var summary = await Call(sidecar, "query.execute", new { queryId = "q1", nodeId = Widgets, text = "select" });

        Assert.Equal(1200, Assert.Single(summary.GetProperty("resultSets").EnumerateArray()).GetProperty("rowCount").GetInt32());
        Assert.False(summary.TryGetProperty("error", out _));
        var batches = Notes("query.rows");
        Assert.Equal([500, 500, 200], batches.Select(b => b.GetProperty("rows").GetArrayLength()));
        Assert.Equal("n", batches[0].GetProperty("columns")[0].GetProperty("name").GetString());
        Assert.False(batches[1].TryGetProperty("columns", out _));
        Assert.Equal("ran in main", Assert.Single(Notes("query.message")).GetProperty("text").GetString());
    }

    [Fact]
    public async Task Read_only_policy_reaches_the_backend()
    {
        var summary = await Call(Sidecar(readOnly: true), "query.execute", new { queryId = "q2", nodeId = Widgets, text = "write something" });

        Assert.Equal("Lab is read-only.", summary.GetProperty("error").GetString());
        Assert.Empty(summary.GetProperty("resultSets").EnumerateArray());
    }

    [Fact]
    public async Task Actions_are_labelled_and_invoked_by_the_backend()
    {
        var sidecar = Sidecar();

        var labels = await Call(sidecar, "node.actionLabels", new { });
        Assert.Equal("Copy path", labels.GetProperty("copyPath").GetString());
        Assert.Equal("Select top 1000", labels.GetProperty("selectTop").GetString());

        Assert.Equal("\"widgets\"", (await Call(sidecar, "node.invoke", new { nodeId = Widgets, actionId = "copyName" })).GetProperty("text").GetString());
        Assert.Equal("\"main\".\"widgets\"", (await Call(sidecar, "node.invoke", new { nodeId = Widgets, actionId = "copyPath" })).GetProperty("text").GetString());
        // Connections copy their label, which the UI already has.
        Assert.False((await Call(sidecar, "node.invoke", new { nodeId = "env:e/conn:f", actionId = "copyName" })).TryGetProperty("text", out _));
    }

    [Fact]
    public async Task Catalog_is_built_by_the_backend()
    {
        var sidecar = Sidecar();

        var result = await Call(sidecar, "catalog.get", new { nodeId = Widgets });

        Assert.Equal(CatalogStates.Building, result.GetProperty("state").GetString());
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var notice = await _catalogNotices.Reader.ReadAsync(timeout.Token);
        Assert.Equal(CatalogStates.Current, notice.State);
        Assert.Equal("widgets", Assert.Single(notice.Catalog!.Objects).Name);
    }

    private async Task<JsonElement> Error(JsonRpcDispatcher sidecar, string method, object parameters)
    {
        var request = JsonSerializer.Serialize(new { jsonrpc = "2.0", id = ++_id, method, @params = parameters });
        return JsonDocument.Parse((await sidecar.HandleAsync(request))!).RootElement.GetProperty("error").Clone();
    }

    private static string[] ActionsOf(JsonElement node) => node.GetProperty("actions").EnumerateArray().Select(a => a.GetString()!).ToArray();

    [Fact]
    public async Task A_browse_only_backend_offers_no_query_actions_and_queries_are_refused()
    {
        var sidecar = Sidecar();

        var connection = (await Call(sidecar, "tree.children", new { nodeId = "env:e" })).EnumerateArray().First(n => n.GetProperty("id").GetString() == "env:e/conn:b");
        Assert.Equal(["refresh", "copyName"], ActionsOf(connection));
        var thing = Assert.Single((await Call(sidecar, "tree.children", new { nodeId = "env:e/conn:b" })).EnumerateArray());
        Assert.Equal(["refresh", "copyName"], ActionsOf(thing));
        // A query backend's connection and nodes keep theirs.
        var fake = (await Call(sidecar, "tree.children", new { nodeId = "env:e" })).EnumerateArray().First(n => n.GetProperty("id").GetString() == "env:e/conn:f");
        Assert.Equal(["newQuery", "refresh", "copyName"], ActionsOf(fake));

        var summary = await Call(sidecar, "query.execute", new { queryId = "q3", nodeId = "env:e/conn:b", text = "x" });
        Assert.Equal("browse connections cannot run queries.", summary.GetProperty("error").GetString());
        var template = await Error(sidecar, "query.template", new { nodeId = "env:e/conn:b/x:thing", action = "selectTop" });
        Assert.Equal(RpcException.InvalidParams, template.GetProperty("code").GetInt32());
        Assert.Equal("browse connections cannot run queries.", template.GetProperty("message").GetString());

        await Call(sidecar, "catalog.get", new { nodeId = "env:e/conn:b" });
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var notice = await _catalogNotices.Reader.ReadAsync(timeout.Token);
        Assert.Equal(CatalogStates.Error, notice.State);
        Assert.Equal("browse connections have no IntelliSense catalog.", notice.Message);
    }

    [Fact]
    public void Built_in_kinds_are_registered_in_one_map()
    {
        var backends = BackendRegistry.Create(new Credentials(_ => { }));

        Assert.Equal([ConnectionKinds.Cosmos, ConnectionKinds.Sql, ConnectionKinds.Synapse], backends.Keys.Order());
        Assert.Same(backends[ConnectionKinds.Sql], backends[ConnectionKinds.Synapse]);
    }
}

/// <summary>
/// Pins copyName exactly as it was when the UI computed it from node meta: [schema].[name] with no escaping of ],
/// a column's bare name, else the node's label (null here: the UI copies the label). The missing escaping, and Cosmos
/// copying labels such as "Partition key: /pk", are known bugs preserved deliberately by the refactor that moved this
/// into the backends; a follow-up fix changes them.
/// </summary>
public sealed class CopyNameTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}", "store.bin");

    public void Dispose()
    {
        var dir = Path.GetDirectoryName(_path)!;
        if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
    }

    private TreeService Tree()
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("e", "Dev", "#000", false, []));
        store.SaveConnection("e", new ConnectionConfig("s", "sql", ConnectionKinds.Sql, "srv", AuthKinds.Sql, User: "sa"), "pw");
        store.SaveConnection("e", new ConnectionConfig("y", "syn", ConnectionKinds.Synapse, "srv", AuthKinds.Sql, User: "sa"), "pw");
        store.SaveConnection("e", new ConnectionConfig("c", "cos", ConnectionKinds.Cosmos, "https://localhost:8081", AuthKinds.Key), "key");
        return new TreeService(store, BackendRegistry.Create(new Credentials(_ => { })));
    }

    [Theory]
    [InlineData("env:e/conn:s/db:Orders/f:tables/o:dbo%1FOrders", "[dbo].[Orders]")]
    [InlineData("env:e/conn:s/db:Orders/f:tables/o:my%20schema%1FOdd%5DName", "[my schema].[Odd]Name]")]
    [InlineData("env:e/conn:y/db:Pool/f:views/o:dbo%1Fv", "[dbo].[v]")]
    [InlineData("env:e/conn:s/db:Orders/f:synonyms/o:dbo%1FSyn", "[dbo].[Syn]")]
    [InlineData("env:e/conn:s/db:Orders/f:tables/o:dbo%1FOrders/f:columns/col:Unit%20Price", "Unit Price")]
    [InlineData("env:e/conn:s/db:Orders/f:tables/o:dbo%1Fa%5Db/f:columns/col:x%5Dy", "x]y")]
    public async Task Sql_names_match_the_old_ui_rule(string nodeId, string expected)
    {
        Assert.Equal(expected, await Tree().InvokeAsync(nodeId, "copyName", default));
    }

    [Theory]
    [InlineData("env:e")]
    [InlineData("env:e/conn:s")]
    [InlineData("env:e/conn:s/db:Orders")]
    [InlineData("env:e/conn:s/db:Orders/f:tables")]
    [InlineData("env:e/conn:s/db:Orders/f:tables/o:dbo%1FOrders/f:keys/key:PK_Orders")]
    [InlineData("env:e/conn:s/db:Orders/f:views/o:dbo%1Fv/def:definition")]
    [InlineData("env:e/conn:c/db:shop")]
    [InlineData("env:e/conn:c/db:shop/c:orders")]
    [InlineData("env:e/conn:c/db:shop/c:orders/prop:partitionKey")]
    [InlineData("env:e/conn:c/db:shop/c:orders/f:items/item:a1")]
    [InlineData("env:e/conn:c/db:shop/c:orders/f:udfs/udf:tax")]
    public async Task Everything_else_copies_its_label(string nodeId)
    {
        Assert.Null(await Tree().InvokeAsync(nodeId, "copyName", default));
    }

    [Fact]
    public async Task Unknown_actions_are_refused()
    {
        var ex = await Assert.ThrowsAsync<RpcException>(() => Tree().InvokeAsync("env:e/conn:c/db:shop", "dropEverything", default));
        Assert.Equal(RpcException.InvalidParams, ex.Code);
    }
}
