using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace Panoptic.Sidecar;

/// <summary>
/// The node contract. The UI renders these without knowing which backend produced them.
/// Id is a path (see <see cref="NodePath"/>) that the sidecar alone interprets.
/// </summary>
public sealed record TreeNode(
    string Id,
    string Kind,
    string Label,
    string Icon,
    bool HasChildren,
    string[] Actions,
    Dictionary<string, string>? Meta = null);

/// <summary>
/// Why a node's children failed to load, sent as the JSON-RPC error's data (docs/explorer-errors.md).
/// </summary>
/// <param name="Summary">One short human sentence with no identifiers, shown on the tree row.</param>
/// <param name="Detail">The full original message plus status, ids, endpoint and identity, for the Problems tab.</param>
/// <param name="Code">The provider status where there is one: "403/5300", "429", a SQL error number.</param>
public sealed record NodeError(string Summary, string Detail, string? Code, bool Retryable);

public static class ConnectionKinds
{
    public const string Sql = "sql";
    public const string Cosmos = "cosmos";
    /// <summary>Azure Synapse SQL pool (dedicated or serverless). TDS, served by the SQL Server backend.</summary>
    public const string Synapse = "synapse";
}

public static class AuthKinds
{
    public const string Entra = "entra";
    public const string Sql = "sql";
    public const string Key = "key";
    /// <summary>Windows integrated authentication (SQL Server only).</summary>
    public const string Windows = "windows";
}

/// <param name="Endpoint">SQL Server host[,port] or Cosmos account URI.</param>
/// <param name="Database">Optional: restrict the tree to one database (needed for contained users).</param>
/// <param name="TrustServerCertificate">SQL: skip certificate validation. Cosmos: allowed only for a localhost emulator.</param>
public sealed record ConnectionConfig(
    string Id,
    string Name,
    string Kind,
    string Endpoint,
    string Auth,
    string? User = null,
    string? Database = null,
    string? TenantId = null,
    bool TrustServerCertificate = false);

public sealed record EnvironmentConfig(string Id, string Name, string Color, bool ReadOnly, List<ConnectionConfig> Connections);

public sealed record AppConfig(List<EnvironmentConfig> Environments)
{
    public static AppConfig Empty => new([]);
}

public sealed record SaveConnectionParams(string EnvironmentId, ConnectionConfig Connection, string? Secret);
public sealed record TestConnectionParams(ConnectionConfig Connection, string? Secret);
public sealed record IdParams(string Id);
public sealed record TreeChildrenParams(string NodeId);
public sealed record TestConnectionResult(bool Ok, double ElapsedMs, string? Error);
/// <param name="Database">Overrides the database the node resolves to (the tab's database picker).</param>
public sealed record QueryRequest(string QueryId, string NodeId, string Text, string? Database = null);
public sealed record QueryCancelParams(string QueryId);
public sealed record ResultSetSummary(int RowCount);
public sealed record QuerySummary(string QueryId, ResultSetSummary[] ResultSets, double ElapsedMs, bool RolledBack, bool Cancelled, string? Error, double? RequestCharge);
public sealed record QueryTemplateParams(string NodeId, string Action);
/// <param name="Language">"sql" or "cosmos".</param>
public sealed record QueryTemplateResult(string? Text, string Language);
/// <summary>What a node id resolves to for running a query: its environment, connection and the database or container under it.</summary>
public sealed record QueryTarget(EnvironmentConfig Environment, ConnectionConfig Connection, string? Database, string? Container);
public sealed record DeviceCodePrompt(string Message, string UserCode, string VerificationUri);

public static class UpdateCheckModes
{
    /// <summary>Default: check GitHub Releases once when Panoptic starts.</summary>
    public const string Startup = "startup";
    public const string Hourly = "hourly";
    /// <summary>No automatic update checks at all.</summary>
    public const string Never = "never";

    public static readonly string[] All = [Startup, Hourly, Never];
}

public static class RowFonts
{
    public const string Mono = "mono";
    public const string Ui = "ui";
}

