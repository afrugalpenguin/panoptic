using Panoptic.Sidecar.Catalog;
using Panoptic.Sidecar.Query;

namespace Panoptic.Sidecar.Backends;

/// <summary>
/// One data source kind (SQL Server, Cosmos). Everything backend-specific lives behind this and
/// <see cref="IQueryBackend"/>: the services and RPC methods only ever reach a backend through
/// <see cref="BackendRegistry"/>, never by type or connection kind.
/// </summary>
public interface IBackend
{
    // --- Tree ----------------------------------------------------------------------------------------

    /// <param name="path">Full node path; segments from <paramref name="start"/> belong to this backend.</param>
    Task<TreeNode[]> ChildrenAsync(ConnectionConfig connection, string? secret, NodePath path, int start, CancellationToken cancellationToken);

    /// <summary>Connects and runs the cheapest possible call. Throws on failure.</summary>
    Task TestAsync(ConnectionConfig connection, string? secret, CancellationToken cancellationToken);

    /// <summary>Drops any cached client for a connection whose settings changed or was removed.</summary>
    void Forget(string connectionId);

    /// <summary>The <see cref="AuthKinds"/> a connection of <paramref name="kind"/> may use. Saving or testing a
    /// connection with any other is refused before it reaches the store or the backend, whatever the UI sent.</summary>
    IReadOnlyList<string> AuthsFor(string kind);

    // --- Node actions (optional) ---------------------------------------------------------------------
    // A node's action ids come with it from ChildrenAsync. Labels for the shared ones are in Nodes.ActionLabels.
    // Node meta may carry ready-made text for the UI: "dragText", what dragging the node into an editor inserts, and
    // "copyText", what Copy name copies. The UI offers each only on nodes that have it.

    /// <summary>Labels for any action ids this backend adds beyond <see cref="Nodes.ActionLabels"/>.</summary>
    IReadOnlyDictionary<string, string> ActionLabels => Nodes.NoLabels;

    /// <summary>
    /// Performs an action the UI does not perform itself (any the backend adds; none of the built-in backends add one).
    /// Returns the text it produced, which the UI copies; null means nothing to copy.
    /// </summary>
    Task<string?> InvokeAsync(ConnectionConfig connection, string? secret, NodePath path, int start, string actionId, CancellationToken cancellationToken) =>
        Task.FromResult(Nodes.InvokeDefault(actionId));
}

/// <summary>
/// A backend that can run queries: the query editor, its templates and its IntelliSense catalog. All or nothing, so a
/// backend that opts in implements every member. For a backend without it, TreeService strips newQuery and selectTop
/// from its nodes and the query and catalog methods refuse.
/// </summary>
public interface IQueryBackend : IBackend
{
    /// <summary>The editor language the UI opens this backend's query tabs in: "sql" (T-SQL) or "cosmos" today.</summary>
    string EditorLanguage { get; }

    /// <summary>Text for a query tab opened by a node action: selectTop on a table, view or container (null on any
    /// other node), or empty for newQuery and anything else.</summary>
    string? TemplateFor(NodePath path, string action);

    /// <summary>
    /// Runs query text, streaming results into <paramref name="sink"/>. The target carries the environment, so the
    /// backend applies the read-only policy its own way (or refuses). Errors the backend reports itself go through
    /// <see cref="IQuerySink.Fail"/>; anything thrown becomes the run's error. Cancellation throws.
    /// </summary>
    Task ExecuteAsync(QueryTarget target, string? secret, string text, IQuerySink sink, CancellationToken cancellationToken);

    /// <summary>A cheap value that changes when the database's objects change. Null when there is no cheap check:
    /// the catalog is then rebuilt once per session.</summary>
    Task<string?> CatalogStampAsync(QueryTarget target, string? secret, CancellationToken cancellationToken);

    Task<DatabaseCatalog> CatalogAsync(QueryTarget target, string? secret, EditorSettings editor, CancellationToken cancellationToken);
}

/// <summary>
/// Where a backend streams a query's results (<see cref="IQueryBackend.ExecuteAsync"/>). The query service behind it owns
/// the run: notifications, row counts, timing, cancellation and the summary.
/// </summary>
public interface IQuerySink
{
    /// <summary>Rows per query.rows notification, and the page size to ask a driver for.</summary>
    int BatchSize { get; }

    /// <summary>Result sets begun so far.</summary>
    int SetCount { get; }

    /// <summary>Starts the next result set and returns its index.</summary>
    int BeginSet();

    /// <summary>Rows already sent for a set.</summary>
    int RowCount(int set);

    /// <summary>Sends a batch of rows (columns on a set's first batch, and again whenever they change) and counts them.</summary>
    void Rows(int set, ResultColumn[]? columns, IReadOnlyList<object?[]> rows);

    /// <summary>A query.message: "info" (PRINT output, rows affected) or "error".</summary>
    void Message(string kind, string text);

    /// <summary>
    /// Records the run's error and reports it as an error message, or as one message per server error when
    /// <paramref name="errors"/> is given.
    /// </summary>
    void Fail(string error, IReadOnlyList<QueryError>? errors = null);

    /// <summary>Read-only guard: the changes were rolled back.</summary>
    void RolledBack();

    /// <summary>Read-only guard: the script ended the guard early, so changes may be committed.</summary>
    void Committed();

    /// <summary>Adds request units to the run's charge (Cosmos). Adding 0 reports a charge of 0.</summary>
    void AddCharge(double charge);
}

public static class Nodes
{
    public static readonly string[] Browse = ["refresh"];
    /// <summary>Connections, databases: can open a query against them.</summary>
    public static readonly string[] Queryable = ["newQuery", "refresh"];
    /// <summary>Tables, views, containers: can also select their first rows.</summary>
    public static readonly string[] Selectable = ["selectTop", "newQuery", "refresh"];
    public static readonly string[] LeafActions = [];
    /// <summary>The actions that open a query tab: only offered by an <see cref="IQueryBackend"/>.</summary>
    public static readonly string[] QueryActions = ["selectTop", "newQuery"];

    /// <summary>Menu labels for the actions every backend shares (node.actionLabels).</summary>
    public static readonly IReadOnlyDictionary<string, string> ActionLabels = new Dictionary<string, string>
    {
        ["selectTop"] = "Select top 1000",
        ["newQuery"] = "New query",
        ["refresh"] = "Refresh",
    };

    public static readonly IReadOnlyDictionary<string, string> NoLabels = new Dictionary<string, string>();

    /// <summary>An action id this backend does not know.</summary>
    public static string? InvokeDefault(string actionId) =>
        throw new RpcException(RpcException.InvalidParams, $"Unknown action: {actionId}");

    public static TreeNode Folder(NodePath parent, string folder, string label) =>
        new(parent.Child("f", folder).Id, "folder", label, "folder", true, Browse);

    public static TreeNode Branch(NodePath id, string kind, string label, string icon, Dictionary<string, string>? meta = null, string[]? actions = null) =>
        new(id.Id, kind, label, icon, true, actions ?? Browse, meta);

    public static TreeNode Leaf(NodePath id, string kind, string label, string icon, Dictionary<string, string>? meta = null) =>
        new(id.Id, kind, label, icon, false, LeafActions, meta);

    /// <summary>Joins the backend-relative segment types into a key, e.g. "db/f:tables/o".</summary>
    public static string Shape(IReadOnlyList<NodePath.Segment> segments) =>
        string.Join('/', segments.Select(s => s.Type == "f" ? $"f:{s.Value}" : s.Type));
}
