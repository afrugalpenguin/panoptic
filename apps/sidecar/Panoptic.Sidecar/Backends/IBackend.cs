namespace Panoptic.Sidecar.Backends;

/// <summary>
/// One data source kind (SQL Server, Cosmos). Everything backend-specific lives behind this.
/// </summary>
public interface IBackend
{
    /// <param name="path">Full node path; segments from <paramref name="start"/> belong to this backend.</param>
    Task<TreeNode[]> ChildrenAsync(ConnectionConfig connection, string? secret, NodePath path, int start, CancellationToken cancellationToken);

    /// <summary>Connects and runs the cheapest possible call. Throws on failure.</summary>
    Task TestAsync(ConnectionConfig connection, string? secret, CancellationToken cancellationToken);

    /// <summary>Drops any cached client for a connection whose settings changed or was removed.</summary>
    void Forget(string connectionId);
}

public static class Nodes
{
    public static readonly string[] Browse = ["refresh", "copyName"];
    public static readonly string[] LeafActions = ["copyName"];

    public static TreeNode Folder(NodePath parent, string folder, string label) =>
        new(parent.Child("f", folder).Id, "folder", label, "folder", true, Browse);

    public static TreeNode Branch(NodePath id, string kind, string label, string icon, Dictionary<string, string>? meta = null) =>
        new(id.Id, kind, label, icon, true, Browse, meta);

    public static TreeNode Leaf(NodePath id, string kind, string label, string icon, Dictionary<string, string>? meta = null) =>
        new(id.Id, kind, label, icon, false, LeafActions, meta);

    /// <summary>Joins the backend-relative segment types into a key, e.g. "db/f:tables/o".</summary>
    public static string Shape(IReadOnlyList<NodePath.Segment> segments) =>
        string.Join('/', segments.Select(s => s.Type == "f" ? $"f:{s.Value}" : s.Type));
}
