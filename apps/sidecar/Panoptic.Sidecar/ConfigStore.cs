using System.Security.Cryptography;
using System.Text.Json;

namespace Panoptic.Sidecar;

/// <summary>
/// Environments, connections (in an environment or in none) and their secrets, persisted as one DPAPI-encrypted file (current
/// user scope). Secrets never leave the sidecar: <see cref="Config"/> carries none.
/// </summary>
public sealed class ConfigStore
{
    private static readonly byte[] Entropy = "panoptic.store.v1"u8.ToArray();

    private readonly string _path;
    private readonly Lock _lock = new();
    private StoreFile _file;

    public ConfigStore(string path)
    {
        _path = path;
        (_file, RecoveredFrom) = Load(path);
        // A delete whose undo window was still open when Panoptic closed leaves its secrets behind; they go now.
        var orphans = Orphans(_file.Secrets.Keys);
        if (orphans.Count > 0) Commit(_file with { Secrets = Without(_file.Secrets, orphans) });
    }

    /// <summary>
    /// Where an unreadable store was moved aside at start-up, or null. The store then starts empty;
    /// ping reports this so the UI can say so.
    /// </summary>
    public string? RecoveredFrom { get; }

    public static string DefaultPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Panoptic", "store.bin");

    public AppConfig Config
    {
        get { lock (_lock) return _file.Config; }
    }

    public AppSettings Settings
    {
        get { lock (_lock) return _file.Settings ?? AppSettings.Default; }
    }

    public void SaveSettings(AppSettings settings)
    {
        if (!UpdateCheckModes.All.Contains(settings.UpdateCheck))
            throw new RpcException(RpcException.InvalidParams, $"Unknown update check mode: {settings.UpdateCheck}");
        if (settings.Explorer.RowFont is not (RowFonts.Mono or RowFonts.Ui))
            throw new RpcException(RpcException.InvalidParams, $"Unknown row font: {settings.Explorer.RowFont}");
        if (settings.LastSeenVersion is not null && !System.Text.RegularExpressions.Regex.IsMatch(settings.LastSeenVersion, @"^\d+\.\d+\.\d+$"))
            throw new RpcException(RpcException.InvalidParams, $"Invalid last seen version: {settings.LastSeenVersion}");
        if (settings.Editor.KeywordCase is not (null or KeywordCases.Lower or KeywordCases.Upper or KeywordCases.Preserve))
            throw new RpcException(RpcException.InvalidParams, $"Unknown keyword case: {settings.Editor.KeywordCase}");
        if (settings.Editor.CatalogSampleDocs is < 10 or > 500)
            throw new RpcException(RpcException.InvalidParams, "Cosmos sample size must be between 10 and 500 documents");
        lock (_lock) Commit(_file with { Settings = settings });
    }

    /// <summary>A connection and its environment, which is null for a connection in no environment.</summary>
    public (EnvironmentConfig? Environment, ConnectionConfig Connection)? FindConnection(string connectionId)
    {
        lock (_lock)
        {
            foreach (var env in _file.Config.Environments)
                foreach (var conn in env.Connections)
                    if (conn.Id == connectionId) return (env, conn);
            foreach (var conn in _file.Config.Connections)
                if (conn.Id == connectionId) return (null, conn);
            return null;
        }
    }

    public EnvironmentConfig? FindEnvironment(string environmentId)
    {
        lock (_lock) return _file.Config.Environments.FirstOrDefault(e => e.Id == environmentId);
    }

    public string? GetSecret(string connectionId)
    {
        lock (_lock) return _file.Secrets.GetValueOrDefault(connectionId);
    }

    /// <summary>
    /// The stored secret for an edited, unsaved <paramref name="connection"/>, but only while it still points where the
    /// secret was saved for (<see cref="SameSecretTarget"/>). Otherwise null: a stored password must never follow an
    /// edit to another host, user or sign-in.
    /// </summary>
    public string? GetSecretFor(ConnectionConfig connection)
    {
        lock (_lock)
        {
            var stored = FindConnection(connection.Id)?.Connection;
            return stored is not null && SameSecretTarget(stored, connection) ? _file.Secrets.GetValueOrDefault(connection.Id) : null;
        }
    }

    /// <summary>
    /// Whether a secret saved for <paramref name="a"/> may be used for <paramref name="b"/>: same kind, endpoint, auth,
    /// user and certificate trust. Name, database and environment don't matter.
    /// </summary>
    private static bool SameSecretTarget(ConnectionConfig a, ConnectionConfig b) =>
        a.Kind == b.Kind
        && string.Equals(a.Endpoint, b.Endpoint, StringComparison.OrdinalIgnoreCase)
        && a.Auth == b.Auth
        && a.User == b.User
        && a.TrustServerCertificate == b.TrustServerCertificate;

    /// <summary>Adds or replaces an environment, keeping its existing connections.</summary>
    public void SaveEnvironment(EnvironmentConfig environment)
    {
        lock (_lock)
        {
            var envs = _file.Config.Environments.ToList();
            var i = envs.FindIndex(e => e.Id == environment.Id);
            if (i >= 0) envs[i] = environment with { Connections = envs[i].Connections };
            else envs.Add(environment with { Connections = [] });
            Commit(_file with { Config = _file.Config with { Environments = envs } });
        }
    }

    /// <summary>
    /// Removes an environment and its connections. Their secrets stay until <see cref="PurgeSecrets"/> (or the next
    /// start) so the delete can be undone with <see cref="Restore"/>.
    /// </summary>
    public void DeleteEnvironment(string environmentId)
    {
        lock (_lock)
        {
            if (_file.Config.Environments.All(e => e.Id != environmentId)) return;
            Commit(_file with { Config = _file.Config with { Environments = _file.Config.Environments.Where(e => e.Id != environmentId).ToList() } });
        }
    }

