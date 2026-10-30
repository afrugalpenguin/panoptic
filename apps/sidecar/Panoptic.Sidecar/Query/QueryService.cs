using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Azure.Cosmos;
using Microsoft.Data.SqlClient;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Query;

/// <summary>
/// Runs queries and streams results to the UI as notifications, so the grid paints the first rows
/// before the query finishes:
///   query.rows    { queryId, index, columns?, rows }  500 rows at a time; columns on a set's first
///                                                     batch, and again whenever Cosmos finds new ones
///   query.message { queryId, kind, text }             PRINT output, rows affected, errors
/// ExecuteAsync returns a summary when everything has finished, been cancelled or failed; results
/// already streamed are kept. In read-only environments, SQL runs inside a transaction that is
/// rolled back at the end. That is a guard, not a permission boundary: a COMMIT in the script ends it
/// (reported as Committed, and the remaining batches are skipped), and side effects outside the
/// transaction (xp_cmdshell, sp_send_dbmail, linked servers) are never rolled back.
/// </summary>
public sealed class QueryService(ConfigStore store, TreeService tree, SqlBackend sql, CosmosBackend cosmos, Action<string, Action<Utf8JsonWriter>> notify)
{
    private const int BatchSize = 500;
    private static readonly HashSet<string> CosmosSystemProperties = ["_rid", "_self", "_etag", "_attachments"];

    private readonly ConcurrentDictionary<string, CancellationTokenSource> _running = new();

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
        var run = new Run(request.QueryId, Stopwatch.StartNew());
        try
        {
            var target = tree.ResolveTarget(request.NodeId, request.Database);
            if (target.Connection.Kind == ConnectionKinds.Cosmos) await RunCosmos(run, target, request.Text, cts.Token);
            else await RunSql(run, target, request.Text, cts.Token);
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
            Message(run, "error", ex.Message);
        }
        finally
        {
            _running.TryRemove(request.QueryId, out _);
        }
        if (run.Cancelled) Message(run, "info", "Query cancelled.");

