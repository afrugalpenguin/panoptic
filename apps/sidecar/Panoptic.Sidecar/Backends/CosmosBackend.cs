using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Azure.Cosmos;
using Panoptic.Sidecar.Catalog;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Backends;

/// <summary>
/// Cosmos DB for NoSQL. Clients are expensive, so one is cached per connection and dropped when the
/// connection's settings change. Metadata comes from the SDK's feed iterators.
/// </summary>
public sealed class CosmosBackend(Credentials credentials) : IBackend
{
    private const int ItemSample = 100;
    private static readonly HashSet<string> SystemProperties = ["_rid", "_self", "_etag", "_attachments"];

    private readonly ConcurrentDictionary<string, (string Fingerprint, CosmosClient Client)> _clients = new();

    public async Task<TreeNode[]> ChildrenAsync(ConnectionConfig c, string? secret, NodePath path, int start, CancellationToken ct)
    {
        var client = ClientFor(c, secret);
        var rel = path.From(start);
        try
        {
            return Nodes.Shape(rel) switch
            {
                "" => await Databases(client, path, ct),
                "db" => await Containers(client.GetDatabase(rel[0].Value), path, ct),
                "db/c" => await ContainerChildren(client.GetDatabase(rel[0].Value), rel[1].Value, path, ct),
                "db/c/f:items" => await Items(client.GetContainer(rel[0].Value, rel[1].Value), path, ct),
                "db/c/f:sprocs" => await Scripts(client.GetContainer(rel[0].Value, rel[1].Value), path, "sproc", ct),
                "db/c/f:triggers" => await Scripts(client.GetContainer(rel[0].Value, rel[1].Value), path, "trigger", ct),
                "db/c/f:udfs" => await Scripts(client.GetContainer(rel[0].Value, rel[1].Value), path, "udf", ct),
                _ => throw new RpcException(RpcException.InvalidParams, $"No children for {path}"),
            };
        }
        catch (CosmosException ex)
        {
            throw CosmosErrors.ToRpc(ex, c);
        }
    }

    public async Task TestAsync(ConnectionConfig c, string? secret, CancellationToken ct)
    {
        try
        {
            using var iterator = ClientFor(c, secret).GetDatabaseQueryStreamIterator(new QueryDefinition("SELECT TOP 1 * FROM c"));
            using var response = await iterator.ReadNextAsync(ct);
            response.EnsureSuccessStatusCode();
        }
        catch (CosmosException ex)
        {
            throw CosmosErrors.ToRpc(ex, c);
        }
    }

    public void Forget(string connectionId)
    {
        if (_clients.TryRemove(connectionId, out var entry)) entry.Client.Dispose();
    }

    // --- Query editor -----------------------------------------------------------------------------------

    public string EditorLanguage => "cosmos";

    /// <summary>selectTop on a container; any other action opens empty.</summary>
    public string? TemplateFor(NodePath path, string action)
    {
        if (action != "selectTop") return "";
        var last = path.Count > 0 ? path[path.Count - 1] : default;
        return last.Type == "c" ? "SELECT TOP 1000 * FROM c" : null;
    }

    /// <summary>
    /// Runs one query against the target's container as one result set. Documents become rows: id first, as Data
    /// Explorer shows it, then each property in the order first seen, system properties hidden; columns grow as new
    /// properties appear. Cosmos queries cannot write, so read-only environments need no guard here.
    /// </summary>
    public async Task ExecuteAsync(QueryTarget target, string? secret, string text, IQuerySink sink, CancellationToken ct)
    {
        if (target.Database is null || target.Container is null)
            throw new RpcException(RpcException.InvalidParams, "Select a container to query: Cosmos queries run against one container.");

        var client = ClientFor(target.Connection, secret);
        var container = client.GetContainer(target.Database, target.Container);
        using var iterator = container.GetItemQueryStreamIterator(new QueryDefinition(text), requestOptions: new QueryRequestOptions { MaxItemCount = sink.BatchSize });

        var set = sink.BeginSet();
        var columns = new List<string>();
        var position = new Dictionary<string, int>();
        var sent = 0;
        sink.AddCharge(0);

        try
        {
            while (iterator.HasMoreResults)
            {
                using var response = await iterator.ReadNextAsync(ct);
                sink.AddCharge(response.Headers.RequestCharge);
                if (!response.IsSuccessStatusCode)
                    throw new RpcException(RpcException.OperationFailed, $"{(int)response.StatusCode} {response.ErrorMessage?.Split('\n')[0]}");

                using var page = await JsonDocument.ParseAsync(response.Content, cancellationToken: ct);
                var rows = new List<object?[]>();
                foreach (var doc in page.RootElement.GetProperty("Documents").EnumerateArray())
                {
                    var values = new Dictionary<int, object?>();
                    if (doc.ValueKind != JsonValueKind.Object)
                    {
                        values[Column("value")] = doc.Clone(); // SELECT VALUE ... returns bare values
                    }
                    else
                    {
                        if (doc.TryGetProperty("id", out var id)) values[Column("id")] = id.Clone();
                        foreach (var prop in doc.EnumerateObject())
                            if (prop.Name != "id" && !SystemProperties.Contains(prop.Name)) values[Column(prop.Name)] = prop.Value.Clone();
                    }
                    var row = new object?[columns.Count];
                    foreach (var (i, value) in values) row[i] = value;
                    rows.Add(row);
                }

                var newColumns = columns.Count != sent;
                var none = sink.RowCount(set) == 0;
                if (rows.Count > 0 || none)
                    sink.Rows(set, newColumns || none ? columns.Select(c => new ResultColumn(c, "")).ToArray() : null, rows);
                sent = columns.Count;
            }
        }
        catch (CosmosException ex) when (!ct.IsCancellationRequested)
        {
            sink.Fail($"{(int)ex.StatusCode} {ex.StatusCode}: {ex.Message.Split('\n')[0]}");
        }

        int Column(string name)
        {
            if (position.TryGetValue(name, out var i)) return i;
            i = columns.Count;
            columns.Add(name);
            position[name] = i;
            return i;
        }
    }

