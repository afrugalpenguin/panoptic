using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net.Sockets;
using System.Security.Authentication;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar;

/// <summary>Opens a connection to a <see cref="ProbeTarget"/> and closes it again. Throws when nothing answers.</summary>
public interface IProbe
{
    Task ProbeAsync(ProbeTarget target, CancellationToken cancellationToken);
}

/// <summary>
/// The real probe: a TCP connect, or an HTTP(S) HEAD for a URL target. Nothing is sent over the TCP connection, and
/// the HEAD carries no credentials; any HTTP answer, error statuses included, and a TLS handshake the server answered
/// but the certificate did not pass, all mean the server is there.
/// </summary>
public sealed class NetworkProbe : IProbe
{
    // A new connection each time, so a pooled one never makes a server look reachable, or faster, than it is.
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        PooledConnectionLifetime = TimeSpan.Zero,
    })
    {
        Timeout = Timeout.InfiniteTimeSpan,
    };

    public async Task ProbeAsync(ProbeTarget target, CancellationToken cancellationToken)
    {
        if (target.Url is { } url)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Head, url);
                using var _ = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            }
            catch (HttpRequestException ex) when (ex.InnerException is AuthenticationException)
            {
                // The server answered the TLS handshake: reachable, whatever its certificate says.
            }
            return;
        }
        using var socket = new Socket(SocketType.Stream, ProtocolType.Tcp);
        await socket.ConnectAsync(target.Host, target.Port, cancellationToken);
    }
}

/// <summary>
/// Reachability probes for the environment pane (docs/environment-pane.md, "Reachability probes"): one per saved
/// connection, all at once, with a timeout, through the connection's backend's <see cref="IBackend.ProbeTarget"/>.
/// Each result is kept for <see cref="CacheFor"/>, so moving between environments does not probe again; a changed
/// endpoint, or <c>fresh</c> (the pane's Refresh), probes anew.
/// </summary>
public sealed class ProbeService(
    ConfigStore store,
    Func<ConnectionConfig, IBackend> backendFor,
    IProbe probe,
    TimeProvider time,
    TimeSpan? timeout = null)
{
    public static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(2);
    public static readonly TimeSpan CacheFor = TimeSpan.FromSeconds(60);

    private readonly TimeSpan _timeout = timeout ?? DefaultTimeout;
    private readonly ConcurrentDictionary<string, (string Endpoint, DateTimeOffset At, ProbeResult Result)> _cache = new();

    /// <summary>What a cached result was probed for: a changed kind or endpoint probes anew.</summary>
    private static string EndpointKey(ConnectionConfig connection) => $"{connection.Kind}\u001f{connection.Endpoint}";

    /// <summary>The cached result for a connection while it is still fresh and for its current endpoint, without probing:
    /// the connection pane's "unreachable while a session is open" exception. Null when there is none.</summary>
    public ProbeResult? Peek(string connectionId)
    {
        if (store.FindConnection(connectionId) is not { Connection: var connection }) return null;
        return _cache.TryGetValue(connectionId, out var hit) && hit.Endpoint == EndpointKey(connection) && time.GetUtcNow() - hit.At < CacheFor
            ? hit.Result
            : null;
    }

    /// <summary>The results in the order of the ids asked for. A cancelled request throws and caches nothing.</summary>
    public async Task<ProbeResult[]> ProbeAsync(IReadOnlyList<string> connectionIds, bool fresh, CancellationToken cancellationToken) =>
        await Task.WhenAll(connectionIds.Select(id => OneAsync(id, fresh, cancellationToken)));

    private async Task<ProbeResult> OneAsync(string id, bool fresh, CancellationToken cancellationToken)
    {
        if (store.FindConnection(id) is not { Connection: var connection }) return new ProbeResult(id, "unknown", Error: "No such connection");
        ProbeTarget? target;
        try
        {
            target = backendFor(connection).ProbeTarget(connection);
        }
        catch (RpcException ex)
        {
            return new ProbeResult(id, "unknown", Error: ex.Message);
        }
        if (target is null) return new ProbeResult(id, "unknown");

        var endpoint = EndpointKey(connection);
        if (!fresh && _cache.TryGetValue(id, out var hit) && hit.Endpoint == endpoint && time.GetUtcNow() - hit.At < CacheFor) return hit.Result;

        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        limit.CancelAfter(_timeout);
        var started = Stopwatch.GetTimestamp();
        ProbeResult result;
        try
        {
            await probe.ProbeAsync(target, limit.Token);
            result = new ProbeResult(id, "reachable", Math.Round(Stopwatch.GetElapsedTime(started).TotalMilliseconds, 1));
        }
        catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
        {
            var error = limit.IsCancellationRequested
                ? $"No answer within {_timeout.TotalSeconds.ToString("0.#", CultureInfo.InvariantCulture)} s"
                : NodeErrors.OneLine(ex);
            result = new ProbeResult(id, "unreachable", Error: error);
        }
        _cache[id] = (endpoint, time.GetUtcNow(), result);
        return result;
    }
}
