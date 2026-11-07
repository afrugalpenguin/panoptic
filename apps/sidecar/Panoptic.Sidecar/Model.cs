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
    /// <summary>PostgreSQL and Azure Database for PostgreSQL.</summary>
    public const string Postgres = "postgres";
}

public static class AuthKinds
{
    public const string Entra = "entra";
    public const string Sql = "sql";
    public const string Key = "key";
    /// <summary>Windows integrated authentication (SQL Server only).</summary>
    public const string Windows = "windows";
    /// <summary>User name and password (Postgres). SQL Server's equivalent is <see cref="Sql"/>.</summary>
    public const string Password = "password";

    /// <summary>An auth as the connection dialog lists it.</summary>
    public static AuthOption Option(string id) => new(id, id switch
    {
        Entra => "Microsoft Entra ID",
        Sql => "SQL login",
        Key => "Account key",
        Windows => "Windows",
        Password => "Username and password",
        _ => id,
    });
}

/// <summary>
/// Everything engine-specific the UI shows for a connection kind (backends.describe, #203), so the UI hard-codes no
/// engine: the connection dialog, the tree's kind badge and the engine filter all read this.
/// </summary>
/// <param name="Label">The kind as the connection dialog's Type list shows it.</param>
/// <param name="EndpointLabel">What the endpoint field is called: "Server", "Account URI".</param>
/// <param name="Auths">The auths a connection of this kind may use, in the order the dialog lists them. Saving or
/// testing a connection with any other is refused (<see cref="TreeService.Validate"/>).</param>
public sealed record KindDescription(
    string Kind,
    string Label,
    string EndpointLabel,
    string EndpointPlaceholder,
    IReadOnlyList<AuthOption> Auths,
    KindBadge Badge,
    ConnectionFields Fields);

public sealed record AuthOption(string Id, string Label);

/// <param name="Letters">One or two letters shown in the tree's 14px square.</param>
/// <param name="Name">The kind's short name, on the engine filter and in messages.</param>
public sealed record KindBadge(string Letters, string Color, string Name);

/// <summary>Which optional connection settings apply to a kind.</summary>
/// <param name="Database">The tree can be limited to one database.</param>
/// <param name="CertificateOptions">Takes a certificate host name and file (#261).</param>
/// <param name="EntraUser">With Entra, takes an optional user to sign in as (Postgres maps Entra users to roles).</param>
/// <param name="TrustLocalOnly">Skipping the certificate check is allowed for a server on this machine only (an
/// emulator), so it carries no risk warning.</param>
public sealed record ConnectionFields(bool Database, bool CertificateOptions, bool EntraUser, bool TrustLocalOnly);