    /// <summary>Cosmos has no cheap change stamp, so the catalog is rebuilt (re-sampled) once per session.</summary>
    public Task<DatabaseCatalog> CatalogAsync(QueryTarget target, string? secret, EditorSettings editor, CancellationToken ct)
    {
        if (target.Database is null) throw new RpcException(RpcException.InvalidParams, "Select a Cosmos database or container for IntelliSense.");
        return CosmosCatalog.BuildAsync(ClientFor(target.Connection, secret), target.Database, editor.CatalogSampleDocs, ct);
    }

    // --- Tree -------------------------------------------------------------------------------------------

    private static async Task<TreeNode[]> Databases(CosmosClient client, NodePath path, CancellationToken ct)
    {
        var docs = await ReadAll(client.GetDatabaseQueryStreamIterator(), "Databases", ct);
        return docs
            .Select(d => d.GetProperty("id").GetString()!)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(id => Nodes.Branch(path.Child("db", id), "database", id, "database", actions: Nodes.Queryable))
            .ToArray();
    }

    private static async Task<TreeNode[]> Containers(Database db, NodePath path, CancellationToken ct)
    {
        var docs = await ReadAll(db.GetContainerQueryStreamIterator(), "DocumentCollections", ct);
        return docs
            .Select(d => (Id: d.GetProperty("id").GetString()!, Pk: PartitionKeyPaths(d)))
            .OrderBy(x => x.Id, StringComparer.OrdinalIgnoreCase)
            .Select(x => Nodes.Branch(path.Child("c", x.Id), "container", x.Id, "container",
                new() { ["partitionKey"] = string.Join(", ", x.Pk) }, Nodes.Selectable))
            .ToArray();
    }

    private static async Task<TreeNode[]> ContainerChildren(Database db, string containerId, NodePath path, CancellationToken ct)
    {
        var container = db.GetContainer(containerId);
        var propsTask = container.ReadContainerStreamAsync(cancellationToken: ct);
        var throughputTask = Throughput(db, container, ct);

        using var propsResponse = await propsTask;
        propsResponse.EnsureSuccessStatusCode();
        using var props = await JsonDocument.ParseAsync(propsResponse.Content, cancellationToken: ct);
        var root = props.RootElement;

        var policy = root.TryGetProperty("indexingPolicy", out var p) ? p.GetRawText() : "{}";
        var pk = string.Join(", ", PartitionKeyPaths(root));

        return
        [
            Nodes.Folder(path, "items", $"Items (first {ItemSample})"),
            Nodes.Leaf(path.Child("policy", "indexing"), "indexingPolicy", "Indexing policy", "policy", new() { ["json"] = policy }),
            Nodes.Folder(path, "sprocs", "Stored procedures"),
            Nodes.Folder(path, "triggers", "Triggers"),
            Nodes.Folder(path, "udfs", "UDFs"),
            Nodes.Leaf(path.Child("prop", "partitionKey"), "property", $"Partition key: {pk}", "property", new() { ["value"] = pk }),
            Nodes.Leaf(path.Child("prop", "throughput"), "property", $"Throughput: {await throughputTask}", "property"),
        ];
    }

    private static Task<string> Throughput(Database db, Container container, CancellationToken ct) =>
        Throughput(t => container.ReadThroughputAsync(new RequestOptions(), t), t => db.ReadThroughputAsync(new RequestOptions(), t), ct);