/// <summary>Explorer display settings (docs/explorer-ux.md). EnvOrder lists environment ids in manual order; empty means order added.</summary>
public sealed record ExplorerSettings(bool ShowKindBadge = true, string RowFont = RowFonts.Mono, string[]? EnvOrder = null)
{
    public string[] EnvOrder { get; init; } = EnvOrder ?? [];
}

public static class KeywordCases
{
    public const string Lower = "lower";
    public const string Upper = "upper";
    public const string Preserve = "preserve";
}

/// <summary>Query editor settings (docs/query-editor.md, "Settings").</summary>
/// <param name="KeywordCase">Null: the language default (lower for T-SQL, upper for Cosmos).</param>
/// <param name="CatalogSampleDocs">Documents sampled per Cosmos container for property path completion, 10 to 500.</param>
public sealed record EditorSettings(bool Intellisense = true, string? KeywordCase = null, int CatalogSampleDocs = 50, bool AutoRefreshOnDdl = true);

/// <param name="LastSeenVersion">The app version whose changes the user has been shown (ADR 0013). Null means never
/// recorded: a fresh install, or a store written before this setting existed.</param>
public sealed record AppSettings(string UpdateCheck = UpdateCheckModes.Startup, ExplorerSettings? Explorer = null, string? LastSeenVersion = null,
    EditorSettings? Editor = null)
{
    public ExplorerSettings Explorer { get; init; } = Explorer ?? new ExplorerSettings();

    public EditorSettings Editor { get; init; } = Editor ?? new EditorSettings();

    public static AppSettings Default => new();
}

/// <summary>Everything persisted, encrypted as one blob by <see cref="ConfigStore"/>. Settings is null in older stores.</summary>
public sealed record StoreFile(AppConfig Config, Dictionary<string, string> Secrets, AppSettings? Settings = null);

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(TreeNode[]))]
[JsonSerializable(typeof(NodeError))]
[JsonSerializable(typeof(AppConfig))]
[JsonSerializable(typeof(AppSettings))]
[JsonSerializable(typeof(EnvironmentConfig))]
[JsonSerializable(typeof(StoreFile))]
[JsonSerializable(typeof(SaveConnectionParams))]
[JsonSerializable(typeof(TestConnectionParams))]
[JsonSerializable(typeof(IdParams))]
[JsonSerializable(typeof(TreeChildrenParams))]
[JsonSerializable(typeof(TestConnectionResult))]
[JsonSerializable(typeof(DeviceCodePrompt))]
[JsonSerializable(typeof(Import.ImportSource[]))]
[JsonSerializable(typeof(QueryRequest))]
[JsonSerializable(typeof(QueryCancelParams))]
[JsonSerializable(typeof(QuerySummary))]
[JsonSerializable(typeof(QueryTemplateParams))]
[JsonSerializable(typeof(QueryTemplateResult))]
[JsonSerializable(typeof(Catalog.DatabaseCatalog))]
[JsonSerializable(typeof(Catalog.CatalogParams))]
[JsonSerializable(typeof(Catalog.CatalogResult))]
[JsonSerializable(typeof(Catalog.CatalogNotice))]
public sealed partial class SidecarJson : JsonSerializerContext;

public static class Rpc
{
    public static Action<Utf8JsonWriter> Result<T>(T value, JsonTypeInfo<T> type) => w => JsonSerializer.Serialize(w, value, type);

    public static readonly Action<Utf8JsonWriter> Null = w => w.WriteNullValue();

    public static T Params<T>(JsonElement? parameters, JsonTypeInfo<T> type) where T : class
    {
        if (parameters is null) throw new RpcException(RpcException.InvalidParams, "Missing params");
        try
        {
            return parameters.Value.Deserialize(type) ?? throw new RpcException(RpcException.InvalidParams, "Missing params");
        }
        catch (JsonException ex)
        {
            throw new RpcException(RpcException.InvalidParams, $"Invalid params: {ex.Message}");
        }
    }
}
