using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Azure.Cosmos;

namespace Panoptic.Sidecar.Backends;

/// <summary>
/// Cosmos DB for NoSQL. Clients are expensive, so one is cached per connection and dropped when the
/// connection's settings change. Metadata comes from the SDK's feed iterators.
/// </summary>
public sealed class CosmosBackend(Credentials credentials) : IBackend
{
    private const int ItemSample = 100;

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
            throw new RpcException(RpcException.OperationFailed, Describe(ex));
        }
    }

    public async Task TestAsync(ConnectionConfig c, string? secret, CancellationToken ct)
    {
        try
        {
            using var iterator = ClientFor(c, secret).GetDatabaseQueryStreamIterator(new QueryDefinition("SELECT TOP 1 * FROM c"));
            using var response = await iterator.ReadNextAsync(ct);
            if (!response.IsSuccessStatusCode) throw new RpcException(RpcException.OperationFailed, $"{(int)response.StatusCode} {response.ErrorMessage}");
        }
        catch (CosmosException ex)
        {
            throw new RpcException(RpcException.OperationFailed, Describe(ex));
        }
    }

    public void Forget(string connectionId)
    {
        if (_clients.TryRemove(connectionId, out var entry)) entry.Client.Dispose();
    }

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
        if (!propsResponse.IsSuccessStatusCode)
            throw new RpcException(RpcException.OperationFailed, $"{(int)propsResponse.StatusCode} {propsResponse.ErrorMessage}");
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

    private static async Task<string> Throughput(Database db, Container container, CancellationToken ct)
    {
        static string Format(ThroughputResponse r) =>
            r.Resource.AutoscaleMaxThroughput is int max ? $"autoscale up to {max:N0} RU/s" : $"{r.Resource.Throughput:N0} RU/s";
        try
        {
            var own = await container.ReadThroughputAsync(new RequestOptions(), ct);
            if (own.Resource is not null) return Format(own);
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
            var shared = await db.ReadThroughputAsync(new RequestOptions(), ct);
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
    private static async Task<List<JsonElement>> ReadAll(FeedIterator iterator, string arrayName, CancellationToken ct, int limit = int.MaxValue)
    {
        var results = new List<JsonElement>();
        using (iterator)
        {
            while (iterator.HasMoreResults && results.Count < limit)
            {
                using var response = await iterator.ReadNextAsync(ct);
                if (!response.IsSuccessStatusCode)
                    throw new RpcException(RpcException.OperationFailed, $"{(int)response.StatusCode} {response.ErrorMessage}");
                using var doc = await JsonDocument.ParseAsync(response.Content, cancellationToken: ct);
                if (doc.RootElement.TryGetProperty(arrayName, out var items))
                    foreach (var item in items.EnumerateArray()) results.Add(item.Clone());
            }
        }
        return results.Count > limit ? results[..limit] : results;
    }

    private static IEnumerable<string> PartitionKeyPaths(JsonElement container) =>
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

    private static string Describe(CosmosException ex) =>
        ex.StatusCode == HttpStatusCode.Forbidden
            ? $"Forbidden: your identity needs a Cosmos DB data-plane role (e.g. Built-in Data Reader). {ex.Message.Split('\n')[0]}"
            : $"{(int)ex.StatusCode} {ex.StatusCode}: {ex.Message.Split('\n')[0]}";
}
