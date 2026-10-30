using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar;

/// <summary>
/// Serves the node contract: environments and connections from the store, everything below a
/// connection from that connection's backend.
/// </summary>
public sealed class TreeService(ConfigStore store, IReadOnlyDictionary<string, IBackend> backends)
{
    public async Task<TreeNode[]> ChildrenAsync(string nodeId, CancellationToken cancellationToken)
    {
        var path = NodePath.Parse(nodeId);

        if (path.Count == 0)
            return store.Config.Environments.Select(EnvironmentNode).ToArray();

        if (path[0].Type != "env") throw new RpcException(RpcException.InvalidParams, $"Unknown node: {nodeId}");
        var env = store.FindEnvironment(path[0].Value) ?? throw new RpcException(RpcException.OperationFailed, "Environment no longer exists");

        if (path.Count == 1)
            return env.Connections.Select(c => ConnectionNode(path, c, backends.GetValueOrDefault(c.Kind) is IQueryBackend)).ToArray();

        if (path[1].Type != "conn") throw new RpcException(RpcException.InvalidParams, $"Unknown node: {nodeId}");
        var connection = env.Connections.FirstOrDefault(c => c.Id == path[1].Value)
            ?? throw new RpcException(RpcException.OperationFailed, "Connection no longer exists");

        var backend = BackendFor(connection);
        try
        {
            var nodes = await backend.ChildrenAsync(connection, store.GetSecret(connection.Id), path, 2, cancellationToken);
            // Checked here, not left to each backend: only a query backend's nodes may offer query tabs.
            return backend is IQueryBackend ? nodes : nodes.Select(WithoutQueryActions).ToArray();
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not RpcException { NodeError: not null })
        {
            // Unmapped failures (sign-in, network, bad settings) still reach the tree as a structured error.
            var detail = NodeErrors.Lines(("Endpoint", connection.Endpoint), ("Identity", NodeErrors.Identity(connection)));
            throw new RpcException(ex is RpcException rpc ? rpc.Code : RpcException.OperationFailed, ex.Message,
                NodeErrors.Fallback(ex.Message, extra: detail));
        }
    }

    /// <summary>The environment, connection and database (and Cosmos container) a node belongs to.</summary>
    /// <param name="database">Overrides the node's database (a query tab's database picker). It only ever reaches
    /// SqlConnectionStringBuilder.InitialCatalog or the Cosmos SDK, never SQL text, but is still bounded here.</param>
    public QueryTarget ResolveTarget(string nodeId, string? database = null)
    {
        if (database is not null && (database.Length is 0 or > 128 || database.Any(char.IsControl)))
            throw new RpcException(RpcException.InvalidParams, "Invalid database name");
        var path = NodePath.Parse(nodeId);
        if (path.Count < 2 || path[0].Type != "env" || path[1].Type != "conn")
            throw new RpcException(RpcException.InvalidParams, "Select a connection, database or object to query.");
        var env = store.FindEnvironment(path[0].Value) ?? throw new RpcException(RpcException.OperationFailed, "Environment no longer exists");
        var connection = env.Connections.FirstOrDefault(c => c.Id == path[1].Value)
            ?? throw new RpcException(RpcException.OperationFailed, "Connection no longer exists");
        var segment = (string type) => path.Segments.Skip(2).FirstOrDefault(s => s.Type == type).Value;
        var nodeDatabase = segment("db") ?? connection.Database;
        // A container belongs to the node's database; switching database leaves none selected.
        var container = database is null || database == nodeDatabase ? segment("c") : null;
        return new QueryTarget(env, connection, database ?? nodeDatabase, container);
    }

    /// <summary>
    /// What a query tab opened on a node runs against and is called, so the UI never parses node ids: the connection's
    /// node id, the node's own database and container segments, and the nearest of their names.
    /// </summary>
    public QueryScope ScopeOf(string nodeId)
    {
        var target = ResolveTarget(nodeId);
        var path = NodePath.Parse(nodeId);
        var segment = (string type) => path.Segments.Skip(2).FirstOrDefault(s => s.Type == type).Value;
        var (database, container) = (segment("db"), segment("c"));
        return new QueryScope(NodePath.Root.Child("env", target.Environment.Id).Child("conn", target.Connection.Id).Id,
            database, container, container ?? database ?? target.Connection.Name, target.Connection.Name);
    }

    /// <summary>
    /// Runs a node action the sidecar performs (node.invoke). Environments and connections have none; below a
    /// connection the backend answers.
    /// </summary>
    public async Task<string?> InvokeAsync(string nodeId, string actionId, CancellationToken cancellationToken)
    {
        var path = NodePath.Parse(nodeId);
        if (path.Count == 1 && path[0].Type == "env") return Nodes.InvokeDefault(actionId);
        var target = ResolveTarget(nodeId);
        if (path.Count == 2) return Nodes.InvokeDefault(actionId);
        return await BackendFor(target.Connection).InvokeAsync(target.Connection, store.GetSecret(target.Connection.Id), path, 2, actionId, cancellationToken);
    }

    /// <summary>Menu labels for every action id a node can carry: the shared ones, then any a backend adds.</summary>
    public Dictionary<string, string> ActionLabels()
    {
        var labels = new Dictionary<string, string>(Nodes.ActionLabels);
        foreach (var backend in backends.Values.Distinct())
            foreach (var (id, label) in backend.ActionLabels) labels.TryAdd(id, label);
        return labels;
    }

    /// <summary>The connection's backend as a query backend, or a clean refusal: "&lt;kind&gt; connections &lt;refusal&gt;."</summary>
    public IQueryBackend QueryBackendFor(ConnectionConfig connection, string refusal) =>
        BackendFor(connection) as IQueryBackend ?? throw new RpcException(RpcException.InvalidParams, $"{connection.Kind} connections {refusal}.");

    public IBackend BackendFor(ConnectionConfig connection) =>
        backends.TryGetValue(connection.Kind, out var backend)
            ? backend
            : throw new RpcException(RpcException.InvalidParams, $"Unknown connection kind: {connection.Kind}");

    public void Forget(string connectionId)
    {
        foreach (var backend in backends.Values) backend.Forget(connectionId);
    }

    private static TreeNode EnvironmentNode(EnvironmentConfig env) => new(
        NodePath.Root.Child("env", env.Id).Id,
        "environment",
        env.Name,
        "environment",
        env.Connections.Count > 0,
        Nodes.Browse,
        new()
        {
            ["color"] = env.Color,
            ["readOnly"] = env.ReadOnly ? "true" : "false",
            ["environmentId"] = env.Id,
            // Shown on the group header before the group is expanded.
            ["connectionCount"] = env.Connections.Count.ToString(System.Globalization.CultureInfo.InvariantCulture),
        });

    private static TreeNode WithoutQueryActions(TreeNode node) =>
        node.Actions.Any(Nodes.QueryActions.Contains) ? node with { Actions = node.Actions.Except(Nodes.QueryActions).ToArray() } : node;

    private static TreeNode ConnectionNode(NodePath envPath, ConnectionConfig c, bool queryable) => new(
        envPath.Child("conn", c.Id).Id,
        "connection",
        c.Name,
        c.Kind,
        true,
        queryable ? Nodes.Queryable : Nodes.Browse,
        new() { ["connectionKind"] = c.Kind, ["endpoint"] = c.Endpoint, ["connectionId"] = c.Id, ["copyText"] = c.Name });
}
