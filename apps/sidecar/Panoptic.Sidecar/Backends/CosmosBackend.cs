using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Azure.Cosmos;
using Panoptic.Sidecar.Catalog;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Backends;

/// <summary>
/// Cosmos DB for NoSQL. Clients are expensive, so one is cached per connection and dropped when the
/// connection's settings change. Metadata comes from the SDK's feed iterators.
/// </summary>
public sealed class CosmosBackend(Credentials credentials, CosmosAccountKeys? accountKeys = null) : IQueryBackend
{
    private readonly CosmosAccountKeys _accountKeys = accountKeys ?? new();

    private const int ItemSample = 100;
    private static readonly HashSet<string> SystemProperties = ["_rid", "_self", "_etag", "_attachments"];
    private static readonly Regex Insertable = new(@"^[A-Za-z_][A-Za-z0-9_.]*\z");

    /// <summary>
    /// What dragging a container (its name) or a UDF (udf.name) into the editor inserts (node meta "dragText"). Cosmos SQL
    /// has no identifier quoting, so null when the text would not parse. The rule drag-text.ts in the UI used before.
    /// </summary>
    public static string? DragText(string text) => Insertable.IsMatch(text) ? text : null;

    private static Dictionary<string, string>? WithDragText(string text, Dictionary<string, string>? meta = null)
    {
        if (DragText(text) is not { } drag) return meta;
        meta ??= [];
        meta["dragText"] = drag;
        return meta;
    }

    /// <summary>Node meta "copyText", what Copy name copies: the resource's id, udf.name for a UDF.</summary>
    private static Dictionary<string, string> CopyText(string text) => new() { ["copyText"] = text };

    private readonly ConcurrentDictionary<string, (string Fingerprint, CosmosClient Client)> _clients = new();

