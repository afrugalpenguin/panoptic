using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Xml;

namespace Panoptic.Sidecar.Import;

/// <summary>
/// A file the user chooses, and the diagnostics report (#25). SSMS moves its settings between versions; an exported
/// .regsrvr (Registered Servers > Export, stable since 2005) is the fallback that always works, and the report says
/// what this machine's files look like, without anything in them, when a new version moves things again.
/// </summary>
public static partial class ConnectionImporter
{
    /// <summary>
    /// Reads a file the user picked: an exported .regsrvr or a RegSrvr*.xml (registered servers), an SSMS
    /// UserSettings.xml (connection history), or an Azure Data Studio or VS Code settings.json. Never throws: a file it
    /// cannot read comes back with the reason in <see cref="ImportSource.Error"/>.
    /// </summary>
    public static ImportSource ScanFile(string path)
    {
        var name = Path.GetFileName(path);
        var label = $"Chosen file ({name})";
        if (!Path.IsPathFullyQualified(path)) return new ImportSource("ssms-registered", label, path, [], $"The file must be a full path, not {path}.");
        if (!File.Exists(path)) return new ImportSource("ssms-registered", label, path, [], $"{path} does not exist.");
        try
        {
            switch (Path.GetExtension(path).ToLowerInvariant())
            {
                case ".regsrvr":
                case ".xml":
                    var registered = ParseRegisteredServers(path);
                    if (registered is { Groups.Count: > 0 }) return registered with { Label = label };
                    var history = ParseSsmsUserSettings(path);
                    return history is { Groups.Count: > 0 } ? history with { Label = label } : (registered ?? history ?? Empty("ssms-registered"));
                case ".json":
                    return (ParseAzureDataStudio(path) ?? ParseVsCode(path))?.With(label)
                        ?? Empty("ads", "It has no Azure Data Studio or VS Code saved connections.");
                default:
                    return Empty("ssms-registered", "Choose an SSMS registered servers export (.regsrvr), a RegSrvr or UserSettings .xml, or a settings.json.");
            }
        }
        catch (Exception ex)
        {
            return Empty("ssms-registered", $"Could not read this file: {ex.Message}");
        }

        ImportSource Empty(string source, string? error = null) => new(source, label, path, [], error);
    }

    private static ImportSource With(this ImportSource source, string label) => source with { Label = label };

    /// <summary>
    /// A report of every place the scan looks, for an issue when SSMS moves things: whether each file is there, its size
    /// and age, and its structure (XML element names and JSON property names, with counts). Never a value: no server,
    /// user, group or database name, and the user's profile folders appear as %APPDATA% and %LOCALAPPDATA%.
    /// </summary>
    public static string Diagnostics(string roamingAppData, string localAppData, string? version = null)
    {
        var report = new StringBuilder();
        string Shown(string path) => path.Replace(roamingAppData, "%APPDATA%", StringComparison.OrdinalIgnoreCase)
            .Replace(localAppData, "%LOCALAPPDATA%", StringComparison.OrdinalIgnoreCase);

        report.AppendLine($"Panoptic import diagnostics{(version is null ? "" : $" (v{version})")}, {DateTime.UtcNow:yyyy-MM-dd}. Structure only: no values.");
        report.AppendLine();
        foreach (var root in SsmsRoots(roamingAppData, localAppData))
        {
            if (!Directory.Exists(root)) report.AppendLine($"{Shown(root)}: not found");
            else report.AppendLine($"{Shown(root)}: folders {string.Join(", ", SubFolders(root))}");
        }
        report.AppendLine();
        foreach (var (_, _, path, _) in Locations(roamingAppData, localAppData))
        {
            if (!File.Exists(path))
            {
                report.AppendLine($"{Shown(path)}: not found");
                continue;
            }
            var info = new FileInfo(path);
            report.AppendLine($"{Shown(path)}: {info.Length.ToString("N0", CultureInfo.InvariantCulture)} bytes, modified {info.LastWriteTimeUtc:yyyy-MM-dd}");
            try
            {
                foreach (var line in path.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ? JsonShape(path) : XmlShape(path))
                    report.AppendLine($"  {line}");
            }
            catch (Exception ex)
            {
                report.AppendLine($"  could not read: {ex.GetType().Name}");
            }
        }
        return report.ToString();
    }

    private static IEnumerable<string> SubFolders(string root)
    {
        try
        {
            var names = Directory.EnumerateDirectories(root).Select(d => Path.GetFileName(d) ?? "").Order(StringComparer.OrdinalIgnoreCase).ToList();
            return names.Count == 0 ? ["none"] : names;
        }
        catch (IOException)
        {
            return ["unreadable"];
        }
    }

    /// <summary>Element local names with how often each appears, and the namespaces used. Element names are the format's, never the user's.</summary>
    private static IEnumerable<string> XmlShape(string path)
    {
        using var reader = XmlReader.Create(path, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
        var counts = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var namespaces = new SortedSet<string>(StringComparer.Ordinal);
        while (reader.Read())
        {
            if (reader.NodeType != XmlNodeType.Element) continue;
            counts[reader.LocalName] = counts.GetValueOrDefault(reader.LocalName) + 1;
            if (!string.IsNullOrEmpty(reader.NamespaceURI)) namespaces.Add(reader.NamespaceURI);
        }
        if (namespaces.Count > 0) yield return $"namespaces: {string.Join(", ", namespaces)}";
        yield return $"elements: {string.Join(", ", counts.Select(c => $"{c.Key} {c.Value}"))}";
    }

    /// <summary>
    /// For the connection settings only (not the rest of a user's settings.json): how many connections and groups, and
    /// the property names their entries use, with counts.
    /// </summary>
    private static IEnumerable<string> JsonShape(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path), SettingsJson);
        var root = doc.RootElement;
        var any = false;
        foreach (var property in new[] { "datasource.connections", "datasource.connectionGroups", "mssql.connections", "mssql.connectionGroups" })
        {
            if (!root.TryGetProperty(property, out var list)) continue;
            any = true;
            if (list.ValueKind != JsonValueKind.Array)
            {
                yield return $"{property}: {list.ValueKind}";
                continue;
            }
            var keys = new SortedDictionary<string, int>(StringComparer.Ordinal);
            foreach (var item in list.EnumerateArray()) CountKeys(item, "", keys);
            yield return $"{property}: {list.GetArrayLength()}, properties {string.Join(", ", keys.Select(k => $"{k.Key} {k.Value}"))}";
        }
        if (!any) yield return "no connection settings";

        static void CountKeys(JsonElement e, string prefix, SortedDictionary<string, int> keys)
        {
            if (e.ValueKind != JsonValueKind.Object) return;
            foreach (var p in e.EnumerateObject())
            {
                var key = prefix + p.Name;
                keys[key] = keys.GetValueOrDefault(key) + 1;
                // One level down (options.server): deep enough to see a format change, never into values.
                if (prefix.Length == 0) CountKeys(p.Value, key + ".", keys);
            }
        }
    }
}