    /// <summary>Takes the two offer reads as delegates so tests can fake them.</summary>
    internal static async Task<string> Throughput(
        Func<CancellationToken, Task<ThroughputResponse>> readOwn,
        Func<CancellationToken, Task<ThroughputResponse>> readShared,
        CancellationToken ct)
    {
        static string Format(ThroughputResponse r) =>
            r.Resource.AutoscaleMaxThroughput is int max ? $"autoscale up to {max:N0} RU/s" : $"{r.Resource.Throughput:N0} RU/s";
        try
        {
            var own = await readOwn(ct);
            if (own.Resource is not null) return Format(own);
        }
        catch (CosmosException ex) when (ex.StatusCode is HttpStatusCode.Forbidden)
        {
            // Cosmos RBAC data-plane roles cannot read offers, so the database read would 403 too.
            // Only this leaf degrades; the container's other reads still surface their own errors.
            return "not visible with this identity";
        }
        catch (CosmosException ex) when (ex.StatusCode is HttpStatusCode.NotFound)
        {
            // Container has no dedicated throughput; fall through to the database's shared throughput.
        }
        catch (CosmosException ex) when (ex.StatusCode is HttpStatusCode.BadRequest)
        {
            return "serverless";
        }

        try
        {
            var shared = await readShared(ct);
            return shared.Resource is null ? "unknown" : $"{Format(shared)} (shared)";
        }
        catch (CosmosException)
        {
            return "unknown";
        }
    }

    private static async Task<TreeNode[]> Items(Container container, NodePath path, CancellationToken ct)
    {
        var query = new QueryDefinition($"SELECT TOP {ItemSample} c.id FROM c");
        var docs = await ReadAll(container.GetItemQueryStreamIterator(query, requestOptions: new QueryRequestOptions { MaxItemCount = ItemSample }),
            "Documents", ct, limit: ItemSample);
        return docs
            .Select(d => d.GetProperty("id").GetString()!)
            .Select(id => Nodes.Leaf(path.Child("item", id), "document", id, "document"))
            .ToArray();
    }

    private static async Task<TreeNode[]> Scripts(Container container, NodePath path, string kind, CancellationToken ct)
    {
        var scripts = container.Scripts;
        using var iterator = kind switch
        {
            "sproc" => scripts.GetStoredProcedureQueryStreamIterator(),
            "trigger" => scripts.GetTriggerQueryStreamIterator(),
            _ => scripts.GetUserDefinedFunctionQueryStreamIterator(),
        };
        var collection = kind switch { "sproc" => "StoredProcedures", "trigger" => "Triggers", _ => "UserDefinedFunctions" };
        var docs = await ReadAll(iterator, collection, ct);
        return docs
            .Select(d => d.GetProperty("id").GetString()!)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(id => Nodes.Leaf(path.Child(kind, id), kind, id, kind))
            .ToArray();
    }

    /// <summary>Drains a stream feed iterator, returning the elements of the named array in each page.</summary>
    internal static async Task<List<JsonElement>> ReadAll(FeedIterator iterator, string arrayName, CancellationToken ct, int limit = int.MaxValue)
    {
        var results = new List<JsonElement>();
        using (iterator)
        {
            while (iterator.HasMoreResults && results.Count < limit)
            {
                using var response = await iterator.ReadNextAsync(ct);
                // Throws a CosmosException, which callers map with status, substatus and ActivityId.
                response.EnsureSuccessStatusCode();
                using var doc = await JsonDocument.ParseAsync(response.Content, cancellationToken: ct);
                if (doc.RootElement.TryGetProperty(arrayName, out var items))
                    foreach (var item in items.EnumerateArray()) results.Add(item.Clone());
            }
        }
        return results.Count > limit ? results[..limit] : results;
    }

    internal static IEnumerable<string> PartitionKeyPaths(JsonElement container) =>
        container.TryGetProperty("partitionKey", out var pk) && pk.TryGetProperty("paths", out var paths)
            ? paths.EnumerateArray().Select(p => p.GetString()!)
            : [];

    public CosmosClient ClientFor(ConnectionConfig c, string? secret)
    {
        var fingerprint = $"{c.Endpoint}|{c.Auth}|{c.TenantId}|{c.TrustServerCertificate}|{Convert.ToBase64String(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(secret ?? "")))}";
        if (_clients.TryGetValue(c.Id, out var cached) && cached.Fingerprint == fingerprint) return cached.Client;

        var client = Create(c, secret);
        _clients[c.Id] = (fingerprint, client);
        if (cached.Client is not null) cached.Client.Dispose();
        return client;
    }

    private CosmosClient Create(ConnectionConfig c, string? secret)
    {
        var options = new CosmosClientOptions
        {
            ApplicationName = "Panoptic",
            RequestTimeout = TimeSpan.FromSeconds(15),
            ConnectionMode = ConnectionMode.Gateway,
        };

        if (c.TrustServerCertificate)
        {
            // Only for the local emulator's self-signed certificate; never for a real account.
            var uri = new Uri(c.Endpoint);
            if (!uri.IsLoopback) throw new RpcException(RpcException.InvalidParams, "Skipping certificate validation is only allowed for a localhost emulator");
            options.LimitToEndpoint = true;
            options.HttpClientFactory = () => new HttpClient(new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
            });
        }

        return c.Auth switch
        {
            AuthKinds.Key => new CosmosClient(c.Endpoint, secret ?? throw new RpcException(RpcException.InvalidParams, "Account key is required"), options),
            AuthKinds.Entra => new CosmosClient(c.Endpoint, credentials.For(c.TenantId), options),
            _ => throw new RpcException(RpcException.InvalidParams, $"Cosmos does not support auth '{c.Auth}'"),
        };
    }
}
