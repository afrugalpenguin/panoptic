namespace Panoptic.Sidecar.Backends;

/// <summary>The connection pane's About rows and database states for PostgreSQL, from what the describe batch read.</summary>
public static class PostgresFacts
{
    public sealed record Server(string? Version, string? ServerVersion, string? Encoding, string? Collation, string? ServerTimeUtc);

    /// <param name="ConnectionLimit">pg_database.datconnlimit: -2 marks a database left invalid by an interrupted DROP DATABASE.</param>
    public sealed record Database(string Name, bool AllowsConnections, int ConnectionLimit);

    /// <summary>"PostgreSQL 16.4 on x86_64-pc-linux-gnu, compiled by ..." reads "PostgreSQL 16.4".</summary>
    public static string Product(string? version)
    {
        if (string.IsNullOrWhiteSpace(version)) return "PostgreSQL";
        var on = version.IndexOf(" on ", StringComparison.Ordinal);
        var comma = version.IndexOf(',');
        var end = on >= 0 ? on : comma >= 0 ? comma : version.Length;
        return version[..end].Trim();
    }

    public static List<ServerFact> Facts(Server s)
    {
        var facts = new List<ServerFact> { new("Product", Product(s.Version)) };
        if (!string.IsNullOrWhiteSpace(s.ServerVersion)) facts.Add(new("Version", s.ServerVersion, Mono: true));
        if (!string.IsNullOrWhiteSpace(s.Encoding)) facts.Add(new("Encoding", s.Encoding, Mono: true));
        if (!string.IsNullOrWhiteSpace(s.Collation)) facts.Add(new("Collation", s.Collation, Mono: true));
        if (!string.IsNullOrWhiteSpace(s.ServerTimeUtc)) facts.Add(new("Server time", s.ServerTimeUtc + " UTC", "at connect", Mono: true));
        return facts;
    }

    public static ServerDatabases Databases(IReadOnlyList<Database> databases)
    {
        var notOnline = databases
            .Where(d => d.ConnectionLimit == -2 || !d.AllowsConnections)
            .Select(d => d.ConnectionLimit == -2
                ? new DatabaseState(d.Name, "invalid (a DROP DATABASE was interrupted)", Error: true)
                : new DatabaseState(d.Name, "not accepting connections"))
            .ToList();
        return new ServerDatabases(databases.Count, databases.Count - notOnline.Count, notOnline);
    }
}
