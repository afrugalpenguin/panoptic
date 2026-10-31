namespace Panoptic.Sidecar;

/// <summary>
/// Node ids are paths of <c>type:value</c> segments joined by '/', values percent-encoded,
/// e.g. <c>conn:b2/db:orders/f:tables/o:dbo%1FOrders</c>. The root is the empty path; its children are the
/// environments (<c>env:a1</c>) and the connections in no environment. A connection's id never includes its
/// environment, so moving a connection keeps every id below it.
/// Only the sidecar parses them; the UI treats ids as opaque.
/// </summary>
public sealed class NodePath
{
    public readonly record struct Segment(string Type, string Value);

    /// <summary>Separates the parts of a compound value such as schema and object name.</summary>
    public const char PartSeparator = '\u001f';

    private readonly Segment[] _segments;

    private NodePath(Segment[] segments) => _segments = segments;

    public static NodePath Root { get; } = new([]);

    public IReadOnlyList<Segment> Segments => _segments;

    public int Count => _segments.Length;

    public Segment this[int index] => _segments[index];

    public string Id => string.Join('/', _segments.Select(s => $"{s.Type}:{Uri.EscapeDataString(s.Value)}"));

    public NodePath Child(string type, string value) => new([.. _segments, new Segment(type, value)]);

    public NodePath Child(string type, params string[] parts) => Child(type, string.Join(PartSeparator, parts));

    /// <summary>Segments from <paramref name="start"/> onwards, e.g. the part below a connection.</summary>
    public IReadOnlyList<Segment> From(int start) => _segments[start..];

    public static NodePath Parse(string id)
    {
        if (string.IsNullOrEmpty(id)) return Root;
        var parts = id.Split('/');
        var segments = new Segment[parts.Length];
        for (var i = 0; i < parts.Length; i++)
        {
            var colon = parts[i].IndexOf(':');
            if (colon <= 0) throw new RpcException(RpcException.InvalidParams, $"Invalid node id: {id}");
            segments[i] = new Segment(parts[i][..colon], Uri.UnescapeDataString(parts[i][(colon + 1)..]));
        }
        return new NodePath(segments);
    }

    public static string[] SplitParts(string value) => value.Split(PartSeparator);

    public override string ToString() => Id;
}
