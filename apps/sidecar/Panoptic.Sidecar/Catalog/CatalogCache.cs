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

    public static string KeyOf(string connectionId, string? database) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"{connectionId}|{database}")))[..32];

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

    private string PathOf(string key) => Path.Combine(folder, key + ".bin");
}
