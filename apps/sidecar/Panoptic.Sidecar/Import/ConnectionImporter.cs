using System.Text.Json;
using System.Xml.Linq;

namespace Panoptic.Sidecar.Import;

/// <summary>A connection found in another tool, mapped to Panoptic's settings. Never carries a password.</summary>
public sealed record ImportCandidate(
    string Name,
    string Kind,
    string Endpoint,
    string Auth,
    string? User,
    string? Database,
    bool TrustServerCertificate,
    string? Note = null,
    bool AlreadyAdded = false);

public sealed record ImportGroup(string Name, List<ImportCandidate> Connections);

/// <param name="Error">Set when the file exists but could not be read; the UI shows it instead of failing the scan.</param>
public sealed record ImportSource(string Source, string Label, string Path, List<ImportGroup> Groups, string? Error = null);

/// <summary>
/// Reads connections from SSMS (connection history and Registered Servers), Azure Data Studio and
/// the VS Code mssql extension. Everything is read locally; nothing is written back to those tools.
/// Formats differ across versions, so parsers match on element and property names rather than
/// exact document structure, and a file that can't be parsed is reported, not fatal.
/// </summary>
public static class ConnectionImporter
{
    private const string NoGroup = "(No group)";
    private const string PasswordNote = "SQL login: enter the password after importing";

    /// <summary>
    /// Looks in the standard locations under the given AppData roots. Every file found is reported,
    /// including ones that yielded no connections, so the UI can show exactly what was checked.
    /// </summary>
    public static List<ImportSource> Scan(string roamingAppData, string localAppData)
    {
        var sources = new List<ImportSource>();

        void Try(string source, string label, string path, Func<string, ImportSource?> parse)
        {
            if (!File.Exists(path)) return;
            try
            {
                sources.Add(parse(path) ?? new ImportSource(source, label, path, []));
            }
            catch (Exception ex)
            {
                sources.Add(new ImportSource(source, label, path, [], $"Could not read this file: {ex.Message}"));
            }
        }

        var ssmsRoots = new[]
        {
            Path.Combine(roamingAppData, "Microsoft", "SQL Server Management Studio"),
            Path.Combine(roamingAppData, "Microsoft", "SSMS"),
            Path.Combine(localAppData, "Microsoft", "SQL Server Management Studio"),
            Path.Combine(localAppData, "Microsoft", "SSMS"),
        };

        foreach (var root in ssmsRoots.Where(Directory.Exists))
        {
            // RegSrvr.xml, RegSrvr16.xml, RegSrvr17.xml...: SSMS 21+ keeps its saved connections here.
            foreach (var regsrvr in TopLevelFiles(root, "RegSrvr*.xml").OrderByDescending(File.GetLastWriteTimeUtc))
                Try("ssms-registered", $"SSMS saved connections ({Path.GetFileName(regsrvr)})", regsrvr, ParseRegisteredServers);
            // Newest version first, so its history wins when the same server appears in several.
            foreach (var settings in FindFiles(root, "UserSettings.xml").OrderByDescending(File.GetLastWriteTimeUtc))
                Try("ssms-recent", $"SSMS connection history ({VersionFolder(root, settings)})", settings, ParseSsmsUserSettings);
        }

        Try("ads", "Azure Data Studio", Path.Combine(roamingAppData, "azuredatastudio", "User", "settings.json"), ParseAzureDataStudio);
        Try("vscode", "VS Code (mssql extension)", Path.Combine(roamingAppData, "Code", "User", "settings.json"), ParseVsCode);
        return sources;
    }

    /// <summary>
    /// Loads another tool's XML settings file. They never carry a DTD, so one is refused outright (XmlException) rather
    /// than expanded up to .NET's entity cap; no resolver, so nothing is ever fetched.
    /// </summary>
    private static XDocument LoadXml(string path)
    {
        using var reader = System.Xml.XmlReader.Create(path, new System.Xml.XmlReaderSettings { DtdProcessing = System.Xml.DtdProcessing.Prohibit, XmlResolver = null });
        return XDocument.Load(reader);
    }

    // --- SSMS Registered Servers (RegSrvr.xml) --------------------------------------------------

    private const string EngineGroupUri = "/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup";