/// <param name="Endpoint">SQL Server host[,port], Postgres host[:port] or Cosmos account URI.</param>
/// <param name="Database">Optional: restrict the tree to one database (needed for contained users).</param>
/// <param name="TrustServerCertificate">SQL and Postgres: encrypt without validating the certificate. Cosmos: allowed only for a localhost emulator.</param>
public sealed record ConnectionConfig(
    string Id,
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

public sealed record EnvironmentConfig(string Id, string Name, string Color, bool ReadOnly, List<ConnectionConfig> Connections);

/// <param name="Connections">Connections in no environment. Null in stores written before they existed.</param>
public sealed record AppConfig(List<EnvironmentConfig> Environments, List<ConnectionConfig>? Connections = null)
{
    public List<ConnectionConfig> Connections { get; init; } = Connections ?? [];

    public static AppConfig Empty => new([]);
}

/// <param name="EnvironmentId">Null: the connection is in no environment.</param>
public sealed record SaveConnectionParams(string? EnvironmentId, ConnectionConfig Connection, string? Secret);
public sealed record TestConnectionParams(ConnectionConfig Connection, string? Secret);
public sealed record IdParams(string Id);
/// <summary>import.scanFile: a file the user picked to import from (#25).</summary>
public sealed record ImportFileParams(string Path);
public sealed record PurgeSecretsParams(List<string>? ConnectionIds);
public sealed record TreeChildrenParams(string NodeId);
public sealed record TestConnectionResult(bool Ok, double ElapsedMs, string? Error);
/// <param name="Database">Overrides the database the node resolves to (the tab's database picker).</param>
public sealed record QueryRequest(string QueryId, string NodeId, string Text, string? Database = null);
public sealed record QueryCancelParams(string QueryId);
/// <param name="Truncated">The set reached the row limit (EditorSettings.MaxRows) and had more rows, which were not kept.</param>
public sealed record ResultSetSummary(int RowCount, bool Truncated = false);
/// <param name="RolledBack">Read-only environment, and the guard transaction was still open and rolled back.</param>
/// <param name="Committed">Read-only environment, but the guard transaction ended before the rollback (a COMMIT or ROLLBACK in the script, or an error that aborted it): changes may have been committed.</param>
public sealed record QuerySummary(string QueryId, ResultSetSummary[] ResultSets, double ElapsedMs, bool RolledBack, bool Committed, bool Cancelled, string? Error, double? RequestCharge);
public sealed record QueryTemplateParams(string NodeId, string Action);
/// <param name="Language">The backend's editor language: "sql", "cosmos" or "pgsql".</param>
/// <param name="Scope">What the tab runs against, so the UI never parses the node id.</param>
public sealed record QueryTemplateResult(string? Text, string Language, QueryScope Scope, QueryCapabilities Capabilities);

/// <summary>What a query tab on this backend offers beyond running text, so the UI tests no engine or language (#203).</summary>
/// <param name="DatabasePicker">The tab can switch database (SQL Server, Postgres); a Cosmos tab is bound to its container.</param>
/// <param name="UnknownNameWarnings">The editor may underline names its catalog does not have. A sampled catalog (Cosmos
/// properties) cannot say a name does not exist.</param>
/// <param name="DdlRefresh">After a run that changes objects (CREATE, ALTER, DROP), the catalog is rebuilt.</param>
public sealed record QueryCapabilities(bool DatabasePicker, bool UnknownNameWarnings, bool DdlRefresh);
/// <summary>A node's query scope for the UI (added 2026-10-30, ADR 0005).</summary>
/// <param name="Connection">The connection's node id.</param>
/// <param name="Database">The node's own database, if it is at or below one; null means the connection default.</param>
/// <param name="Container">The node's Cosmos container, if it is at or below one.</param>
/// <param name="Label">The nearest container, database or connection name, for a new query tab.</param>
/// <param name="ConnectionLabel">The connection's name.</param>
public sealed record QueryScope(string Connection, string? Database, string? Container, string Label, string ConnectionLabel);
public sealed record NodeScopeParams(string NodeId);
public sealed record NodeInvokeParams(string NodeId, string ActionId);
/// <param name="Text">What the action produced, which the UI copies. Null: nothing to copy.</param>
public sealed record NodeInvokeResult(string? Text);
/// <summary>What a node id resolves to for running a query: its environment (null for a connection in none),
/// connection and the database or container under it.</summary>
public sealed record QueryTarget(EnvironmentConfig? Environment, ConnectionConfig Connection, string? Database, string? Container)
{
    /// <summary>Read-only is an environment's setting: a connection in no environment is never read-only.</summary>
    public bool ReadOnly => Environment?.ReadOnly == true;
}

/// <summary>One server error in a failed query, sent with its query.message so the UI can place it in the editor.</summary>
/// <param name="Number">The server's error number (208 invalid object name, 207 invalid column name, ...). 0 for a server
/// that has none (Postgres), and then not sent.</param>
/// <param name="Line">1-based line in the text that was sent. Null when the error is inside another module (a procedure,
/// a trigger), whose own line it would be.</param>
/// <param name="State">The SQLSTATE (Postgres: 42P01 undefined table, ...).</param>
/// <param name="Column">1-based column on <paramref name="Line"/>, in UTF-16 code units as the editor counts, when the
/// server gives an exact position (Postgres).</param>
/// <param name="Unknown">For an error about a name the server could not resolve, what kind of name (<see cref="UnknownNames"/>):
/// the UI finds it in the script and suggests the closest catalog name. Null for any other error.</param>
public sealed record QueryError(int Number, int? Line, string Text, string? State = null, int? Column = null, string? Unknown = null);

/// <summary>What an error says was not found, as each backend classifies its own error codes (#203).</summary>
public static class UnknownNames
{
    /// <summary>A table or view (SQL Server 208, Postgres 42P01).</summary>
    public const string Object = "object";
    /// <summary>A column (SQL Server 207, Postgres 42703).</summary>
    public const string Column = "column";
    /// <summary>A stored procedure (SQL Server 2812).</summary>
    public const string Procedure = "procedure";
    /// <summary>A function (Postgres 42883).</summary>
    public const string Function = "function";
    /// <summary>A multi-part name's qualifier (SQL Server 4104): found in the script, but nothing to suggest.</summary>
    public const string Qualifier = "qualifier";
}
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
/// <param name="WarnUnknownNames">Underline tables and columns the catalog does not know, before the query runs.</param>
/// <param name="MaxRows">Rows kept per result set, 1,000 to 1,000,000 (#186): reading a set stops there and the rest of
/// the script still runs. Every kept row lives in the UI, so this bounds its memory.</param>
public sealed record EditorSettings(bool Intellisense = true, string? KeywordCase = null, int CatalogSampleDocs = 50, bool AutoRefreshOnDdl = true,
    bool WarnUnknownNames = true, int MaxRows = EditorSettings.DefaultMaxRows)
{
    public const int DefaultMaxRows = 100_000;
}

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
[JsonSerializable(typeof(KindDescription[]))]
[JsonSerializable(typeof(NodeError))]
[JsonSerializable(typeof(AppConfig))]
[JsonSerializable(typeof(AppSettings))]
[JsonSerializable(typeof(EnvironmentConfig))]
[JsonSerializable(typeof(StoreFile))]
[JsonSerializable(typeof(SaveConnectionParams))]
[JsonSerializable(typeof(TestConnectionParams))]
[JsonSerializable(typeof(IdParams))]
[JsonSerializable(typeof(PurgeSecretsParams))]
[JsonSerializable(typeof(TreeChildrenParams))]
[JsonSerializable(typeof(TestConnectionResult))]
[JsonSerializable(typeof(DeviceCodePrompt))]
[JsonSerializable(typeof(Import.ImportSource[]))]
[JsonSerializable(typeof(Import.ImportSource))]
[JsonSerializable(typeof(ImportFileParams))]
[JsonSerializable(typeof(QueryRequest))]
[JsonSerializable(typeof(QueryCancelParams))]
[JsonSerializable(typeof(QuerySummary))]
[JsonSerializable(typeof(QueryTemplateParams))]
[JsonSerializable(typeof(QueryTemplateResult))]
[JsonSerializable(typeof(QueryScope))]
[JsonSerializable(typeof(NodeScopeParams))]
[JsonSerializable(typeof(NodeInvokeParams))]
[JsonSerializable(typeof(NodeInvokeResult))]
[JsonSerializable(typeof(Dictionary<string, string>))]
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
