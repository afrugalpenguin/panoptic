using System.Net.Sockets;
using Panoptic.Sidecar.Backends;
using Panoptic.Sidecar.Catalog;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// The connection pane's Catalog tile and its token, probe and catalog exceptions (docs/connection-pane.md, phase 3):
/// all from state the sidecar already holds, no query.
/// </summary>
public sealed class ConnectionPaneCatalogTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static readonly ConnectionConfig Orders = new("c1", "orders", ConnectionKinds.Sql, "orders.fabrikam.test", AuthKinds.Sql, User: "u");
    private static QueryTarget Target(string? database) => new(null, Orders, database, null);
    private static readonly DatabaseCatalog Empty = new("s1", [], [], [], null);

    /// <summary>Builds when released; throws when told to.</summary>
    private sealed class GatedSource : ICatalogSource
    {
        public TaskCompletionSource Gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public string? Fail;

        public Task<string?> StampAsync(QueryTarget target, CancellationToken ct) => Task.FromResult<string?>(null);

        public async Task<DatabaseCatalog> BuildAsync(QueryTarget target, CancellationToken ct)
        {
            await Gate.Task;
            if (Fail is not null) throw new InvalidOperationException(Fail);
            return Empty;
        }
    }

    private static async Task Until(Func<bool> done)
    {
        for (var i = 0; i < 200 && !done(); i++) await Task.Delay(10);
        Assert.True(done(), "timed out waiting");
    }

    // --- Snapshots on disk -------------------------------------------------------------------------

    [Fact]
    public void Counts_a_connections_snapshots_and_dates_the_newest_without_reading_them()
    {
        var cache = new CatalogCache(_dir);
        Assert.Equal((0, (DateTimeOffset?)null), cache.Snapshots("c1"));

        cache.Write(CatalogCache.KeyOf("c1", "Sales"), Empty);
        cache.Write(CatalogCache.KeyOf("c1", "Ledger"), Empty);
        cache.Write(CatalogCache.KeyOf("c2", "Sales"), Empty);
        var newest = new DateTime(2026, 11, 9, 11, 56, 0, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(Directory.EnumerateFiles(_dir).First(f => Path.GetFileName(f).StartsWith(CatalogCache.KeyOf("c1", "Ledger"))), newest);
        File.SetLastWriteTimeUtc(Directory.EnumerateFiles(_dir).First(f => Path.GetFileName(f).StartsWith(CatalogCache.KeyOf("c1", "Sales"))), newest.AddHours(-1));

        var (count, at) = cache.Snapshots("c1");
        Assert.Equal(2, count);
        Assert.Equal(new DateTimeOffset(newest), at);
    }

    // --- Catalog state per connection --------------------------------------------------------------

    [Fact]
    public async Task A_connection_is_cold_then_refreshing_while_it_builds_then_warm_and_each_change_is_signalled()
    {
        var source = new GatedSource();
        var changed = new List<string>();
        var service = new CatalogService(p => Target(p.Database), new CatalogCache(_dir), source, (_, _) => { }, id => { lock (changed) changed.Add(id); });

        Assert.Equal(CatalogStates.Cold, service.Info("c1").State);
        service.Get(new CatalogParams("conn:c1/db:Sales", "Sales"));
        Assert.Equal(CatalogStates.Refreshing, service.Info("c1").State);
        Assert.Equal(CatalogStates.Cold, service.Info("other").State);

        source.Gate.SetResult();
        await Until(() => service.Info("c1").State == CatalogStates.Warm);
        await Until(() => changed.Count == 2);
        Assert.Equal(["c1", "c1"], changed);
        Assert.Equal(1, service.Info("c1").Snapshots);
        Assert.NotNull(service.Info("c1").NewestAt);
    }

    [Fact]
    public async Task A_failed_build_is_kept_by_database_until_one_succeeds()
    {
        var source = new GatedSource { Fail = "Login failed for user 'u'." };
        source.Gate.SetResult();
        var service = new CatalogService(p => Target(p.Database), new CatalogCache(_dir), source, (_, _) => { });

        service.Get(new CatalogParams("conn:c1/db:Sales", "Sales"));
        await Until(() => service.Info("c1").Failures.Count == 1);
        Assert.Equal(new CatalogFailure("Sales", "Login failed for user 'u'."), service.Info("c1").Failures[0]);

        source.Fail = null;
        service.Refresh(new CatalogParams("conn:c1/db:Sales", "Sales"));
        await Until(() => service.Info("c1").Failures.Count == 0);
        Assert.Equal(CatalogStates.Warm, service.Info("c1").State);
    }

    // --- Exceptions --------------------------------------------------------------------------------

    private static SessionInfo Session(DateTimeOffset? tokenExpires) =>
        new(0, 120, "ana.costa@fabrikam.example", "Microsoft Entra ID", tokenExpires?.ToUnixTimeMilliseconds());

    private static readonly DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_token_is_reported_when_it_runs_out_within_five_minutes_or_has_run_out()
    {
        Assert.Empty(ServerInfoService.Exceptions(null, session: Session(Now.AddMinutes(30)), now: Now));
        Assert.Empty(ServerInfoService.Exceptions(null, session: Session(null), now: Now));

        var soon = Assert.Single(ServerInfoService.Exceptions(null, session: Session(Now.AddMinutes(3).AddSeconds(10)), now: Now));
        Assert.Equal(new ServerException("warn", "token", "ana.costa@fabrikam.example", "sign-in token expires in 4 min"), soon);

        var gone = Assert.Single(ServerInfoService.Exceptions(null, session: Session(Now.AddMinutes(-2)), now: Now));
        Assert.Equal("sign-in token expired 2 min ago; the next query signs in again", gone.Detail);
    }

    [Fact]
    public void An_unreachable_probe_with_a_session_is_an_error_listed_first_and_failed_catalogs_are_warnings()
    {
        var catalog = new CatalogInfo(CatalogStates.Cold, 0, null, [new CatalogFailure(null, "timeout")]);
        var databases = new ServerDatabases(2, 1, [new DatabaseState("Sales_archive", "restoring")]);
        var probe = new ProbeResult("c1", "unreachable", Error: "No answer within 2 s");

        var items = ServerInfoService.Exceptions(databases, catalog, Session(null), probe, "orders.fabrikam.test", Now);

        Assert.Equal(
            [
                new ServerException("error", "server", "orders.fabrikam.test", "is not answering while a session is open: No answer within 2 s"),
                new ServerException("warn", "database", "Sales_archive", "is restoring"),
                new ServerException("warn", "catalog", "default database", "IntelliSense catalog did not refresh: timeout"),
            ],
            items);
    }

    [Fact]
    public async Task The_pane_state_carries_the_catalog_and_only_reads_the_probe_while_a_session_is_open()
    {
        var store = new ConfigStore(Path.Combine(_dir, "store.bin"));
        store.SaveConnection(null, Orders, "pw");
        var clock = new Clock();
        var sessions = new SessionLog(clock);
        var unreachable = new ProbeResult("c1", "unreachable", Error: "refused");
        var probed = 0;
        var service = new ServerInfoService(store, _ => new SqlBackend(new Credentials(_ => { })), sessions, clock, _ => { },
            _ => new CatalogInfo(CatalogStates.Warm, 3, 1, []),
            _ => { probed++; return unreachable; });

        var before = await service.GetAsync("c1", refresh: false, CancellationToken.None);
        Assert.Equal(CatalogStates.Warm, before.Catalog!.State);
        Assert.Equal(3, before.Catalog.Snapshots);
        Assert.Empty(before.Exceptions);
        Assert.Equal(0, probed);

        sessions.Opened(Orders, 100, "u", "SQL login");
        var after = service.State("c1");
        Assert.Equal("server", Assert.Single(after.Exceptions).Group);
    }

    // --- The probe's cache, read without probing ---------------------------------------------------

    private sealed class FakeProbe(bool fail) : IProbe
    {
        public Task ProbeAsync(ProbeTarget target, CancellationToken ct) =>
            fail ? Task.FromException(new SocketException((int)SocketError.ConnectionRefused)) : Task.CompletedTask;
    }

    [Fact]
    public async Task Peek_returns_a_fresh_cached_result_for_the_current_endpoint_and_never_probes()
    {
        var store = new ConfigStore(Path.Combine(_dir, "store.bin"));
        store.SaveConnection(null, Orders, "pw");
        var clock = new Clock();
        var probes = new ProbeService(store, _ => new SqlBackend(new Credentials(_ => { })), new FakeProbe(fail: true), clock);

        Assert.Null(probes.Peek("c1"));
        await probes.ProbeAsync(["c1"], fresh: false, CancellationToken.None);
        Assert.Equal("unreachable", probes.Peek("c1")!.Status);

        clock.Now += ProbeService.CacheFor;
        Assert.Null(probes.Peek("c1"));

        clock.Now -= ProbeService.CacheFor;
        store.SaveConnection(null, Orders with { Endpoint = "orders-2.fabrikam.test" }, null);
        Assert.Null(probes.Peek("c1"));
        Assert.Null(probes.Peek("missing"));
    }
}