    public static ImportSource? ParseRegisteredServers(string path)
    {
        var doc = LoadXml(path);
        var groups = new Dictionary<string, List<ImportCandidate>>();

        foreach (var server in doc.Descendants().Where(e => e.Name.LocalName == "RegisteredServer"))
        {
            if (Child(server, "ServerType") is { } type && type != "DatabaseEngine") continue;
            var serverName = Child(server, "ServerName");
            if (string.IsNullOrWhiteSpace(serverName)) continue;

            // The group comes from the Parent reference, or failing that from the document's alias
            // (".../ServerGroup/UAT/RegisteredServer/x"). Servers under another server type's tree are skipped.
            var location = server.Descendants().FirstOrDefault(e => e.Name.LocalName == "Uri")?.Value ?? GroupPathFromAlias(server);
            if (location is not null && location.StartsWith("/RegisteredServersStore/ServerGroup/", StringComparison.OrdinalIgnoreCase)
                && !location.StartsWith(EngineGroupUri, StringComparison.OrdinalIgnoreCase)) continue;
            var group = location is not null && location.StartsWith(EngineGroupUri, StringComparison.OrdinalIgnoreCase)
                ? GroupFromUri(location[EngineGroupUri.Length..])
                : "(Registered servers)";

            var cs = FromConnectionString(Child(server, "ConnectionStringWithEncryptedPassword") ?? "");
            // SSMS 21+ records the Connect dialog's choice explicitly; it beats guessing from the connection string.
            if (Child(server, "AuthenticationType") is { } authType && int.TryParse(authType, out _))
            {
                var auth = SsmsAuth(authType);
                var user = auth switch
                {
                    AuthKinds.Windows => null,
                    AuthKinds.Entra => NullIfEmpty(Child(server, "ActiveDirectoryUserId")) ?? cs.User,
                    _ => cs.User,
                };
                cs = cs with { Auth = auth, User = user };
            }

            Add(groups, group, Candidate(NullIfEmpty(Child(server, "Name")) ?? serverName, serverName, cs));
        }

        return Source("ssms-registered", "SSMS saved connections", path, groups);
    }

    /// <summary>".../ServerGroup/UAT/RegisteredServer/x" from the enclosing document's alias becomes ".../ServerGroup/UAT".</summary>
    private static string? GroupPathFromAlias(XElement server)
    {
        var alias = server.Ancestors().FirstOrDefault(a => a.Name.LocalName == "document")?
            .Descendants().FirstOrDefault(e => e.Name.LocalName == "alias")?.Value;
        var cut = alias?.LastIndexOf("/RegisteredServer/", StringComparison.Ordinal) ?? -1;
        return cut >= 0 ? alias![..cut] : null;
    }

    /// <summary>"/ServerGroup/Dev/ServerGroup/Legacy" becomes "Dev / Legacy".</summary>
    private static string GroupFromUri(string relative)
    {
        var parts = relative.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var names = parts.Where((_, i) => i % 2 == 1 && parts[i - 1] == "ServerGroup").Select(Uri.UnescapeDataString).ToList();
        return names.Count == 0 ? "(Registered servers)" : string.Join(" / ", names);
    }

    // --- SSMS connection history (UserSettings.xml) ---------------------------------------------

    public static ImportSource? ParseSsmsUserSettings(string path)
    {
        var doc = LoadXml(path);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var connections = new List<ImportCandidate>();

        // Per-connection settings carry the user and database; a server entry with none falls back to its own fields.
        var servers = doc.Descendants().Where(e => e.Name.LocalName == "ServerConnectionItem").ToList();
        foreach (var server in servers)
        {
            var settings = server.Descendants().Where(e => e.Name.LocalName == "ServerConnectionSettings").ToList();
            foreach (var entry in settings.Count > 0 ? settings : [server])
            {
                var instance = Child(entry, "Instance") ?? Child(server, "Instance");
                if (string.IsNullOrWhiteSpace(instance)) continue;
                var auth = SsmsAuth(Child(entry, "AuthenticationMethod") ?? Child(server, "AuthenticationMethod"));
                var user = auth is AuthKinds.Windows ? null : NullIfEmpty(Child(entry, "UserName"));
                var database = NullIfEmpty(Child(entry, "Database") ?? Child(entry, "DatabaseName"));
                if (database is "<default>") database = null;
                var trust = string.Equals(Child(entry, "TrustServerCertificate") ?? AdvancedOption(entry, "TSC"), "true", StringComparison.OrdinalIgnoreCase);

                if (!seen.Add($"{instance}|{auth}|{user}|{database}")) continue;
                var name = database is null ? instance : $"{instance} / {database}";
                connections.Add(Candidate(name, instance, new ParsedConnectionString(auth, user, database, trust)));
            }
        }

        return Source("ssms-recent", "SSMS connection history", path,
            connections.Count == 0 ? [] : new Dictionary<string, List<ImportCandidate>> { ["Connection history"] = connections });
    }

