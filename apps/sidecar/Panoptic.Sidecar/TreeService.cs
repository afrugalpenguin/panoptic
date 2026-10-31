using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar;

/// <summary>
/// Serves the node contract: environments and connections (in an environment or in none) from the store, everything
/// below a connection from that connection's backend.
/// </summary>
public sealed class TreeService(ConfigStore store, IReadOnlyDictionary<string, IBackend> backends)
{
    public async Task<TreeNode[]> ChildrenAsync(string nodeId, CancellationToken cancellationToken)
    {
        var path = NodePath.Parse(nodeId);

        // Environments, then the connections in no environment.
        if (path.Count == 0)
            return [.. store.Config.Environments.Select(EnvironmentNode), .. store.Config.Connections.Select(ConnectionNode)];

        if (path[0].Type == "env")
        {
            if (path.Count != 1) throw new RpcException(RpcException.InvalidParams, $"Unknown node: {nodeId}");
            var env = store.FindEnvironment(path[0].Value) ?? throw new RpcException(RpcException.OperationFailed, "Environment no longer exists");
            return env.Connections.Select(ConnectionNode).ToArray();
        }

        var connection = ConnectionAt(path, nodeId);
        var backend = BackendFor(connection);
        try
        {
            var nodes = await backend.ChildrenAsync(connection, store.GetSecret(connection.Id), path, 1, cancellationToken);
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

    /// <summary>
    /// The connection a node id starts with. Connection ids carry no environment (<c>conn:id/...</c>), so moving a
    /// connection between environments, or out of one, never changes the ids of its nodes.
    /// </summary>
    private ConnectionConfig ConnectionAt(NodePath path, string nodeId)
    {
        if (path.Count == 0 || path[0].Type != "conn") throw new RpcException(RpcException.InvalidParams, $"Unknown node: {nodeId}");
        return store.FindConnection(path[0].Value)?.Connection ?? throw new RpcException(RpcException.OperationFailed, "Connection no longer exists");
    }

    /// <summary>The environment (null for a connection in none), connection and database (and Cosmos container) a node belongs to.</summary>
    /// <param name="database">Overrides the node's database (a query tab's database picker). It only ever reaches
    /// SqlConnectionStringBuilder.InitialCatalog or the Cosmos SDK, never SQL text, but is still bounded here.</param>
    public QueryTarget ResolveTarget(string nodeId, string? database = null)
    {
        if (database is not null && (database.Length is 0 or > 128 || database.Any(char.IsControl)))
            throw new RpcException(RpcException.InvalidParams, "Invalid database name");
        var path = NodePath.Parse(nodeId);
        if (path.Count == 0 || path[0].Type != "conn")
            throw new RpcException(RpcException.InvalidParams, "Select a connection, database or object to query.");
        var (env, connection) = store.FindConnection(path[0].Value) ?? throw new RpcException(RpcException.OperationFailed, "Connection no longer exists");
        var segment = (string type) => path.Segments.Skip(1).FirstOrDefault(s => s.Type == type).Value;
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
        var segment = (string type) => path.Segments.Skip(1).FirstOrDefault(s => s.Type == type).Value;
        var (database, container) = (segment("db"), segment("c"));
        return new QueryScope(NodePath.Root.Child("conn", target.Connection.Id).Id,
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
        if (path.Count == 1) return Nodes.InvokeDefault(actionId);
        return await BackendFor(target.Connection).InvokeAsync(target.Connection, store.GetSecret(target.Connection.Id), path, 1, actionId, cancellationToken);
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

    /// <summary>The backend for a connection about to be saved or tested, once its auth is one that kind supports.</summary>
    public IBackend Validate(ConnectionConfig connection)
    {
        var backend = BackendFor(connection);
        if (!backend.AuthsFor(connection.Kind).Contains(connection.Auth))
            throw new RpcException(RpcException.InvalidParams, $"{connection.Kind} connections do not support auth '{connection.Auth}'");
        ValidateCertificateOptions(connection);
        return backend;
    }

    /// <summary>
    /// The certificate host name and file (issue #261): only for SQL Server and Postgres, not alongside Trust server
    /// certificate (which skips the checks they configure), a DNS name, and an absolute path to a loadable certificate.
    /// </summary>
    private static void ValidateCertificateOptions(ConnectionConfig c)
    {
        var host = c.CertificateHostName?.Trim();
        var file = c.CertificateFile?.Trim();
        if (string.IsNullOrEmpty(host) && string.IsNullOrEmpty(file)) return;
        static RpcException Bad(string message) => new(RpcException.InvalidParams, message);
        if (c.Kind == ConnectionKinds.Cosmos)
            throw Bad("Cosmos connections don't take a certificate host name or file.");
        if (c.TrustServerCertificate)
            throw Bad("Turn off Trust server certificate to use a certificate host name or file: trusting skips the checks they set up.");
        if (!string.IsNullOrEmpty(host) && (host.Length > 253 || Uri.CheckHostName(host) != UriHostNameType.Dns))
            throw Bad($"The certificate host name '{host}' is not a valid host name.");
        if (!string.IsNullOrEmpty(file))
        {
            if (!Path.IsPathFullyQualified(file)) throw Bad("The certificate file must be a full path, such as C:\\certs\\fabrikam-ca.pem.");
            if (!File.Exists(file)) throw Bad($"The certificate file {file} does not exist.");
            try { using var _ = System.Security.Cryptography.X509Certificates.X509CertificateLoader.LoadCertificateFromFile(file); }
            catch (System.Security.Cryptography.CryptographicException) { throw Bad($"The certificate file {file} is not a certificate (PEM or DER)."); }
        }
    }

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

    private TreeNode ConnectionNode(ConnectionConfig c) => new(
        NodePath.Root.Child("conn", c.Id).Id,
        "connection",
        c.Name,
        c.Kind,
        true,
        backends.GetValueOrDefault(c.Kind) is IQueryBackend ? Nodes.Queryable : Nodes.Browse,
        Meta(c));

    private static Dictionary<string, string> Meta(ConnectionConfig c)
    {
        var meta = new Dictionary<string, string> { ["connectionKind"] = c.Kind, ["endpoint"] = c.Endpoint, ["connectionId"] = c.Id, ["copyText"] = c.Name };
        // The tree marks connections that skip certificate validation (issue #174), every session, not just in the dialog.
        if (c.TrustServerCertificate) meta["trustServerCertificate"] = "true";
        return meta;
    }
}
