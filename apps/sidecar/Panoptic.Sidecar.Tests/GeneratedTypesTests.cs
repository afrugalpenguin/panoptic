using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// The UI's types for the sidecar's JSON are generated from the records here (ADR 0005, #204), so the two sides cannot
/// drift. This test writes apps/desktop/src/sidecar-types.generated.ts and fails when the checked-in copy is stale.
/// Regenerate with: $env:PANOPTIC_UPDATE_TYPES = '1'; dotnet test apps/sidecar --filter GeneratedTypes
/// </summary>
public sealed class GeneratedTypesTests
{
    [Fact]
    public void Typescript_types_match_the_sidecar_records()
    {
        var path = Path.Combine(RepoRoot(), "apps", "desktop", "src", "sidecar-types.generated.ts");
        var generated = TypeScriptTypes.Generate();
        if (Environment.GetEnvironmentVariable("PANOPTIC_UPDATE_TYPES") == "1") File.WriteAllText(path, generated);

        var current = File.Exists(path) ? File.ReadAllText(path).ReplaceLineEndings("\n") : "";
        Assert.True(current == generated,
            "apps/desktop/src/sidecar-types.generated.ts is out of date with the sidecar's records. Regenerate it with pnpm types, or: " +
            "$env:PANOPTIC_UPDATE_TYPES = '1'; dotnet test apps/sidecar --filter GeneratedTypes");
    }

    [Fact]
    public void Nullable_members_are_optional_and_collections_map_to_arrays_and_records()
    {
        var ts = TypeScriptTypes.Generate();

        Assert.Contains("export interface QueryScope {\n  connection: string;\n  database?: string | null;", ts);
        Assert.Contains("  objects: CatalogObject[];", ts);
        Assert.Contains("  meta?: Record<string, string> | null;", ts);
        Assert.Contains("  elapsedMs: number;", ts);
        Assert.DoesNotContain("interface StoreFile", ts);
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("Repository root not found above " + AppContext.BaseDirectory);
    }
}

/// <summary>Writes TypeScript interfaces for every record the sidecar serialises (its <see cref="SidecarJson"/> context).</summary>
public static class TypeScriptTypes
{
    /// <summary>Stored on disk only, never sent to the UI: it holds the secrets.</summary>
    private static readonly HashSet<Type> Internal = [typeof(StoreFile)];

    public static string Generate()
    {
        var context = SidecarJson.Default;
        var pending = new Queue<Type>(typeof(SidecarJson).CustomAttributes
            .Where(a => a.AttributeType == typeof(JsonSerializableAttribute))
            .Select(a => (Type)a.ConstructorArguments[0].Value!)
            .Where(t => !Internal.Contains(t)));
        var records = new SortedDictionary<string, string>(StringComparer.Ordinal);
        var nullability = new NullabilityInfoContext();

        while (pending.TryDequeue(out var type))
        {
            if (Element(type) is { } element)
            {
                pending.Enqueue(element);
                continue;
            }
            if (!IsRecord(type) || records.ContainsKey(type.Name)) continue;

            var info = context.GetTypeInfo(type) ?? throw new InvalidOperationException($"{type} is not in SidecarJson");
            var body = new StringBuilder();
            foreach (var property in info.Properties.OrderBy(p => p.Order))
            {
                var member = (PropertyInfo)property.AttributeProvider!;
                var n = nullability.Create(member);
                var optional = n.ReadState == NullabilityState.Nullable;
                body.Append($"  {property.Name}{(optional ? "?" : "")}: {Ts(member.PropertyType, n, pending)}{(optional ? " | null" : "")};\n");
            }
            records[type.Name] = $"export interface {type.Name} {{\n{body}}}\n";
        }

        return "// Generated from the sidecar's JSON records by GeneratedTypesTests (apps/sidecar/Panoptic.Sidecar.Tests).\n" +
               "// Do not edit: change the C# record, then regenerate with\n" +
               "//   $env:PANOPTIC_UPDATE_TYPES = '1'; dotnet test apps/sidecar --filter GeneratedTypes\n\n" +
               string.Join("\n", records.Values);
    }

    private static bool IsRecord(Type t) => t.Namespace?.StartsWith("Panoptic.Sidecar", StringComparison.Ordinal) == true && t.IsClass;

    /// <summary>The element type of an array or list, for the queue; null for anything else.</summary>
    private static Type? Element(Type t) =>
        t.IsArray ? t.GetElementType() :
        t.IsGenericType && t.GetGenericArguments().Length == 1 && typeof(System.Collections.IEnumerable).IsAssignableFrom(t) ? t.GetGenericArguments()[0] :
        null;

    private static string Ts(Type t, NullabilityInfo n, Queue<Type> pending)
    {
        if (Nullable.GetUnderlyingType(t) is { } underlying) t = underlying;
        if (t == typeof(string)) return "string";
        if (t == typeof(bool)) return "boolean";
        if (t == typeof(int) || t == typeof(long) || t == typeof(double) || t == typeof(float) || t == typeof(decimal)) return "number";
        if (t == typeof(JsonElement)) return "unknown";
        if (t.IsGenericType && t.GetGenericArguments().Length == 2 && t.GetGenericArguments()[0] == typeof(string))
            return $"Record<string, {Inner(t.GetGenericArguments()[1], n.GenericTypeArguments[1], pending)}>";
        if (t.IsArray) return $"{Wrap(Inner(t.GetElementType()!, n.ElementType!, pending))}[]";
        if (Element(t) is { } element) return $"{Wrap(Inner(element, n.GenericTypeArguments[0], pending))}[]";
        if (IsRecord(t))
        {
            pending.Enqueue(t);
            return t.Name;
        }
        throw new NotSupportedException($"No TypeScript mapping for {t}");
    }

    /// <summary>A collection's element: may itself be nullable.</summary>
    private static string Inner(Type t, NullabilityInfo n, Queue<Type> pending)
    {
        var ts = Ts(t, n, pending);
        return n.ReadState == NullabilityState.Nullable || Nullable.GetUnderlyingType(t) is not null ? $"{ts} | null" : ts;
    }

    private static string Wrap(string ts) => ts.Contains(' ') ? $"({ts})" : ts;
}
