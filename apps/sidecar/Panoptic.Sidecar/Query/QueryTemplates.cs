namespace Panoptic.Sidecar.Query;

/// <summary>Generated query text for tree actions such as "Select top 1000".</summary>
public static class QueryTemplates
{
    /// <summary>Null when the node is not a table, view or container.</summary>
    public static string? SelectTop(string connectionKind, NodePath path)
    {
        var last = path.Count > 0 ? path[path.Count - 1] : default;
        if (connectionKind == ConnectionKinds.Cosmos)
            return last.Type == "c" ? "SELECT TOP 1000 * FROM c" : null;

        if (last.Type != "o") return null;
        var parts = NodePath.SplitParts(last.Value);
        return $"SELECT TOP (1000) *\nFROM {Quote(parts[0])}.{Quote(parts[1])};";
    }

    public static string Quote(string identifier) => $"[{identifier.Replace("]", "]]")}]";
}