        return new QuerySummary(request.QueryId, run.Sets.Select(n => new ResultSetSummary(n)).ToArray(),
            Math.Round(run.Clock.Elapsed.TotalMilliseconds), run.RolledBack, run.Committed, run.Cancelled, run.Error, run.Charge);
    }

    private sealed class Run(string queryId, Stopwatch clock)
    {
        public string QueryId { get; } = queryId;
        public Stopwatch Clock { get; } = clock;
        public List<int> Sets { get; } = [];
        public bool RolledBack { get; set; }
        public bool Committed { get; set; }
        public bool Cancelled { get; set; }
        public string? Error { get; set; }
        public double? Charge { get; set; }
    }

    // --- SQL Server -------------------------------------------------------------------------------

    private async Task RunSql(Run run, QueryTarget target, string text, CancellationToken ct)
    {
        await using var conn = await sql.OpenAsync(target.Connection, store.GetSecret(target.Connection.Id), target.Database, ct);
        conn.InfoMessage += (_, e) =>
        {
            foreach (SqlError error in e.Errors) Message(run, "info", error.Message);
        };

        if (target.Environment.ReadOnly)
        {
            await using var probe = new SqlCommand("SELECT CAST(SERVERPROPERTY('EngineEdition') AS int)", conn) { CommandTimeout = 30 };
            if ((int)(await probe.ExecuteScalarAsync(ct))! == 11) // Synapse serverless: no transactions to roll back
                throw new RpcException(RpcException.InvalidParams,
                    $"{target.Environment.Name} is read-only, but Synapse serverless pools do not support transactions, so Panoptic cannot roll queries back here. Use a read-only login, or clear the environment's read-only flag.");
        }

        await using var tx = target.Environment.ReadOnly ? conn.BeginTransaction() : null;
        try
        {
            var guardHeld = await RunBatches(BatchSplitter.Split(text), async batch =>
            {
                await using var cmd = new SqlCommand(batch, conn, tx) { CommandTimeout = 0 };
                var setsBefore = run.Sets.Count;
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                do
                {
                    if (reader.FieldCount > 0) await StreamSqlSet(run, reader, ct);
                } while (await reader.NextResultAsync(ct));

                reader.Close();
                if (reader.RecordsAffected >= 0 && run.Sets.Count == setsBefore)
                    Message(run, "info", $"({reader.RecordsAffected} row{(reader.RecordsAffected == 1 ? "" : "s")} affected)");
            }, tx is null ? null : () => TranCount(conn, tx, ct));
            if (!guardHeld) run.Committed = true;
        }
        catch (SqlException ex) when (!ct.IsCancellationRequested)
        {
            run.Error = ex.Errors.Count > 0 && ex.Errors[0].LineNumber > 0 ? $"Line {ex.Errors[0].LineNumber}: {ex.Message}" : ex.Message;
            Message(run, "error", run.Error);
        }
        finally
        {
            if (tx is not null) await EndReadOnly(run, target, conn, tx);
        }
    }

    /// <summary>
    /// Runs the batches in order. With <paramref name="tranCount"/> (read-only environments), checks it after each
    /// batch and stops as soon as it is 0: a COMMIT or ROLLBACK in the script has ended the guard transaction, so
    /// the remaining batches would run outside it. Returns false if it stopped for that reason. Statements after
    /// the COMMIT in the same batch have already run by then; the check is per batch, not per statement.
    /// </summary>
    public static async Task<bool> RunBatches(IEnumerable<string> batches, Func<string, Task> execute, Func<Task<int>>? tranCount)
    {
        foreach (var batch in batches)
        {
            await execute(batch);
            if (tranCount is not null && await tranCount() == 0) return false;
        }
        return true;
    }

    /// <summary>
    /// @@TRANCOUNT on the query's connection, or 0 once SqlClient has seen the guard transaction end. The second
    /// matters for "COMMIT; BEGIN TRAN": the count is back to 1, but the transaction is the script's, not ours.
    /// </summary>
    private static async Task<int> TranCount(SqlConnection conn, SqlTransaction tx, CancellationToken ct)
    {
        if (tx.Connection is null) return 0;
        await using var cmd = new SqlCommand("SELECT @@TRANCOUNT", conn, tx) { CommandTimeout = 30 };
        return (int)(await cmd.ExecuteScalarAsync(ct))!;
    }

    /// <summary>Rolls back the guard transaction, and says so only if it was still open and the rollback worked.</summary>
    private async Task EndReadOnly(Run run, QueryTarget target, SqlConnection conn, SqlTransaction tx)
    {
        // Zombied: the script (or an error that aborted the transaction) ended it on the server, and SqlClient's
        // Rollback is then a silent no-op, so it proves nothing.
        if (tx.Connection is null) run.Committed = true;
        if (run.Committed)
        {
            Message(run, "error", "A COMMIT or ROLLBACK in this script (or an error that aborted the transaction) ended the read-only guard: "
                + "changes made before it may be committed, statements after it in the same batch ran outside the guard, and later batches were not run.");
            try
            {
                // A transaction the script began after its COMMIT is not ours to keep open.
                await using var cleanup = new SqlCommand("IF @@TRANCOUNT > 0 ROLLBACK", conn) { CommandTimeout = 30 };
                await cleanup.ExecuteNonQueryAsync(CancellationToken.None);
            }
            catch (Exception) { /* the connection is discarded next anyway */ }
            return;
        }
        try
        {
            await tx.RollbackAsync(CancellationToken.None);
            run.RolledBack = true;
            Message(run, "info", $"{target.Environment.Name} is read-only: this query's database changes were rolled back.");
        }
        catch (Exception ex) when (ex is InvalidOperationException or SqlException)
        {
            Message(run, "error", $"{target.Environment.Name} is read-only, but the rollback failed: {ex.Message}. Changes may have been committed.");
        }
    }

    private async Task StreamSqlSet(Run run, SqlDataReader reader, CancellationToken ct)
    {
        var index = run.Sets.Count;
        run.Sets.Add(0);
        var columns = Enumerable.Range(0, reader.FieldCount).Select(i => new ResultColumn(reader.GetName(i), reader.GetDataTypeName(i))).ToArray();
        var batch = new List<object?[]>(BatchSize);
        var first = true;

        while (await reader.ReadAsync(ct))
        {
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < row.Length; i++) row[i] = ReadValue(reader, i);
            batch.Add(row);
            if (batch.Count == BatchSize)
            {
                Rows(run, index, first ? columns : null, batch);
                run.Sets[index] += batch.Count;
                batch.Clear();
                first = false;
            }
        }
        if (batch.Count > 0 || first) Rows(run, index, first ? columns : null, batch);
        run.Sets[index] += batch.Count;
    }

    private static object? ReadValue(SqlDataReader reader, int i)
    {
        if (reader.IsDBNull(i)) return null;
        try
        {
            return reader.GetValue(i);
        }
        catch (OverflowException)
        {
            // decimal(38, x) values beyond System.Decimal: fall back to the SQL type's own text.
            return reader.GetSqlValue(i).ToString();
        }
    }

    // --- Cosmos -----------------------------------------------------------------------------------

    private async Task RunCosmos(Run run, QueryTarget target, string text, CancellationToken ct)
    {
        if (target.Database is null || target.Container is null)
            throw new RpcException(RpcException.InvalidParams, "Select a container to query: Cosmos queries run against one container.");

        var client = cosmos.ClientFor(target.Connection, store.GetSecret(target.Connection.Id));
        var container = client.GetContainer(target.Database, target.Container);
        using var iterator = container.GetItemQueryStreamIterator(new QueryDefinition(text), requestOptions: new QueryRequestOptions { MaxItemCount = BatchSize });

        run.Sets.Add(0);
        var columns = new List<string>();
        var position = new Dictionary<string, int>();
        var sent = 0;
        run.Charge = 0;

        try
        {
            while (iterator.HasMoreResults)
            {
                using var response = await iterator.ReadNextAsync(ct);
                run.Charge += response.Headers.RequestCharge;
                if (!response.IsSuccessStatusCode)
                    throw new RpcException(RpcException.OperationFailed, $"{(int)response.StatusCode} {response.ErrorMessage?.Split('\n')[0]}");

                using var page = await JsonDocument.ParseAsync(response.Content, cancellationToken: ct);
                var rows = new List<object?[]>();
                foreach (var doc in page.RootElement.GetProperty("Documents").EnumerateArray())
                {
                    var values = new Dictionary<int, object?>();
                    if (doc.ValueKind != JsonValueKind.Object)
                    {
                        values[Column("value")] = doc.Clone(); // SELECT VALUE ... returns bare values
                    }
                    else
                    {
                        // id first, as Data Explorer shows it; system properties hidden.
                        if (doc.TryGetProperty("id", out var id)) values[Column("id")] = id.Clone();
                        foreach (var prop in doc.EnumerateObject())
                            if (prop.Name != "id" && !CosmosSystemProperties.Contains(prop.Name)) values[Column(prop.Name)] = prop.Value.Clone();
                    }
                    var row = new object?[columns.Count];
                    foreach (var (i, value) in values) row[i] = value;
                    rows.Add(row);
                }

                var newColumns = columns.Count != sent;
                if (rows.Count > 0 || run.Sets[0] == 0)
                    Rows(run, 0, newColumns || run.Sets[0] == 0 ? columns.Select(c => new ResultColumn(c, "")).ToArray() : null, rows);
                sent = columns.Count;
                run.Sets[0] += rows.Count;
            }
        }
        catch (CosmosException ex) when (!ct.IsCancellationRequested)
        {
            run.Error = $"{(int)ex.StatusCode} {ex.StatusCode}: {ex.Message.Split('\n')[0]}";
            Message(run, "error", run.Error);
        }

        int Column(string name)
        {
            if (position.TryGetValue(name, out var i)) return i;
            i = columns.Count;
            columns.Add(name);
            position[name] = i;
            return i;
        }
    }

    // --- Notifications ----------------------------------------------------------------------------

    private void Rows(Run run, int index, ResultColumn[]? columns, List<object?[]> rows) => notify("query.rows", w =>
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

    private void Message(Run run, string kind, string text) => notify("query.message", w =>
    {
        w.WriteStartObject();
        w.WriteString("queryId", run.QueryId);
        w.WriteString("kind", kind);
        w.WriteString("text", text);
        w.WriteNumber("elapsedMs", Math.Round(run.Clock.Elapsed.TotalMilliseconds));
        w.WriteEndObject();
    });
}

public sealed record ResultColumn(string Name, string Type);
