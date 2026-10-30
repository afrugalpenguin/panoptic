using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Query;

/// <summary>
/// Generated query text for tree actions such as "Select top 1000". Kept for existing callers: the text now comes from
/// each backend's <see cref="IBackend.TemplateFor"/>, which query.template calls directly.
/// </summary>
public static class QueryTemplates
{
    /// <summary>Null when the node is not a table, view or container.</summary>
    public static string? SelectTop(string connectionKind, NodePath path) =>
        BackendRegistry.Create(new Credentials(_ => { })).TryGetValue(connectionKind, out var backend)
            ? backend.TemplateFor(path, "selectTop")
            : throw new RpcException(RpcException.InvalidParams, $"Unknown connection kind: {connectionKind}");

    public static string Quote(string identifier) => SqlBackend.QuoteIdentifier(identifier);
}
