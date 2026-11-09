using System.Collections.Concurrent;
using Azure.Core;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar;

/// <summary>
/// The sidecar's own record of sessions it has opened, per saved connection (docs/connection-pane.md, sessionInfo).
/// Backends report each successful open; the first one per connection starts a session, later ones only refresh the
/// identity and token expiry. Nothing here touches the network. A changed or removed connection is forgotten.
/// </summary>
public sealed class SessionLog(TimeProvider time)
{
    private readonly ConcurrentDictionary<string, SessionInfo> _sessions = new();

    /// <summary>A connection's first open since it was saved or the sidecar started: the server can be described now.</summary>
    public event Action<string>? FirstOpen;

    /// <param name="handshakeMs">How long this open took; kept only for the open that started the session.</param>
    /// <param name="tokenExpiresAt">The Entra token's expiry, for token sign-ins.</param>
    public void Opened(ConnectionConfig connection, double handshakeMs, string identity, string authMode, DateTimeOffset? tokenExpiresAt = null)
    {
        var first = false;
        var expires = tokenExpiresAt?.ToUnixTimeMilliseconds();
        _sessions.AddOrUpdate(
            connection.Id,
            _ =>
            {
                first = true;
                return new SessionInfo(time.GetUtcNow().ToUnixTimeMilliseconds(), Math.Round(handshakeMs, 1), identity, authMode, expires);
            },
            (_, old) => old with { Identity = identity, AuthMode = authMode, TokenExpiresAt = expires ?? old.TokenExpiresAt });
        if (first) FirstOpen?.Invoke(connection.Id);
    }

    public SessionInfo? Get(string connectionId) => _sessions.GetValueOrDefault(connectionId);

    public void Forget(string connectionId) => _sessions.TryRemove(connectionId, out _);

    /// <summary>The label backends.describe gives the connection's sign-in ("SQL login"); its id if it has none.</summary>
    public static string AuthLabel(IBackend backend, ConnectionConfig connection) =>
        backend.Describe(connection.Kind).Auths.FirstOrDefault(a => a.Id == connection.Auth)?.Label ?? connection.Auth;

    /// <summary>Who an Entra token signs in as: its user name, or "service principal" when it has none.</summary>
    public static string EntraIdentity(AccessToken token) => PostgresBackend.EntraUser(token.Token) ?? "service principal";

    /// <summary>The Windows account the sidecar runs as, which Windows sign-in uses.</summary>
    public static string WindowsIdentity => $@"{Environment.UserDomainName}\{Environment.UserName}";
}

/// <summary>
/// What the connection pane shows about a server beyond the store and the probe (docs/connection-pane.md): the session,
/// the backend's description of the server and the exceptions found in it. A connection is described once, in the
/// background, when its first session opens, and again on Refresh; the pane only ever reads the cache, so showing it
/// runs no query. A changed or removed connection is forgotten.
/// </summary>
public sealed class ServerInfoService
{
    /// <summary>A describe that takes longer than this is abandoned and reported as failed.</summary>
    public static readonly TimeSpan DescribeTimeout = TimeSpan.FromSeconds(30);

    private readonly ConfigStore _store;
    private readonly Func<ConnectionConfig, IBackend> _backendFor;
    private readonly SessionLog _sessions;
    private readonly TimeProvider _time;
    private readonly Action<string> _updated;
    private readonly ConcurrentDictionary<string, Described> _described = new();
    private readonly ConcurrentDictionary<string, Task> _running = new();
    /// <summary>Bumped by Forget, so a describe that finishes after its connection changed is dropped.</summary>
    private readonly ConcurrentDictionary<string, int> _generation = new();

    private sealed record Described(double At, ServerDescription? Description, string? Error);

    /// <param name="updated">Called with a connection id when a describe for it finished (the connection.serverUpdated
    /// notification).</param>
    public ServerInfoService(ConfigStore store, Func<ConnectionConfig, IBackend> backendFor, SessionLog sessions, TimeProvider time, Action<string> updated)
    {
        _store = store;
        _backendFor = backendFor;
        _sessions = sessions;
        _time = time;
        _updated = updated;
        sessions.FirstOpen += id => _ = DescribeAsync(id, CancellationToken.None);
    }

    /// <summary>The pane's state for a connection. Refresh describes the server again, waiting for it, when a session has
    /// opened; without one there is nothing to describe yet and nothing is opened for it.</summary>
    public async Task<ServerState> GetAsync(string connectionId, bool refresh, CancellationToken ct)
    {
        if (refresh && _sessions.Get(connectionId) is not null) await DescribeAsync(connectionId, ct);
        return State(connectionId);
    }

    public ServerState State(string connectionId)
    {
        var session = _sessions.Get(connectionId);
        var described = session is null ? null : _described.GetValueOrDefault(connectionId);
        var databases = described?.Description?.Databases;
        return new ServerState(
            session,
            described?.Description?.Facts,
            described?.At,
            databases,
            Exceptions(databases),
            described?.Error);
    }

    /// <summary>The connection changed or went: its session, description and any describe running for it.</summary>
    public void Forget(string connectionId)
    {
        _sessions.Forget(connectionId);
        _described.TryRemove(connectionId, out _);
        _running.TryRemove(connectionId, out _);
        _generation.AddOrUpdate(connectionId, 1, (_, g) => g + 1);
    }

    /// <summary>Databases that are not online, worst first, then by name.</summary>
    public static List<ServerException> Exceptions(ServerDatabases? databases) =>
        (databases?.NotOnline ?? [])
            .OrderByDescending(d => d.Error)
            .ThenBy(d => d.Name, StringComparer.OrdinalIgnoreCase)
            .Select(d => new ServerException(d.Error ? "error" : "warn", "database", d.Name, $"is {d.State}"))
            .ToList();

    /// <summary>Describes the server once at a time per connection: a second call while one runs waits for it.</summary>
    private Task DescribeAsync(string connectionId, CancellationToken ct)
    {
        var task = _running.GetOrAdd(connectionId, id => Task.Run(() => RunAsync(id)));
        return task.WaitAsync(ct);
    }

    private async Task RunAsync(string connectionId)
    {
        var generation = _generation.GetValueOrDefault(connectionId);
        Described? result = null;
        try
        {
            if (_store.FindConnection(connectionId) is not { Connection: var connection }) return;
            using var timeout = new CancellationTokenSource(DescribeTimeout);
            try
            {
                var description = await _backendFor(connection).DescribeServerAsync(connection, _store.GetSecret(connectionId), timeout.Token);
                result = new Described(_time.GetUtcNow().ToUnixTimeMilliseconds(), description, null);
            }
            catch (Exception ex)
            {
                var error = timeout.IsCancellationRequested ? $"No answer within {DescribeTimeout.TotalSeconds:0} s" : ex is RpcException ? ex.Message : NodeErrors.OneLine(ex);
                result = new Described(_time.GetUtcNow().ToUnixTimeMilliseconds(), _described.GetValueOrDefault(connectionId)?.Description, error);
            }
        }
        finally
        {
            // Done before the result is published, so a Refresh that follows it starts a describe of its own.
            if (_generation.GetValueOrDefault(connectionId) == generation) _running.TryRemove(connectionId, out _);
        }
        // Forgotten meanwhile (saved or removed): the answer is for settings that no longer apply.
        if (result is null || _generation.GetValueOrDefault(connectionId) != generation || _sessions.Get(connectionId) is null) return;
        _described[connectionId] = result;
        _updated(connectionId);
    }
}
