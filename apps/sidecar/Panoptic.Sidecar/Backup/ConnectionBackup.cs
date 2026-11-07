using System.Text.Json;
using System.Text.Json.Serialization;

namespace Panoptic.Sidecar.Backup;

/// <summary>
/// A file of saved connections for a backup or another machine (#28, ADR 0008): environments with their colours and
/// read-only flags, and connections in them or in none. Never secrets or ids: passwords and keys are entered again,
/// and imported connections get ids of their own.
/// </summary>
public sealed record BackupFile(string Format, int Version, string? ExportedAt, List<BackupEnvironment> Environments, List<BackupConnection> Connections);

public sealed record BackupEnvironment(string Name, string Color, bool ReadOnly, List<BackupConnection> Connections);

/// <summary>A connection's settings as <see cref="ConnectionConfig"/> holds them, less its id.</summary>
public sealed record BackupConnection(
    string Name,
    string Kind,
    string Endpoint,
    string Auth,
    string? User = null,
    string? Database = null,
    string? TenantId = null,
    bool TrustServerCertificate = false,
    string? ClientId = null,
    string? CertificateHostName = null,
    string? CertificateFile = null);

public sealed record BackupPathParams(string Path);

/// <param name="Connections">Indexes into the preview's connections (<see cref="BackupPreviewConnection.Index"/>) to import.</param>
public sealed record BackupImportParams(string Path, List<int> Connections);

public sealed record BackupExportResult(int Environments, int Connections);

public sealed record BackupPreview(List<BackupPreviewEnvironment> Environments, List<BackupPreviewConnection> Connections);

/// <param name="Exists">An environment of the same name is already here: its connections join it.</param>
public sealed record BackupPreviewEnvironment(string Name, string Color, bool ReadOnly, bool Exists);

/// <param name="Index">The connection's place in the file: its environments' connections in order, then those in none.</param>
/// <param name="Environment">The environment's name in the file; null for a connection in none.</param>
/// <param name="Skip">Why it cannot be imported (already added, or a kind or sign-in this version lacks); null when it can.</param>
public sealed record BackupPreviewConnection(int Index, string Name, string Kind, string Endpoint, string Auth, string? User, string? Database, string? Environment, string? Skip);

public sealed record BackupImportResult(int EnvironmentsCreated, int ConnectionsAdded, int Skipped);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull, WriteIndented = true)]
[JsonSerializable(typeof(BackupFile))]
internal sealed partial class BackupJson : JsonSerializerContext;

public static class ConnectionBackup
{
    public const string Format = "panoptic.connections";
    public const int Version = 1;

