using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Panoptic.Sidecar.Catalog;

/// <summary>
/// Catalogs on disk, one DPAPI-encrypted file (current user scope, like store.bin) per connection and database,
/// so a reopened tab has completions before its connection authenticates. File names are hashes: no server,
/// database or object name is stored in clear text.
/// </summary>
public sealed class CatalogCache(string folder)
{
    private static readonly byte[] Entropy = "panoptic.catalog.v1"u8.ToArray();

    public static string DefaultFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Panoptic", "catalog");

    /// <summary>
    /// "&lt;connection hash&gt;-&lt;connection and database hash&gt;": the prefix lets a deleted connection's snapshots
    /// be found and removed without knowing which databases it had.
    /// </summary>
    public static string KeyOf(string connectionId, string? database) =>
        $"{PrefixOf(connectionId)}-{Hash($"{connectionId}|{database}")[..32]}";

    private static string PrefixOf(string connectionId) => Hash(connectionId)[..16];
    private static string Hash(string s) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(s)));

    /// <summary>Null when there is no cached copy or it cannot be read; the caller rebuilds.</summary>
    public DatabaseCatalog? Read(string key)
    {
        try
        {
            var json = ProtectedData.Unprotect(File.ReadAllBytes(PathOf(key)), Entropy, DataProtectionScope.CurrentUser);
            return JsonSerializer.Deserialize(json, SidecarJson.Default.DatabaseCatalog);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or CryptographicException or JsonException)
        {
            return null;
        }
    }

    public void Write(string key, DatabaseCatalog catalog)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(catalog, SidecarJson.Default.DatabaseCatalog);
        Directory.CreateDirectory(folder);
        var path = PathOf(key);
        var temp = $"{path}.{Guid.NewGuid():N}.tmp";
        File.WriteAllBytes(temp, ProtectedData.Protect(json, Entropy, DataProtectionScope.CurrentUser));
        File.Move(temp, path, overwrite: true);
    }

    /// <summary>Deletes every snapshot of these connections (they were deleted and the delete stands).</summary>
    public void Remove(IEnumerable<string> connectionIds)
    {
        var gone = connectionIds.Select(PrefixOf).ToHashSet();
        DeleteWhere(name => gone.Contains(PrefixPart(name)));
    }

    /// <summary>
    /// At start-up: deletes snapshots of connections that are no longer saved, files in the old flat layout (no
    /// connection prefix) and temp files left by an interrupted write. It is a cache, so anything deleted is rebuilt.
    /// </summary>
    public void Prune(IEnumerable<string> liveConnectionIds)
    {
        var live = liveConnectionIds.Select(PrefixOf).ToHashSet();
        DeleteWhere(name => !name.EndsWith(".bin", StringComparison.Ordinal) || !live.Contains(PrefixPart(name)));
    }

    /// <summary>The connection prefix of a file name, or "" for the old layout.</summary>
    private static string PrefixPart(string fileName)
    {
        var dash = fileName.IndexOf('-');
        return dash == 16 ? fileName[..16] : "";
    }

    private void DeleteWhere(Func<string, bool> condemned)
    {
        if (!Directory.Exists(folder)) return;
        foreach (var path in Directory.EnumerateFiles(folder))
        {
            if (!condemned(Path.GetFileName(path))) continue;
            try { File.Delete(path); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* in use: next start */ }
        }
    }

    private string PathOf(string key) => Path.Combine(folder, key + ".bin");
}