    public async Task<TreeNode[]> ChildrenAsync(ConnectionConfig c, string? secret, NodePath path, int start, CancellationToken ct)
    {
        var client = await ClientForAsync(c, secret, ct);
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
            throw Failed(ex, c);
        }
    }

    public async Task TestAsync(ConnectionConfig c, string? secret, CancellationToken ct)
    {
        try
        {
            using var iterator = (await ClientForAsync(c, secret, ct)).GetDatabaseQueryStreamIterator(new QueryDefinition("SELECT TOP 1 * FROM c"));
            using var response = await iterator.ReadNextAsync(ct);
            response.EnsureSuccessStatusCode();
        }
        catch (CosmosException ex)
        {
            throw Failed(ex, c);
        }
    }

    /// <summary>
    /// A fetched key that is rejected has likely been rotated: the client goes, so the next attempt fetches it again (#65).
    /// </summary>
    private RpcException Failed(CosmosException ex, ConnectionConfig c)
    {
        DropRejectedKey(ex, c);
        return CosmosErrors.ToRpc(ex, c);
    }

    private void DropRejectedKey(CosmosException ex, ConnectionConfig c)
    {
        if (ex.StatusCode == HttpStatusCode.Unauthorized && c.Auth == AuthKinds.EntraKeys) Forget(c.Id);
    }

    /// <summary>Skipping the certificate check is for the localhost emulator only (see TrustsCertificate).</summary>
    public KindDescription Describe(string kind) => new(
        kind, "Cosmos DB (NoSQL)", "Account URI", "https://myaccount.documents.azure.com:443/",
        [AuthKinds.Option(AuthKinds.Entra), AuthKinds.Option(AuthKinds.EntraKeys), AuthKinds.Option(AuthKinds.Key)],
        new KindBadge("C", "#1f7a74", "Cosmos"),
        new ConnectionFields(Database: false, CertificateOptions: false, EntraUser: false, TrustLocalOnly: true));

    public void Forget(string connectionId)
    {
        if (_clients.TryRemove(connectionId, out var entry)) entry.Client.Dispose();
    }

    // --- Query editor -----------------------------------------------------------------------------------

    public string EditorLanguage => "cosmos";

    /// <summary>A tab is bound to its container, the catalog is sampled (it cannot say a name is missing), and there is no DDL.</summary>
    public QueryCapabilities Capabilities { get; } = new(DatabasePicker: false, UnknownNameWarnings: false, DdlRefresh: false);

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

        var client = await ClientForAsync(target.Connection, secret, ct);
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

                // Past the row limit: keep what fits and stop paging (a Cosmos query has one set, so nothing else runs).
                var room = sink.MaxRows - sink.RowCount(set);
                var full = rows.Count > room;
                if (full) rows = rows[..room];
                var newColumns = columns.Count != sent;
                var none = sink.RowCount(set) == 0;
                if (rows.Count > 0 || none)
                    sink.Rows(set, newColumns || none ? columns.Select(c => new ResultColumn(c, "")).ToArray() : null, rows);
                sent = columns.Count;
                if (full)
                {
                    sink.Truncated(set);
                    break;
                }
            }
        }
        catch (CosmosException ex) when (!ct.IsCancellationRequested)
        {
            DropRejectedKey(ex, target.Connection);
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
    public Task<string?> CatalogStampAsync(QueryTarget target, string? secret, CancellationToken ct) => Task.FromResult<string?>(null);

    public async Task<DatabaseCatalog> CatalogAsync(QueryTarget target, string? secret, EditorSettings editor, CancellationToken ct)
    {
        if (target.Database is null) throw new RpcException(RpcException.InvalidParams, "Select a Cosmos database or container for IntelliSense.");
        return await CosmosCatalog.BuildAsync(await ClientForAsync(target.Connection, secret, ct), target.Database, editor.CatalogSampleDocs, ct);
    }

    // --- Tree -------------------------------------------------------------------------------------------

    private static async Task<TreeNode[]> Databases(CosmosClient client, NodePath path, CancellationToken ct)
    {
        var docs = await ReadAll(client.GetDatabaseQueryStreamIterator(), "Databases", ct);
        return docs
            .Select(d => d.GetProperty("id").GetString()!)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(id => DatabaseNode(path, id))
            .ToArray();
    }

    internal static TreeNode DatabaseNode(NodePath path, string id) =>
        Nodes.Branch(path.Child("db", id), "database", id, "database", CopyText(id), Nodes.Queryable);

    internal static TreeNode ContainerNode(NodePath path, string id, IEnumerable<string> partitionKeyPaths) =>
        Nodes.Branch(path.Child("c", id), "container", id, "container",
            WithDragText(id, new() { ["partitionKey"] = string.Join(", ", partitionKeyPaths), ["copyText"] = id }), Nodes.Selectable);

    private static async Task<TreeNode[]> Containers(Database db, NodePath path, CancellationToken ct)
    {
        var docs = await ReadAll(db.GetContainerQueryStreamIterator(), "DocumentCollections", ct);
        return docs
            .Select(d => (Id: d.GetProperty("id").GetString()!, Pk: PartitionKeyPaths(d)))
            .OrderBy(x => x.Id, StringComparer.OrdinalIgnoreCase)
            .Select(x => ContainerNode(path, x.Id, x.Pk))
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

        return ContainerChildNodes(path, policy, pk, await throughputTask);
    }

    /// <summary>The partition key copies its path; throughput, the indexing policy and the folders have no name to copy.</summary>
    internal static TreeNode[] ContainerChildNodes(NodePath path, string policy, string pk, string throughput)
    {
        var pkMeta = new Dictionary<string, string> { ["value"] = pk };
        if (pk.Length > 0) pkMeta["copyText"] = pk;
        return
        [
            Nodes.Folder(path, "items", $"Items (first {ItemSample})"),
            Nodes.Leaf(path.Child("policy", "indexing"), "indexingPolicy", "Indexing policy", "policy", new() { ["json"] = policy }),
            Nodes.Folder(path, "sprocs", "Stored procedures"),
            Nodes.Folder(path, "triggers", "Triggers"),
            Nodes.Folder(path, "udfs", "UDFs"),
            Nodes.Leaf(path.Child("prop", "partitionKey"), "property", $"Partition key: {pk}", "property", pkMeta),
            Nodes.Leaf(path.Child("prop", "throughput"), "property", $"Throughput: {throughput}", "property"),
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
            .Select(id => ItemNode(path, id))
            .ToArray();
    }

    internal static TreeNode ItemNode(NodePath path, string id) => Nodes.Leaf(path.Child("item", id), "document", id, "document", CopyText(id));

    /// <summary>A stored procedure, trigger or UDF. A UDF is called as udf.name, so that is what it copies and drags.</summary>
    internal static TreeNode ScriptNode(NodePath path, string kind, string id) =>
        Nodes.Leaf(path.Child(kind, id), kind, id, kind, kind == "udf" ? WithDragText($"udf.{id}", CopyText($"udf.{id}")) : CopyText(id));

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
            .Select(id => ScriptNode(path, kind, id))
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

    /// <summary>
    /// The connection's client. Under <see cref="AuthKinds.EntraKeys"/> the account's read-only key is fetched through
    /// Azure Resource Manager first (#65) and kept only in the client, in memory; there is no stored secret.
    /// </summary>
    public async Task<CosmosClient> ClientForAsync(ConnectionConfig c, string? secret, CancellationToken ct)
    {
        if (c.Auth != AuthKinds.EntraKeys) return ClientFor(c, secret);
        var fingerprint = $"{c.Endpoint}|{c.Auth}|{c.TenantId}|{c.ClientId}|{c.TrustServerCertificate}";
        if (_clients.TryGetValue(c.Id, out var cached) && cached.Fingerprint == fingerprint) return cached.Client;

        var key = await _accountKeys.FetchAsync(credentials.For(c.TenantId, c.ClientId), c.Endpoint, ct);
        var client = Create(c, key);
        _clients[c.Id] = (fingerprint, client);
        if (cached.Client is not null) cached.Client.Dispose();
        return client;
    }

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

        var uri = new Uri(c.Endpoint);
        if (c.TrustServerCertificate)
        {
            // Only for the local emulator's self-signed certificate; never for a real account.
            if (!uri.IsLoopback) throw new RpcException(RpcException.InvalidParams, "Skipping certificate validation is only allowed for a localhost emulator");
            options.LimitToEndpoint = true;
        }
        if (uri.IsLoopback)
        {
            var trustAny = c.TrustServerCertificate;
            options.HttpClientFactory = () => new HttpClient(new SocketsHttpHandler
            {
                ConnectCallback = (context, ct) => ConnectLoopbackAsync(context.DnsEndPoint, ct),
                SslOptions = trustAny ? new() { RemoteCertificateValidationCallback = (_, _, _, _) => true } : new(),
            });
        }

        return c.Auth switch
        {
            AuthKinds.Key or AuthKinds.EntraKeys => new CosmosClient(c.Endpoint, secret ?? throw new RpcException(RpcException.InvalidParams, "Account key is required"), options),
            AuthKinds.Entra => new CosmosClient(c.Endpoint, credentials.For(c.TenantId, c.ClientId), options),
            _ => throw new RpcException(RpcException.InvalidParams, $"Cosmos does not support auth '{c.Auth}'"),
        };
    }

    /// <summary>
    /// Connects to every address a loopback host resolves to at once and keeps the first that answers. "localhost"
    /// resolves to ::1 before 127.0.0.1, and Windows retries a refused connection for about 2 s, so with the addresses
    /// tried in turn an emulator listening on 127.0.0.1 only (the Docker image, as dev-db.ps1 runs it) cost 2 s on
    /// every new connection (#185).
    /// </summary>
    internal static async ValueTask<Stream> ConnectLoopbackAsync(DnsEndPoint endpoint, CancellationToken ct)
    {
        var addresses = await Dns.GetHostAddressesAsync(endpoint.Host, ct);
        using var losers = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var won = 0;
        var attempts = addresses.Select(Connect).ToList();
        while (true)
        {
            var done = await Task.WhenAny(attempts);
            attempts.Remove(done);
            try
            {
                var socket = await done;
                losers.Cancel();
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch when (attempts.Count > 0)
            {
                // Refused or unreachable on this address: wait for the others. The last failure is the one thrown.
            }
        }

        async Task<Socket> Connect(IPAddress address)
        {
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(address, endpoint.Port, losers.Token);
                // Only the first to connect is used; one that connects just after it closes again.
                if (Interlocked.Exchange(ref won, 1) == 0) return socket;
                throw new OperationCanceledException();
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        }
    }

    // --- Warm-up ----------------------------------------------------------------------------------------

    /// <summary>
    /// Takes the SDK through client start-up and a database read against canned replies in memory: about 190 ms
    /// of type loading and JIT that the first expand otherwise pays (#185). Nothing leaves the process, so no
    /// account is contacted; that includes the SDK's Azure VM metadata probe, which goes through the same handler
    /// and gets a 404.
    /// </summary>
    public async Task WarmUpAsync(CancellationToken ct)
    {
        var options = new CosmosClientOptions
        {
            ApplicationName = "Panoptic",
            ConnectionMode = ConnectionMode.Gateway,
            LimitToEndpoint = true,
            HttpClientFactory = () => new HttpClient(new CannedGateway()),
        };
        using var client = new CosmosClient(CannedGateway.Endpoint, Convert.ToBase64String(new byte[64]), options);
        await Databases(client, NodePath.Root, ct);
    }

    /// <summary>Answers the account read and the database feed with empty results, and anything else with a 404.</summary>
    private sealed class CannedGateway : HttpMessageHandler
    {
        public const string Endpoint = "https://warm-up.invalid/";

        private const string Account = """
            {"id":"warm-up","_rid":"warm-up","_self":"","_dbs":"//dbs/","media":"//media/","addresses":"//addresses/",
            "writableLocations":[{"name":"local","databaseAccountEndpoint":"https://warm-up.invalid/"}],
            "readableLocations":[{"name":"local","databaseAccountEndpoint":"https://warm-up.invalid/"}],
            "enableMultipleWriteLocations":false,"userConsistencyPolicy":{"defaultConsistencyLevel":"Session"},
            "userReplicationPolicy":{"minReplicaSetSize":1,"maxReplicasetSize":4},
            "systemReplicationPolicy":{"minReplicaSetSize":1,"maxReplicasetSize":4},
            "readPolicy":{"primaryReadCoefficient":1,"secondaryReadCoefficient":1},"queryEngineConfiguration":"{}"}
            """;

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.RequestUri switch
            {
                { Host: "warm-up.invalid", AbsolutePath: "/" } => Account,
                { Host: "warm-up.invalid", AbsolutePath: "/dbs" } => """{"_rid":"","Databases":[],"_count":0}""",
                _ => null,
            };
            var response = new HttpResponseMessage(body is null ? HttpStatusCode.NotFound : HttpStatusCode.OK)
            {
                Content = new StringContent(body ?? "", Encoding.UTF8, "application/json"),
                RequestMessage = request,
            };
            response.Headers.Add("x-ms-activity-id", Guid.NewGuid().ToString());
            response.Headers.Add("x-ms-request-charge", "0");
            return Task.FromResult(response);
        }
    }
}
