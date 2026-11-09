using System.Globalization;

namespace Panoptic.Sidecar.Backends;

/// <summary>The connection pane's About rows and database states for the SQL family, from what the describe batch read.</summary>
public static class SqlServerFacts
{
    /// <summary>The first row of the describe batch; any value may be missing on a given engine edition.</summary>
    public sealed record Server(
        string? ProductVersion,
        string? ProductLevel,
        string? Edition,
        int? EngineEdition,
        string? Collation,
        string? ServiceObjective,
        DateTimeOffset? ServerTime);

    /// <summary>SERVERPROPERTY('EngineEdition') values that name a product of their own.</summary>
    private static readonly Dictionary<int, string> Products = new()
    {
        [5] = "Azure SQL Database",
        [6] = "Azure Synapse dedicated SQL pool",
        [8] = "Azure SQL Managed Instance",
        [9] = "Azure SQL Edge",
        [11] = "Azure Synapse serverless SQL pool",
    };

    /// <summary>On-premises SQL Server by major version.</summary>
    private static readonly Dictionary<int, string> Releases = new()
    {
        [11] = "2012", [12] = "2014", [13] = "2016", [14] = "2017", [15] = "2019", [16] = "2022", [17] = "2025",
    };

    public static string Product(int? engineEdition, string? productVersion)
    {
        if (engineEdition is { } e && Products.TryGetValue(e, out var product)) return product;
        var major = int.TryParse(productVersion?.Split('.')[0], NumberStyles.None, CultureInfo.InvariantCulture, out var m) ? m : 0;
        return Releases.TryGetValue(major, out var release) ? $"SQL Server {release}" : "SQL Server";
    }

    /// <summary>The About rows in order: Product, Version, Edition (or Pool for Synapse serverless), Collation, Server time.</summary>
    public static List<ServerFact> Facts(Server s)
    {
        var facts = new List<ServerFact> { new("Product", Product(s.EngineEdition, s.ProductVersion)) };
        if (!string.IsNullOrWhiteSpace(s.ProductVersion))
            facts.Add(new("Version", s.ProductVersion, string.IsNullOrWhiteSpace(s.ProductLevel) ? null : s.ProductLevel, Mono: true));
        if (s.EngineEdition == 11) facts.Add(new("Pool", "built-in serverless"));
        else if (!string.IsNullOrWhiteSpace(s.Edition))
            facts.Add(new("Edition", s.Edition, string.IsNullOrWhiteSpace(s.ServiceObjective) ? null : s.ServiceObjective));
        if (!string.IsNullOrWhiteSpace(s.Collation)) facts.Add(new("Collation", s.Collation, Mono: true));
        if (s.ServerTime is { } time)
            facts.Add(new("Server time", time.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture) + " UTC", "at connect", Mono: true));
        return facts;
    }

    /// <summary>States that need someone to act rather than wait.</summary>
    private static readonly HashSet<string> ErrorStates = new(StringComparer.OrdinalIgnoreCase) { "SUSPECT", "EMERGENCY", "RECOVERY_PENDING" };

    /// <summary>sys.databases state_desc as words: RECOVERY_PENDING reads "recovery pending".</summary>
    public static string StateWords(string stateDesc) => stateDesc.Replace('_', ' ').ToLowerInvariant();

    public static ServerDatabases Databases(IReadOnlyList<(string Name, string State)> databases)
    {
        var notOnline = databases
            .Where(d => !string.Equals(d.State, "ONLINE", StringComparison.OrdinalIgnoreCase))
            .Select(d => new DatabaseState(d.Name, StateWords(d.State), ErrorStates.Contains(d.State)))
            .ToList();
        return new ServerDatabases(databases.Count, databases.Count - notOnline.Count, notOnline);
    }
}
