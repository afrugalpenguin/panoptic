namespace Panoptic.Sidecar.Backends;

/// <summary>The connection pane's About rows for a Cosmos DB account, from its account read.</summary>
public static class CosmosFacts
{
    /// <summary>API, Account, Default consistency, Regions (write regions first, marked).</summary>
    public static List<ServerFact> Facts(string? accountId, string? consistency, IReadOnlyList<string> writable, IReadOnlyList<string> readable)
    {
        var facts = new List<ServerFact> { new("API", "NoSQL") };
        if (!string.IsNullOrWhiteSpace(accountId)) facts.Add(new("Account", accountId, Mono: true));
        if (!string.IsNullOrWhiteSpace(consistency)) facts.Add(new("Default consistency", consistency));
        var regions = writable.Select(r => $"{r} (write)")
            .Concat(readable.Where(r => !writable.Contains(r, StringComparer.OrdinalIgnoreCase)))
            .ToList();
        if (regions.Count > 0) facts.Add(new("Regions", string.Join(", ", regions)));
        return facts;
    }
}
