using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>Reachability probes for the environment pane (docs/environment-pane.md, "Reachability probes").</summary>
public sealed class ProbeTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    // --- Where each backend probes -----------------------------------------------------------------

    [Theory]
    [InlineData("orders.fabrikam.test", "orders.fabrikam.test", 1433)]
    [InlineData("orders.fabrikam.test,14330", "orders.fabrikam.test", 14330)]
    [InlineData("tcp:orders.fabrikam.test,1433", "orders.fabrikam.test", 1433)]
    [InlineData("TCP:orders.fabrikam.test", "orders.fabrikam.test", 1433)]
    [InlineData("fabrikam-dw.sql.azuresynapse.test", "fabrikam-dw.sql.azuresynapse.test", 1433)]
    [InlineData(".", "localhost", 1433)]
    [InlineData("(local)", "localhost", 1433)]
    [InlineData("localhost\\SQLEXPRESS,50123", "localhost", 50123)]
    [InlineData(" orders.fabrikam.test , 1500 ", "orders.fabrikam.test", 1500)]
    public void Sql_probes_the_server_and_port(string endpoint, string host, int port)
    {
        Assert.Equal(new ProbeTarget(host, port), SqlBackend.ProbeTargetFor(endpoint));
    }

    [Theory]
    [InlineData("localhost\\SQLEXPRESS")] // A named instance's port is only known to SQL Browser.
    [InlineData("(localdb)\\MSSQLLocalDB")]
    [InlineData("np:\\\\orders\\pipe\\sql\\query")]
    [InlineData("lpc:orders")]
    [InlineData("orders.fabrikam.test,notaport")]
    [InlineData("")]
    public void Sql_has_no_target_when_the_port_cannot_be_known_without_signing_in(string endpoint)
    {
        Assert.Null(SqlBackend.ProbeTargetFor(endpoint));
    }

    [Fact]
    public void Postgres_probes_host_and_port_and_cosmos_its_account_uri()
    {
        var registry = BackendRegistry.Create(new Credentials(_ => { }));
        var pg = new ConnectionConfig("p", "p", ConnectionKinds.Postgres, "pg.fabrikam.test:6432", AuthKinds.Sql);
        Assert.Equal(new ProbeTarget("pg.fabrikam.test", 6432), registry[ConnectionKinds.Postgres].ProbeTarget(pg));
        Assert.Equal(new ProbeTarget("pg.fabrikam.test", 5432), registry[ConnectionKinds.Postgres].ProbeTarget(pg with { Endpoint = "pg.fabrikam.test" }));

        var cosmos = new ConnectionConfig("c", "c", ConnectionKinds.Cosmos, "https://fabrikam-docs.documents.example.test:443/", AuthKinds.Entra);
        Assert.Equal(
            new ProbeTarget("fabrikam-docs.documents.example.test", 443, new Uri("https://fabrikam-docs.documents.example.test/")),
            registry[ConnectionKinds.Cosmos].ProbeTarget(cosmos));
        Assert.Null(registry[ConnectionKinds.Cosmos].ProbeTarget(cosmos with { Endpoint = "not a uri" }));
    }

    // --- The service: timeout, cache, parallel ----------------------------------------------------

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class FakeProbe(Func<ProbeTarget, CancellationToken, Task>? run = null) : IProbe
    {
        public readonly List<ProbeTarget> Calls = [];
        public Task ProbeAsync(ProbeTarget target, CancellationToken cancellationToken)
        {
            lock (Calls) Calls.Add(target);
            return run?.Invoke(target, cancellationToken) ?? Task.CompletedTask;
        }
    }

    private ConfigStore Store()
    {
        var store = new ConfigStore(Path.Combine(_dir, "store.bin"));
        store.SaveEnvironment(new EnvironmentConfig("uat", "UAT", "#f08c00", false, []));
        store.SaveConnection("uat", new ConnectionConfig("a", "a", ConnectionKinds.Sql, "uat-a.fabrikam.test", AuthKinds.Sql, User: "u"), "pw");
        store.SaveConnection("uat", new ConnectionConfig("b", "b", ConnectionKinds.Sql, "uat-b.fabrikam.test,1500", AuthKinds.Sql, User: "u"), "pw");
        store.SaveConnection("uat", new ConnectionConfig("named", "named", ConnectionKinds.Sql, "localhost\\SQLEXPRESS", AuthKinds.Sql, User: "u"), "pw");
        return store;
    }

    private ProbeService Service(ConfigStore store, IProbe probe, Clock? clock = null, TimeSpan? timeout = null) =>
        new(store, new TreeService(store, BackendRegistry.Create(new Credentials(_ => { }))).BackendFor, probe, clock ?? new Clock(), timeout);

    [Fact]
    public async Task Reports_reachable_with_the_round_trip_and_unreachable_with_the_reason()
    {
        var probe = new FakeProbe((t, _) => t.Port == 1500 ? Task.FromException(new SocketException((int)SocketError.ConnectionRefused)) : Task.Delay(5));
        var results = await Service(Store(), probe).ProbeAsync(["a", "b"], fresh: false, CancellationToken.None);

        Assert.Equal("reachable", results[0].Status);
        Assert.True(results[0].Ms >= 4, $"ms was {results[0].Ms}");
        Assert.Equal("unreachable", results[1].Status);
        Assert.Null(results[1].Ms);
        Assert.False(string.IsNullOrWhiteSpace(results[1].Error));
    }

    [Fact]
    public async Task No_answer_within_the_timeout_is_unreachable()
    {
        var probe = new FakeProbe((_, ct) => Task.Delay(Timeout.Infinite, ct));
        var result = (await Service(Store(), probe, timeout: TimeSpan.FromMilliseconds(100)).ProbeAsync(["a"], false, CancellationToken.None)).Single();

        Assert.Equal("unreachable", result.Status);
        Assert.Equal("No answer within 0.1 s", result.Error);
    }

    [Fact]
    public async Task Unknown_when_there_is_nowhere_to_probe_or_no_such_connection()
    {
        var probe = new FakeProbe();
        var results = await Service(Store(), probe).ProbeAsync(["named", "gone"], false, CancellationToken.None);

        Assert.Equal(["unknown", "unknown"], results.Select(r => r.Status));
        Assert.Equal(["named", "gone"], results.Select(r => r.ConnectionId));
        Assert.Empty(probe.Calls);
    }

    [Fact]
    public async Task Caches_each_result_for_60_seconds_unless_fresh_or_the_endpoint_changed()
    {
        var store = Store();
        var clock = new Clock();
        var probe = new FakeProbe();
        var service = Service(store, probe, clock);

        await service.ProbeAsync(["a"], false, CancellationToken.None);
        clock.Now += TimeSpan.FromSeconds(59);
        await service.ProbeAsync(["a"], false, CancellationToken.None);
        Assert.Single(probe.Calls);

        await service.ProbeAsync(["a"], fresh: true, CancellationToken.None);
        Assert.Equal(2, probe.Calls.Count);

        clock.Now += TimeSpan.FromSeconds(61);
        await service.ProbeAsync(["a"], false, CancellationToken.None);
        Assert.Equal(3, probe.Calls.Count);

        store.SaveConnection("uat", new ConnectionConfig("a", "a", ConnectionKinds.Sql, "uat-a2.fabrikam.test", AuthKinds.Sql, User: "u"), null);
        await service.ProbeAsync(["a"], false, CancellationToken.None);
        Assert.Equal(4, probe.Calls.Count);
        Assert.Equal("uat-a2.fabrikam.test", probe.Calls[^1].Host);
    }

    [Fact]
    public async Task Probes_every_connection_at_once()
    {
        var both = new TaskCompletionSource();
        var started = 0;
        var probe = new FakeProbe(async (_, ct) =>
        {
            if (Interlocked.Increment(ref started) == 2) both.SetResult();
            // Each waits for the other: only finishes if both were started together.
            await both.Task.WaitAsync(ct);
        });
        var results = await Service(Store(), probe, timeout: TimeSpan.FromSeconds(5)).ProbeAsync(["a", "b"], false, CancellationToken.None);

        Assert.All(results, r => Assert.Equal("reachable", r.Status));
    }

    [Fact]
    public async Task A_cancelled_request_is_cancelled_not_unreachable_and_not_cached()
    {
        var hang = true;
        var probe = new FakeProbe((_, ct) => hang ? Task.Delay(Timeout.Infinite, ct) : Task.CompletedTask);
        var service = Service(Store(), probe);
        using var cts = new CancellationTokenSource(50);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.ProbeAsync(["a"], false, cts.Token));
        hang = false;
        var again = (await service.ProbeAsync(["a"], false, CancellationToken.None)).Single();

        Assert.Equal(2, probe.Calls.Count);
        Assert.Equal("reachable", again.Status);
    }

    // --- The real probe -------------------------------------------------------------------------------

    [Fact]
    public async Task Tcp_connect_succeeds_on_a_listening_port_and_fails_on_a_closed_one()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        await new NetworkProbe().ProbeAsync(new ProbeTarget("127.0.0.1", port), CancellationToken.None);

        listener.Stop();
        await Assert.ThrowsAnyAsync<SocketException>(() => new NetworkProbe().ProbeAsync(new ProbeTarget("127.0.0.1", port), CancellationToken.None));
    }

    [Fact]
    public async Task Head_counts_any_answer_even_an_error_status()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        // A server that answers every request 401, as an account endpoint does without a key.
        var serve = Task.Run(async () =>
        {
            using var client = await listener.AcceptTcpClientAsync();
            var stream = client.GetStream();
            var buffer = new byte[4096];
            // The request's headers arrive in one read on loopback; the reply does not depend on them.
            Assert.True(await stream.ReadAsync(buffer) > 0);
            await stream.WriteAsync("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"u8.ToArray());
        });

        await new NetworkProbe().ProbeAsync(new ProbeTarget("127.0.0.1", port, new Uri($"http://127.0.0.1:{port}/")), CancellationToken.None);
        await serve;
    }

    [Fact]
    public async Task Rpc_probes_by_connection_id_in_camel_case()
    {
        var store = Store();
        var tree = new TreeService(store, BackendRegistry.Create(new Credentials(_ => { })));
        var sidecar = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(1, "0.1.0", "test"), store, tree, probes: Service(store, new FakeProbe())));

        var response = JsonDocument.Parse((await sidecar.HandleAsync("""{"jsonrpc":"2.0","id":1,"method":"connection.probe","params":{"connectionIds":["a","named"],"fresh":true}}"""))!).RootElement;
        var results = response.GetProperty("result");

        Assert.Equal("a", results[0].GetProperty("connectionId").GetString());
        Assert.Equal("reachable", results[0].GetProperty("status").GetString());
        Assert.True(results[0].TryGetProperty("ms", out _));
        Assert.Equal("unknown", results[1].GetProperty("status").GetString());
        Assert.False(results[1].TryGetProperty("ms", out _));
    }
}
