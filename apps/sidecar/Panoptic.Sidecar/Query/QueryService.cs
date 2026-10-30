using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Query;

/// <summary>
/// Runs queries and streams results to the UI as notifications, so the grid paints the first rows
/// before the query finishes:
///   query.rows    { queryId, index, columns?, rows }  500 rows at a time; columns on a set's first
///                                                     batch, and again whenever Cosmos finds new ones
///   query.message { queryId, kind, text, number?, state?, line?, column? }  PRINT output and notices, rows affected,
///                                                    errors (one per server error, with its number or SQLSTATE and
///                                                    1-based line, and column where the server gives one)
/// ExecuteAsync returns a summary when everything has finished, been cancelled or failed; results
/// already streamed are kept. The connection's backend executes the text (IBackend.ExecuteAsync) and
/// streams into the run; this service owns the run's bookkeeping. Read-only environments are the
/// backend's to enforce: SQL Server runs inside a transaction that is rolled back (see SqlBackend).
/// </summary>
public sealed class QueryService
{
    private const int BatchSize = 500;

    private readonly ConfigStore _store;
    private readonly TreeService _tree;
    private readonly Action<string, Action<Utf8JsonWriter>> _notify;
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _running = new();

    public QueryService(ConfigStore store, TreeService tree, Action<string, Action<Utf8JsonWriter>> notify)
    {
        _store = store;
        _tree = tree;
        _notify = notify;
    }

    /// <summary>Kept for existing callers: the backends come from <paramref name="tree"/>, which already holds these.</summary>
    public QueryService(ConfigStore store, TreeService tree, SqlBackend sql, CosmosBackend cosmos, Action<string, Action<Utf8JsonWriter>> notify)
        : this(store, tree, notify)
    {
    }

    public bool Cancel(string queryId)
    {
        if (!_running.TryGetValue(queryId, out var cts)) return false;
        cts.Cancel();
        return true;
    }

    public async Task<QuerySummary> ExecuteAsync(QueryRequest request, CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        if (!_running.TryAdd(request.QueryId, cts)) throw new RpcException(RpcException.InvalidParams, $"Query {request.QueryId} is already running");
        var run = new Run(this, request.QueryId, Stopwatch.StartNew());
        try
        {
            var target = _tree.ResolveTarget(request.NodeId, request.Database);
            var backend = _tree.QueryBackendFor(target.Connection, "cannot run queries");
            await backend.ExecuteAsync(target, _store.GetSecret(target.Connection.Id), request.Text, run, cts.Token);
        }
        catch (Exception) when (cts.IsCancellationRequested)
        {
            run.Cancelled = true;
        }
        catch (RpcException ex)
        {
            run.Error = ex.Message;
        }
        catch (Exception ex)
        {
            run.Error = ex.Message;
            run.Message("error", ex.Message);
        }
        finally
        {
            _running.TryRemove(request.QueryId, out _);
        }
        if (run.Cancelled) run.Message("info", "Query cancelled.");

        return new QuerySummary(request.QueryId, run.Sets.Select(n => new ResultSetSummary(n)).ToArray(),
            Math.Round(run.Clock.Elapsed.TotalMilliseconds), run.IsRolledBack, run.IsCommitted, run.Cancelled, run.Error, run.Charge);
    }

    /// <summary>Kept for existing callers; the SQL read-only guard's batch loop now lives in SqlBackend.</summary>
    public static Task<bool> RunBatches(IEnumerable<string> batches, Func<string, Task> execute, Func<Task<int>>? tranCount) =>
        SqlBackend.RunBatches(batches, execute, tranCount);

    /// <summary>One query.execute: what the backend has streamed so far, and the summary's flags.</summary>
    private sealed class Run(QueryService owner, string queryId, Stopwatch clock) : IQuerySink
    {
        public string QueryId { get; } = queryId;
        public Stopwatch Clock { get; } = clock;
        public List<int> Sets { get; } = [];
        public bool IsRolledBack { get; private set; }
        public bool IsCommitted { get; private set; }
        public bool Cancelled { get; set; }
        public string? Error { get; set; }
        public double? Charge { get; private set; }

        public int BatchSize => QueryService.BatchSize;
        public int SetCount => Sets.Count;

        public int BeginSet()
        {
            Sets.Add(0);
            return Sets.Count - 1;
        }

        public int RowCount(int set) => Sets[set];

        public void Rows(int set, ResultColumn[]? columns, IReadOnlyList<object?[]> rows)
        {
            owner.Rows(this, set, columns, rows);
            Sets[set] += rows.Count;
        }

        public void Message(string kind, string text) => owner.Message(this, kind, text, null);

        public void Fail(string error, IReadOnlyList<QueryError>? errors = null)
        {
            Error = error;
            if (errors is null or { Count: 0 }) Message("error", error);
            else foreach (var e in errors) owner.Message(this, "error", e.Text, e);
        }

        public void RolledBack() => IsRolledBack = true;
        public void Committed() => IsCommitted = true;
        public void AddCharge(double charge) => Charge = (Charge ?? 0) + charge;
    }

    // --- Notifications ----------------------------------------------------------------------------

    private void Rows(Run run, int index, ResultColumn[]? columns, IReadOnlyList<object?[]> rows) => _notify("query.rows", w =>
    {
        w.WriteStartObject();
        w.WriteString("queryId", run.QueryId);
        w.WriteNumber("index", index);
        if (columns is not null)
        {
            w.WriteStartArray("columns");
            foreach (var c in columns)
            {
                w.WriteStartObject();
                w.WriteString("name", c.Name);
                w.WriteString("type", c.Type);
                w.WriteEndObject();
            }
            w.WriteEndArray();
        }
        w.WriteStartArray("rows");
        foreach (var row in rows)
        {
            w.WriteStartArray();
            foreach (var value in row) SqlValues.Write(w, value);
            w.WriteEndArray();
        }
        w.WriteEndArray();
        w.WriteEndObject();
    });

    private void Message(Run run, string kind, string text, QueryError? error) => _notify("query.message", w =>
    {
        w.WriteStartObject();
        w.WriteString("queryId", run.QueryId);
        w.WriteString("kind", kind);
        w.WriteString("text", text);
        if (error is not null)
        {
            if (error.Number != 0) w.WriteNumber("number", error.Number);
            if (error.State is { } state) w.WriteString("state", state);
            if (error.Line is { } line) w.WriteNumber("line", line);
            if (error.Column is { } column) w.WriteNumber("column", column);
        }
        w.WriteNumber("elapsedMs", Math.Round(run.Clock.Elapsed.TotalMilliseconds));
        w.WriteEndObject();
    });
}

public sealed record ResultColumn(string Name, string Type);