    /// <summary>Reads a value from the Advanced key/value list SSMS writes per connection, e.g. TSC (trust server certificate).</summary>
    private static string? AdvancedOption(XElement settings, string key) =>
        settings.Elements().FirstOrDefault(e => e.Name.LocalName == "Advanced")?
            .Elements().FirstOrDefault(e => e.Element("Key")?.Value.Trim() == key)?
            .Element("Value")?.Value.Trim();

    /// <summary>
    /// SSMS stores the Connect dialog's authentication choice as an index: 0 Windows, 1 SQL Server,
    /// and every later value is a flavour of Microsoft Entra (MFA, password, integrated, default...).
    /// </summary>
    private static string SsmsAuth(string? method) => int.TryParse(method, out var m)
        ? m switch { 0 => AuthKinds.Windows, 1 => AuthKinds.Sql, _ => AuthKinds.Entra }
        : AuthKinds.Windows;

    // --- Azure Data Studio and VS Code mssql (settings.json) ------------------------------------

    private static readonly JsonDocumentOptions SettingsJson = new() { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true };

    public static ImportSource? ParseAzureDataStudio(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path), SettingsJson);
        var root = doc.RootElement;
        if (!root.TryGetProperty("datasource.connections", out var conns)) return null;

        var groupNames = GroupNames(root, "datasource.connectionGroups");
        var groups = new Dictionary<string, List<ImportCandidate>>();
        foreach (var c in conns.EnumerateArray())
        {
            if (Str(c, "providerName") is { } provider && provider != "MSSQL") continue;
            if (!c.TryGetProperty("options", out var o)) continue;
            var server = Str(o, "server");
            if (string.IsNullOrWhiteSpace(server)) continue;
            var group = Str(c, "groupId") is { } gid && groupNames.TryGetValue(gid, out var g) ? g : NoGroup;
            Add(groups, group, Candidate(NullIfEmpty(Str(o, "connectionName")) ?? server, server, FromSettings(o)));
        }
        return Source("ads", "Azure Data Studio", path, groups);
    }

    public static ImportSource? ParseVsCode(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path), SettingsJson);
        var root = doc.RootElement;
        if (!root.TryGetProperty("mssql.connections", out var conns)) return null;

        var groupNames = GroupNames(root, "mssql.connectionGroups");
        var groups = new Dictionary<string, List<ImportCandidate>>();
        foreach (var c in conns.EnumerateArray())
        {
            var server = Str(c, "server");
            if (string.IsNullOrWhiteSpace(server)) continue;
            var group = Str(c, "groupId") is { } gid && groupNames.TryGetValue(gid, out var g) ? g : NoGroup;
            Add(groups, group, Candidate(NullIfEmpty(Str(c, "profileName")) ?? server, server, FromSettings(c)));
        }
        return Source("vscode", "VS Code (mssql extension)", path, groups);
    }

    /// <summary>Group id to display name, skipping the implicit root group.</summary>
    private static Dictionary<string, string> GroupNames(JsonElement root, string property)
    {
        var names = new Dictionary<string, string>();
        if (!root.TryGetProperty(property, out var groups)) return names;
        foreach (var g in groups.EnumerateArray())
            if (Str(g, "id") is { } id && Str(g, "name") is { } name && !name.Equals("ROOT", StringComparison.OrdinalIgnoreCase))
                names[id] = name;
        return names;
    }

    private static ParsedConnectionString FromSettings(JsonElement o)
    {
        var auth = Str(o, "authenticationType") switch
        {
            "SqlLogin" => AuthKinds.Sql,
            "Integrated" => AuthKinds.Windows,
            _ => AuthKinds.Entra, // AzureMFA, AzureMFAAndUser, ActiveDirectory*
        };
        return new ParsedConnectionString(
            auth,
            auth is AuthKinds.Windows ? null : NullIfEmpty(Str(o, "user")),
            NullIfEmpty(Str(o, "database")),
            o.TryGetProperty("trustServerCertificate", out var t) && t.ValueKind == JsonValueKind.True);
    }

    // --- Connection strings -----------------------------------------------------------------------

    public sealed record ParsedConnectionString(string Auth, string? User, string? Database, bool TrustServerCertificate);

    /// <summary>Tolerant key=value parse; unknown keys are ignored and passwords are never kept.</summary>
    public static ParsedConnectionString FromConnectionString(string connectionString)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (key, value) in SplitConnectionString(connectionString))
            values[key.Replace(" ", "").Replace("_", "")] = value;

        string? Get(params string[] keys) => keys.Select(k => values.GetValueOrDefault(k)).FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));
        bool IsTrue(string? v) => v is not null && (v.Equals("true", StringComparison.OrdinalIgnoreCase) || v.Equals("yes", StringComparison.OrdinalIgnoreCase) || v.Equals("sspi", StringComparison.OrdinalIgnoreCase));

        var user = Get("userid", "uid", "user");
        var auth = Get("authentication") is { } a && a.Replace(" ", "").Contains("ActiveDirectory", StringComparison.OrdinalIgnoreCase)
            ? AuthKinds.Entra
            : IsTrue(Get("integratedsecurity", "trustedconnection")) || user is null ? AuthKinds.Windows : AuthKinds.Sql;

        return new ParsedConnectionString(
            auth,
            auth == AuthKinds.Windows ? null : user,
            Get("initialcatalog", "database"),
            IsTrue(Get("trustservercertificate")));
    }

    private static IEnumerable<(string Key, string Value)> SplitConnectionString(string s)
    {
        var i = 0;
        while (i < s.Length)
        {
            var eq = s.IndexOf('=', i);
            if (eq < 0) yield break;
            var key = s[i..eq].Trim();
            i = eq + 1;
            string value;
            if (i < s.Length && s[i] is '"' or '\'')
            {
                var quote = s[i];
                var close = s.IndexOf(quote, i + 1);
                if (close < 0) close = s.Length;
                value = s[(i + 1)..close];
                i = s.IndexOf(';', Math.Min(close, s.Length - 1)) is var semi and >= 0 ? semi + 1 : s.Length;
            }
            else
            {
                var semi = s.IndexOf(';', i);
                if (semi < 0) semi = s.Length;
                value = s[i..semi].Trim();
                i = semi + 1;
            }
            if (key.Length > 0) yield return (key, value);
        }
    }

    // --- Helpers ----------------------------------------------------------------------------------

    private static ImportCandidate Candidate(string name, string endpoint, ParsedConnectionString cs) => new(
        name.Trim(),
        endpoint.Contains(".sql.azuresynapse.net", StringComparison.OrdinalIgnoreCase) ? ConnectionKinds.Synapse : ConnectionKinds.Sql,
        endpoint.Trim(),
        cs.Auth,
        cs.User,
        cs.Database,
        cs.TrustServerCertificate,
        cs.Auth == AuthKinds.Sql ? PasswordNote : null);

    private static void Add(Dictionary<string, List<ImportCandidate>> groups, string group, ImportCandidate candidate)
    {
        if (!groups.TryGetValue(group, out var list)) groups[group] = list = [];
        list.Add(candidate);
    }

    private static ImportSource? Source(string source, string label, string path, Dictionary<string, List<ImportCandidate>> groups) =>
        new(source, label, path, groups.Select(g => new ImportGroup(g.Key, g.Value)).ToList());

    private static string? Child(XElement e, string localName) =>
        e.Elements().FirstOrDefault(c => c.Name.LocalName == localName)?.Value;

    private static string? Str(JsonElement e, string property) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(property, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static IEnumerable<string> TopLevelFiles(string root, string pattern)
    {
        try
        {
            return Directory.EnumerateFiles(root, pattern);
        }
        catch (IOException)
        {
            return [];
        }
    }

    private static IEnumerable<string> FindFiles(string root, string name)
    {
        try
        {
            return Directory.EnumerateFiles(root, name, new EnumerationOptions { RecurseSubdirectories = true, MaxRecursionDepth = 3, IgnoreInaccessible = true });
        }
        catch (IOException)
        {
            return [];
        }
    }

    private static string VersionFolder(string root, string file)
    {
        var relative = Path.GetRelativePath(root, Path.GetDirectoryName(file)!);
        return relative == "." ? "default" : relative.Split(Path.DirectorySeparatorChar)[0];
    }
}

/// <summary>Identity used to spot connections that are already in Panoptic.</summary>
public static class ImportKey
{
    public static string Of(string endpoint, string? user, string? database)
    {
        var host = endpoint.Trim();
        if (host.StartsWith("tcp:", StringComparison.OrdinalIgnoreCase)) host = host[4..];
        return $"{host}|{user?.Trim()}|{database?.Trim()}";
    }
}
