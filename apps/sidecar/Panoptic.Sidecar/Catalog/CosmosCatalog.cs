using System.Text.Json;
using Microsoft.Azure.Cosmos;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Catalog;

/// <summary>
/// A Cosmos database's catalog: its containers with partition keys, and the property paths seen in a sample of
/// each container's documents. Keywords and system functions live in the UI's language definition.
/// </summary>
public static class CosmosCatalog
{
    private static readonly HashSet<string> SystemProperties = ["_rid", "_self", "_etag", "_attachments", "_ts"];

    public static async Task<DatabaseCatalog> BuildAsync(CosmosClient client, string database, int sampleDocs, CancellationToken ct)
    {
        var db = client.GetDatabase(database);
        var containers = await CosmosBackend.ReadAll(db.GetContainerQueryStreamIterator(), "DocumentCollections", ct);
        var refs = new ContainerRef[containers.Count];
        await Parallel.ForEachAsync(Enumerable.Range(0, containers.Count), new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = ct },
            async (i, token) =>
            {
                var id = containers[i].GetProperty("id").GetString()!;
                var query = new QueryDefinition("SELECT TOP @n * FROM c").WithParameter("@n", sampleDocs);
                var docs = await CosmosBackend.ReadAll(
                    db.GetContainer(id).GetItemQueryStreamIterator(query, requestOptions: new QueryRequestOptions { MaxItemCount = sampleDocs }),
                    "Documents", token, limit: sampleDocs);
                refs[i] = new ContainerRef(id, string.Join(", ", CosmosBackend.PartitionKeyPaths(containers[i])), FlattenPaths(docs));
            });

        return new DatabaseCatalog(DateTime.UtcNow.ToString("O"), [], [], [],
            refs.OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase).ToArray());
    }

    /// <summary>Pure: every property path in the documents, dotted, array elements as [], with the JSON types seen at each.</summary>
    public static PathRef[] FlattenPaths(IEnumerable<JsonElement> docs)
    {
        var seen = new Dictionary<string, SortedSet<string>>(StringComparer.Ordinal);
        foreach (var doc in docs)
        {
            if (doc.ValueKind != JsonValueKind.Object) continue;
            foreach (var prop in doc.EnumerateObject())
                if (!SystemProperties.Contains(prop.Name)) Walk(prop.Name, prop.Value, seen);
        }
        return seen.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => new PathRef(p.Key, p.Value.ToArray())).ToArray();
    }

    private static void Walk(string path, JsonElement value, Dictionary<string, SortedSet<string>> seen)
    {
        if (!seen.TryGetValue(path, out var types)) seen[path] = types = new SortedSet<string>(StringComparer.Ordinal);
        types.Add(value.ValueKind switch
        {
            JsonValueKind.Object => "object",
            JsonValueKind.Array => "array",
            JsonValueKind.String => "string",
            JsonValueKind.Number => "number",
            JsonValueKind.True or JsonValueKind.False => "boolean",
            _ => "null",
        });
        if (value.ValueKind == JsonValueKind.Object)
            foreach (var prop in value.EnumerateObject()) Walk($"{path}.{prop.Name}", prop.Value, seen);
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) Walk($"{path}[]", item, seen);
    }
}