    /// <summary>
    /// Adds or replaces a connection, in an environment or (null) in none. Saving it somewhere else moves it. A null
    /// secret keeps the stored one, unless the edit changed where it would be sent (see <see cref="GetSecretFor"/>):
    /// then the stored one is dropped. Empty clears it.
    /// </summary>
    public void SaveConnection(string? environmentId, ConnectionConfig connection, string? secret)
    {
        lock (_lock)
        {
            var previous = FindConnection(connection.Id)?.Connection;
            if (secret is null && previous is not null && !SameSecretTarget(previous, connection)) secret = "";
            var envs = _file.Config.Environments.ToList();
            var envIndex = environmentId is null ? -1 : envs.FindIndex(e => e.Id == environmentId);
            if (environmentId is not null && envIndex < 0) throw new RpcException(RpcException.InvalidParams, $"Unknown environment: {environmentId}");

            // Edit in place within the same list; otherwise remove it elsewhere and append here.
            var target = envIndex >= 0 ? envs[envIndex].Connections : _file.Config.Connections;
            var position = target.FindIndex(c => c.Id == connection.Id);
            for (var i = 0; i < envs.Count; i++)
                envs[i] = envs[i] with { Connections = envs[i].Connections.Where(c => c.Id != connection.Id).ToList() };
            var loose = _file.Config.Connections.Where(c => c.Id != connection.Id).ToList();
            var list = envIndex >= 0 ? envs[envIndex].Connections : loose;
            if (position >= 0) list.Insert(position, connection);
            else list.Add(connection);

            var secrets = new Dictionary<string, string>(_file.Secrets);
            if (secret is not null)
            {
                if (secret.Length == 0) secrets.Remove(connection.Id);
                else secrets[connection.Id] = secret;
            }
            Commit(_file with { Config = new AppConfig(envs, loose), Secrets = secrets });
        }
    }

    /// <summary>Removes a connection. Its secret stays until <see cref="PurgeSecrets"/> (or the next start), as for an environment.</summary>
    public void DeleteConnection(string connectionId)
    {
        lock (_lock)
        {
            var envs = _file.Config.Environments
                .Select(e => e with { Connections = e.Connections.Where(c => c.Id != connectionId).ToList() })
                .ToList();
            var loose = _file.Config.Connections.Where(c => c.Id != connectionId).ToList();
            Commit(_file with { Config = new AppConfig(envs, loose) });
        }
    }

    /// <summary>Undoes a delete: writes back the config from before it. Secrets are untouched, so the deleted ones return.</summary>
    public void Restore(AppConfig config)
    {
        lock (_lock) Commit(_file with { Config = config });
    }

    /// <summary>Drops the secrets of deleted connections once their delete stands. A connection still in the config keeps its secret.</summary>
    public void PurgeSecrets(IEnumerable<string> connectionIds)
    {
        lock (_lock)
        {
            var orphans = Orphans(connectionIds);
            if (orphans.Count > 0) Commit(_file with { Secrets = Without(_file.Secrets, orphans) });
        }
    }

    private HashSet<string> Orphans(IEnumerable<string> connectionIds)
    {
        var live = _file.Config.Environments.SelectMany(e => e.Connections).Concat(_file.Config.Connections).Select(c => c.Id).ToHashSet();
        return connectionIds.Where(id => !live.Contains(id) && _file.Secrets.ContainsKey(id)).ToHashSet();
    }

    private static Dictionary<string, string> Without(Dictionary<string, string> secrets, HashSet<string> ids) =>
        secrets.Where(kv => !ids.Contains(kv.Key)).ToDictionary();

    private void Commit(StoreFile file)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(file, SidecarJson.Default.StoreFile);
        var encrypted = ProtectedData.Protect(json, Entropy, DataProtectionScope.CurrentUser);
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temp = _path + ".tmp";
        File.WriteAllBytes(temp, encrypted);
        File.Move(temp, _path, overwrite: true);
        _file = file;
    }

    /// <summary>
    /// A file that cannot be decrypted (another Windows profile, a truncated write) or does not deserialise to a
    /// usable store is renamed aside, never deleted or overwritten, and the store starts empty. Read errors such as
    /// a locked file are not corruption and still throw: moving a good store aside would lose it.
    /// </summary>
    private static (StoreFile File, string? RecoveredFrom) Load(string path)
    {
        var empty = new StoreFile(AppConfig.Empty, []);
        if (!File.Exists(path)) return (empty, null);
        var bytes = File.ReadAllBytes(path);
        try
        {
            var json = ProtectedData.Unprotect(bytes, Entropy, DataProtectionScope.CurrentUser);
            var file = JsonSerializer.Deserialize(json, SidecarJson.Default.StoreFile);
            // Missing required members deserialise as null rather than failing.
            if (file is { Config.Environments: not null, Secrets: not null }) return (file, null);
        }
        catch (Exception ex) when (ex is CryptographicException or JsonException or NotSupportedException) { }

        // No overwrite: if the name is somehow taken, fail rather than lose either copy.
        var aside = $"{path}.corrupt-{DateTime.UtcNow:yyyyMMdd-HHmmss-fff}";
        File.Move(path, aside, overwrite: false);
        Console.Error.WriteLine($"Store could not be read; moved aside to {aside} and started empty.");
        return (empty, aside);
    }
}
