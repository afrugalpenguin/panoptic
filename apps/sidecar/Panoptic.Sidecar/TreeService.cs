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
            return env.Connections.Select(c => ConnectionNode(path, c)).ToArray();

        if (path[1].Type != "conn") throw new RpcException(RpcException.InvalidParams, $"Unknown node: {nodeId}");
        var connection = env.Connections.FirstOrDefault(c => c.Id == path[1].Value)
            ?? throw new RpcException(RpcException.OperationFailed, "Connection no longer exists");

        return await BackendFor(connection).ChildrenAsync(connection, store.GetSecret(connection.Id), path, 2, cancellationToken);
    }

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
        new() { ["color"] = env.Color, ["readOnly"] = env.ReadOnly ? "true" : "false", ["environmentId"] = env.Id });

    private static TreeNode ConnectionNode(NodePath envPath, ConnectionConfig c) => new(
        envPath.Child("conn", c.Id).Id,
        "connection",
        c.Name,
        c.Kind,
        true,
        Nodes.Browse,
        new() { ["connectionKind"] = c.Kind, ["endpoint"] = c.Endpoint, ["connectionId"] = c.Id });
}