    /// <summary>Writes the store's environments and connections to <paramref name="path"/>, replacing any file there.</summary>
    public static BackupExportResult Export(ConfigStore store, string path)
    {
        RequireFullPath(path);
        var config = store.Config;
        var file = new BackupFile(
            Format,
            Version,
            DateTimeOffset.UtcNow.ToString("o"),
            config.Environments.Select(e => new BackupEnvironment(e.Name, e.Color, e.ReadOnly, e.Connections.Select(ToBackup).ToList())).ToList(),
            config.Connections.Select(ToBackup).ToList());
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(file, BackupJson.Default.BackupFile));
        File.Move(temp, path, overwrite: true);
        return new BackupExportResult(file.Environments.Count, file.Environments.Sum(e => e.Connections.Count) + file.Connections.Count);
    }

    public static BackupFile Read(string path)
    {
        RequireFullPath(path);
        if (!File.Exists(path)) throw Bad($"{path} does not exist.");
        BackupFile? file;
        try
        {
            file = JsonSerializer.Deserialize(File.ReadAllText(path), BackupJson.Default.BackupFile);
        }
        catch (JsonException)
        {
            file = null;
        }
        if (file is null || file.Format != Format) throw Bad($"{Path.GetFileName(path)} is not a Panoptic connections backup.");
        if (file.Version > Version) throw Bad($"{Path.GetFileName(path)} was written by a newer version of Panoptic. Update Panoptic to import it.");
        return file with { Environments = file.Environments ?? [], Connections = file.Connections ?? [] };
    }

    /// <summary>What importing <paramref name="file"/> into <paramref name="store"/> would do, connection by connection.</summary>
    public static BackupPreview Preview(ConfigStore store, TreeService tree, BackupFile file)
    {
        var existingEnvs = store.Config.Environments.Select(e => e.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var connections = Flatten(file)
            .Select((entry, i) => new BackupPreviewConnection(i, entry.Connection.Name, entry.Connection.Kind, entry.Connection.Endpoint, entry.Connection.Auth,
                entry.Connection.User, entry.Connection.Database, entry.Environment?.Name, SkipReason(store, tree, entry.Connection)))
            .ToList();
        return new BackupPreview(
            file.Environments.Select(e => new BackupPreviewEnvironment(e.Name, e.Color, e.ReadOnly, existingEnvs.Contains(e.Name))).ToList(),
            connections);
    }

    /// <summary>
    /// Adds the chosen connections, each with a new id and no secret. An environment joins the one of the same name
    /// here, keeping that one's colour and read-only flag; any the file has that are not here are created, empty ones
    /// included, so the file's structure comes across. Anything that cannot be imported is skipped, not an error.
    /// </summary>
    public static BackupImportResult Import(ConfigStore store, TreeService tree, BackupFile file, IReadOnlyCollection<int> chosen)
    {
        var created = 0;
        var envIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var env in store.Config.Environments) envIds.TryAdd(env.Name, env.Id);
        foreach (var env in file.Environments)
        {
            if (envIds.ContainsKey(env.Name)) continue;
            var id = Guid.NewGuid().ToString();
            store.SaveEnvironment(new EnvironmentConfig(id, env.Name, env.Color, env.ReadOnly, []));
            envIds[env.Name] = id;
            created++;
        }

        int added = 0, skipped = 0;
        var entries = Flatten(file).ToList();
        foreach (var i in chosen.Distinct().Order())
        {
            if (i < 0 || i >= entries.Count) continue;
            var (environment, connection) = entries[i];
            if (SkipReason(store, tree, connection) is not null)
            {
                skipped++;
                continue;
            }
            store.SaveConnection(environment is null ? null : envIds[environment.Name], ToConfig(connection, Guid.NewGuid().ToString()), null);
            added++;
        }
        return new BackupImportResult(created, added, skipped);
    }

    private static IEnumerable<(BackupEnvironment? Environment, BackupConnection Connection)> Flatten(BackupFile file) =>
        file.Environments.SelectMany(e => (e.Connections ?? []).Select(c => ((BackupEnvironment?)e, c)))
            .Concat(file.Connections.Select(c => ((BackupEnvironment?)null, c)));

    /// <summary>Null when the connection can be imported here.</summary>
    private static string? SkipReason(ConfigStore store, TreeService tree, BackupConnection c)
    {
        KindDescription kind;
        try
        {
            kind = tree.BackendFor(ToConfig(c, "")).Describe(c.Kind);
        }
        catch (RpcException)
        {
            return $"This version of Panoptic has no {c.Kind} connections.";
        }
        if (kind.Auths.All(a => a.Id != c.Auth)) return $"{kind.Badge.Name} connections here do not offer this sign-in ({c.Auth}).";
        var existing = store.FindDuplicate(ToConfig(c, ""));
        return existing is null ? null : $"Already added as \"{existing.Name}\".";
    }

    private static BackupConnection ToBackup(ConnectionConfig c) => new(c.Name, c.Kind, c.Endpoint, c.Auth, c.User, c.Database, c.TenantId,
        c.TrustServerCertificate, c.ClientId, c.CertificateHostName, c.CertificateFile);

    private static ConnectionConfig ToConfig(BackupConnection c, string id) => new(id, c.Name, c.Kind, c.Endpoint, c.Auth, c.User, c.Database, c.TenantId,
        c.TrustServerCertificate, c.ClientId, c.CertificateHostName, c.CertificateFile);

    private static void RequireFullPath(string path)
    {
        if (!Path.IsPathFullyQualified(path)) throw Bad($"The backup file must be a full path, not {path}.");
    }

    private static RpcException Bad(string message) => new(RpcException.InvalidParams, message);
}
