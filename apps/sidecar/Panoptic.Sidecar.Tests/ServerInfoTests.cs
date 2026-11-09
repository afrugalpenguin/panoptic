using System.Text.Json;
using Azure.Core;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>The connection pane's session, server description and exceptions (docs/connection-pane.md, phase 2).</summary>
public sealed class ServerInfoTests : IDisposable
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

    /// <summary>A backend that only describes: answers from <see cref="Describe"/>, counting calls.</summary>
    private sealed class FakeBackend : IBackend
    {
        public Func<CancellationToken, Task<ServerDescription?>> Describe = _ => Task.FromResult<ServerDescription?>(Sample);
        public int Calls;

        public static readonly ServerDescription Sample = new(
            [new("Product", "Azure SQL Database"), new("Version", "12.0.2000.8", Mono: true)],
            new ServerDatabases(3, 1, [new("Sales_archive", "restoring"), new("Ledger", "suspect", Error: true)]));

        public Task<ServerDescription?> DescribeServerAsync(ConnectionConfig connection, string? secret, CancellationToken ct)
        {
            Interlocked.Increment(ref Calls);
            return Describe(ct);
        }

        public Task<TreeNode[]> ChildrenAsync(ConnectionConfig c, string? s, NodePath p, int start, CancellationToken ct) => throw new NotSupportedException();
        public Task TestAsync(ConnectionConfig c, string? s, CancellationToken ct) => throw new NotSupportedException();
        public void Forget(string connectionId) { }
        KindDescription IBackend.Describe(string kind) =>
            new(kind, "Fake", "Server", "", [new("sql", "SQL login")], new KindBadge("F", "#000", "Fake"), new ConnectionFields(true, false, false, false));
    }

    private static readonly ConnectionConfig Orders = new("c1", "orders", ConnectionKinds.Sql, "orders.fabrikam.test", AuthKinds.Sql, User: "report_reader");

    private (ServerInfoService Service, SessionLog Sessions, FakeBackend Backend, List<string> Updated, Clock Clock) Service()
    {
        var store = new ConfigStore(Path.Combine(_dir, "store.bin"));
        store.SaveConnection(null, Orders, "pw");
        var clock = new Clock();
        var sessions = new SessionLog(clock);
        var backend = new FakeBackend();
        var updated = new List<string>();
        var service = new ServerInfoService(store, _ => backend, sessions, clock, id => { lock (updated) updated.Add(id); });
        return (service, sessions, backend, updated, clock);
    }

    private static async Task Until(Func<bool> done)
    {
        for (var i = 0; i < 200 && !done(); i++) await Task.Delay(10);
        Assert.True(done(), "timed out waiting");
    }

    // --- Sessions ----------------------------------------------------------------------------------

    [Fact]
    public void The_first_open_starts_a_session_and_later_opens_only_refresh_who_and_the_token()
    {
        var clock = new Clock();
        var sessions = new SessionLog(clock);
        var first = new List<string>();
        sessions.FirstOpen += first.Add;

        sessions.Opened(Orders, 184.26, "report_reader", "SQL login");
        clock.Now = clock.Now.AddMinutes(2);
        sessions.Opened(Orders, 0.4, "report_reader", "SQL login", clock.Now.AddMinutes(50));

        Assert.Equal(["c1"], first);
        var session = sessions.Get("c1")!;
        Assert.Equal(new DateTimeOffset(2026, 11, 9, 12, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds(), session.OpenedAt);
        Assert.Equal(184.3, session.HandshakeMs);
        Assert.Equal(clock.Now.AddMinutes(50).ToUnixTimeMilliseconds(), session.TokenExpiresAt);

        sessions.Forget("c1");
        Assert.Null(sessions.Get("c1"));
        sessions.Opened(Orders, 90, "report_reader", "SQL login");
        Assert.Equal(["c1", "c1"], first);
    }

    [Fact]
    public void Entra_identity_is_the_token_user_or_a_service_principal()
    {
        static string Jwt(string payload) =>
            $"e30.{Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payload)).TrimEnd('=').Replace('+', '-').Replace('/', '_')}.sig";
        Assert.Equal("ana@fabrikam.example", SessionLog.EntraIdentity(new AccessToken(Jwt("""{"upn":"ana@fabrikam.example"}"""), DateTimeOffset.UtcNow)));
        Assert.Equal("service principal", SessionLog.EntraIdentity(new AccessToken(Jwt("""{"appid":"11111111-2222-3333-4444-555555555555"}"""), DateTimeOffset.UtcNow)));
    }

    // --- Describe and cache ------------------------------------------------------------------------

    [Fact]
    public async Task Nothing_is_described_or_opened_before_a_session_and_Refresh_does_not_open_one()
    {
        var (service, _, backend, _, _) = Service();

        var state = await service.GetAsync("c1", refresh: true, CancellationToken.None);

        Assert.Null(state.Session);
        Assert.Null(state.About);
        Assert.Empty(state.Exceptions);
        Assert.Equal(0, backend.Calls);
    }

    [Fact]
    public async Task The_first_session_describes_the_server_once_in_the_background_and_says_so()
    {
        var (service, sessions, backend, updated, _) = Service();

        sessions.Opened(Orders, 120, "report_reader", "SQL login");
        await Until(() => updated.Count == 1);
        sessions.Opened(Orders, 1, "report_reader", "SQL login");

        var state = await service.GetAsync("c1", refresh: false, CancellationToken.None);
        Assert.Equal(1, backend.Calls);
        Assert.Equal(["c1"], updated);
        Assert.Equal("report_reader", state.Session!.Identity);
        Assert.Equal(FakeBackend.Sample.Facts, state.About);
        Assert.NotNull(state.DescribedAt);
        Assert.Equal(3, state.Databases!.Total);
        // Worst first, then by name; each says what state it is in.
        Assert.Equal(
            [new ServerException("error", "database", "Ledger", "is suspect"), new ServerException("warn", "database", "Sales_archive", "is restoring")],
            state.Exceptions);
    }

    [Fact]
    public async Task Refresh_describes_again_and_waits_for_it()
    {
        var (service, sessions, backend, updated, _) = Service();
        sessions.Opened(Orders, 120, "report_reader", "SQL login");
        await Until(() => updated.Count == 1);

        backend.Describe = _ => Task.FromResult<ServerDescription?>(new ServerDescription([new("Product", "SQL Server 2022")]));
        var state = await service.GetAsync("c1", refresh: true, CancellationToken.None);

        Assert.Equal(2, backend.Calls);
        Assert.Equal("SQL Server 2022", state.About![0].Value);
        Assert.Null(state.Databases);
        Assert.Empty(state.Exceptions);
    }

    [Fact]
    public async Task A_failed_describe_is_reported_and_keeps_what_was_read_before()
    {
        var (service, sessions, backend, updated, _) = Service();
        sessions.Opened(Orders, 120, "report_reader", "SQL login");
        await Until(() => updated.Count == 1);

        backend.Describe = _ => throw new RpcException(RpcException.InvalidParams, "VIEW SERVER STATE permission was denied");
        var state = await service.GetAsync("c1", refresh: true, CancellationToken.None);

        Assert.Equal("VIEW SERVER STATE permission was denied", state.AboutError);
        Assert.Equal(FakeBackend.Sample.Facts, state.About);
    }

    [Fact]
    public async Task A_changed_connection_is_forgotten_and_a_describe_still_running_for_it_is_dropped()
    {
        var (service, sessions, backend, updated, _) = Service();
        var release = new TaskCompletionSource<ServerDescription?>();
        backend.Describe = _ => release.Task;
        sessions.Opened(Orders, 120, "report_reader", "SQL login");
        await Until(() => backend.Calls == 1);

        service.Forget("c1");
        release.SetResult(FakeBackend.Sample);
        await Task.Delay(50);

        var state = service.State("c1");
        Assert.Null(state.Session);
        Assert.Null(state.About);
        Assert.Empty(updated);
    }

    [Fact]
    public async Task An_open_for_a_connection_that_is_not_saved_is_never_described()
    {
        var (_, sessions, backend, updated, _) = Service();
        sessions.Opened(Orders with { Id = "unsaved-test" }, 120, "report_reader", "SQL login");
        await Task.Delay(50);
        Assert.Equal(0, backend.Calls);
        Assert.Empty(updated);
    }

    [Fact]
    public async Task Rpc_answers_connection_server_in_camel_case()
    {
        var store = new ConfigStore(Path.Combine(_dir, "store.bin"));
        store.SaveConnection(null, Orders, "pw");
        var sessions = new SessionLog(new Clock());
        var backend = new FakeBackend();
        var updated = new List<string>();
        var service = new ServerInfoService(store, _ => backend, sessions, new Clock(), updated.Add);
        var tree = new TreeService(store, BackendRegistry.Create(new Credentials(_ => { })));
        var sidecar = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(1, "0.1.0", "test"), store, tree, server: service));
        sessions.Opened(Orders, 120, "report_reader", "SQL login");
        await Until(() => updated.Count == 1);

        var response = JsonDocument.Parse((await sidecar.HandleAsync("""{"jsonrpc":"2.0","id":1,"method":"connection.server","params":{"connectionId":"c1"}}"""))!).RootElement;
        var result = response.GetProperty("result");

        Assert.Equal("report_reader", result.GetProperty("session").GetProperty("identity").GetString());
        Assert.Equal(120, result.GetProperty("session").GetProperty("handshakeMs").GetDouble());
        Assert.Equal("Product", result.GetProperty("about")[0].GetProperty("label").GetString());
        Assert.Equal("Ledger", result.GetProperty("exceptions")[0].GetProperty("subject").GetString());

        // Saving the connection forgets its session: the pane shows not connected until it opens again.
        await sidecar.HandleAsync("""{"jsonrpc":"2.0","id":2,"method":"config.saveConnection","params":{"environmentId":null,"connection":{"id":"c1","name":"orders","kind":"sql","endpoint":"orders-2.fabrikam.test","auth":"sql","user":"report_reader","trustServerCertificate":false}}}""");
        var after = JsonDocument.Parse((await sidecar.HandleAsync("""{"jsonrpc":"2.0","id":3,"method":"connection.server","params":{"connectionId":"c1"}}"""))!).RootElement;
        Assert.False(after.GetProperty("result").TryGetProperty("session", out _));
    }

    // --- What each backend's describe reads into ---------------------------------------------------

    [Theory]
    [InlineData(5, "12.0.2000.8", "Azure SQL Database")]
    [InlineData(8, "16.0.4165.4", "Azure SQL Managed Instance")]
    [InlineData(11, "12.0.2000.8", "Azure Synapse serverless SQL pool")]
    [InlineData(6, "10.0.15665.0", "Azure Synapse dedicated SQL pool")]
    [InlineData(3, "16.0.4165.4", "SQL Server 2022")]
    [InlineData(2, "15.0.4385.2", "SQL Server 2019")]
    [InlineData(3, "99.0.1.1", "SQL Server")]
    [InlineData(null, null, "SQL Server")]
    public void Sql_names_the_product_from_its_engine_edition_or_version(int? engineEdition, string? version, string product)
    {
        Assert.Equal(product, SqlServerFacts.Product(engineEdition, version));
    }

    [Fact]
    public void Sql_facts_are_in_order_with_the_pool_for_serverless_and_missing_ones_left_out()
    {
        var at = new DateTimeOffset(2026, 11, 9, 16, 42, 7, TimeSpan.FromHours(4));
        var azure = SqlServerFacts.Facts(new("12.0.2000.8", "RTM", "General Purpose", 5, "SQL_Latin1_General_CP1_CI_AS", "GP_S_Gen5_4", at));
        Assert.Equal(
            [
                new ServerFact("Product", "Azure SQL Database"),
                new ServerFact("Version", "12.0.2000.8", "RTM", Mono: true),
                new ServerFact("Edition", "General Purpose", "GP_S_Gen5_4"),
                new ServerFact("Collation", "SQL_Latin1_General_CP1_CI_AS", Mono: true),
                new ServerFact("Server time", "2026-11-09 12:42:07 UTC", "at connect", Mono: true),
            ],
            azure);

        var serverless = SqlServerFacts.Facts(new("12.0.2000.8", null, "SQL Data Warehouse", 11, null, null, null));
        Assert.Equal(["Product", "Version", "Pool"], serverless.Select(f => f.Label));
        Assert.Equal("built-in serverless", serverless[2].Value);
    }

    [Fact]
    public void Sql_counts_databases_and_words_the_ones_that_are_not_online()
    {
        var databases = SqlServerFacts.Databases([("master", "ONLINE"), ("Sales", "ONLINE"), ("Sales_archive", "RESTORING"), ("Ledger", "RECOVERY_PENDING"), ("Old", "OFFLINE")]);
        Assert.Equal(5, databases.Total);
        Assert.Equal(2, databases.Online);
        Assert.Equal(
            [new DatabaseState("Sales_archive", "restoring"), new DatabaseState("Ledger", "recovery pending", Error: true), new DatabaseState("Old", "offline")],
            databases.NotOnline);
    }

    [Fact]
    public void Postgres_reads_its_product_and_flags_databases_that_take_no_connections_or_are_invalid()
    {
        Assert.Equal("PostgreSQL 16.4", PostgresFacts.Product("PostgreSQL 16.4 on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14) 12.2.0, 64-bit"));
        Assert.Equal("PostgreSQL 17.0", PostgresFacts.Product("PostgreSQL 17.0, compiled by Visual C++ build 1940, 64-bit"));
        Assert.Equal("PostgreSQL", PostgresFacts.Product(null));

        var facts = PostgresFacts.Facts(new("PostgreSQL 16.4 on x86_64", "16.4", "UTF8", "en_US.utf8", "2026-11-09 12:42:07"));
        Assert.Equal(["Product", "Version", "Encoding", "Collation", "Server time"], facts.Select(f => f.Label));
        Assert.Equal("2026-11-09 12:42:07 UTC", facts[4].Value);

        var databases = PostgresFacts.Databases([new("postgres", true, -1), new("orders", true, 50), new("frozen", false, -1), new("half_dropped", false, -2)]);
        Assert.Equal((4, 2), (databases.Total, databases.Online));
        Assert.Equal(
            [new DatabaseState("frozen", "not accepting connections"), new DatabaseState("half_dropped", "invalid (a DROP DATABASE was interrupted)", Error: true)],
            databases.NotOnline);
    }

    [Fact]
    public void Cosmos_lists_write_regions_first_and_each_region_once()
    {
        var facts = CosmosFacts.Facts("fabrikam-docs", "Session", ["UK South"], ["UK South", "North Europe"]);
        Assert.Equal(
            [
                new ServerFact("API", "NoSQL"),
                new ServerFact("Account", "fabrikam-docs", Mono: true),
                new ServerFact("Default consistency", "Session"),
                new ServerFact("Regions", "UK South (write), North Europe"),
            ],
            facts);
    }

    // --- Against the dev databases -----------------------------------------------------------------

    private static readonly Credentials NoEntra = new(_ => throw new InvalidOperationException("Entra not expected in tests"));

    [SqlFact, Trait("Category", "SqlIntegration")]
    public async Task Sql_records_the_session_and_describes_the_server_in_one_quick_round_trip()
    {
        var sessions = new SessionLog(TimeProvider.System);
        var backend = new SqlBackend(NoEntra, sessions);
        var sql = new ConnectionConfig("sql1", "dev sql", ConnectionKinds.Sql, "127.0.0.1,14333", AuthKinds.Sql, User: "sa", TrustServerCertificate: true);

        await backend.TestAsync(sql, SqlFactAttribute.Password, default);
        var session = sessions.Get("sql1")!;
        Assert.Equal("sa", session.Identity);
        Assert.Equal("SQL login", session.AuthMode);
        Assert.True(session.HandshakeMs > 0);

        var warm = System.Diagnostics.Stopwatch.StartNew();
        var description = (await backend.DescribeServerAsync(sql, SqlFactAttribute.Password, default))!;
        warm.Stop();
        Assert.StartsWith("SQL Server", description.Facts[0].Value);
        Assert.Contains(description.Facts, f => f.Label == "Collation");
        Assert.True(description.Databases!.Total >= 4, "master, model, msdb and tempdb at least");
        Assert.True(warm.ElapsedMilliseconds < 200, $"describe took {warm.ElapsedMilliseconds} ms on a warm connection");
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Postgres_records_the_session_and_describes_the_server()
    {
        var sessions = new SessionLog(TimeProvider.System);
        var backend = new PostgresBackend(NoEntra, sessions);
        var pg = new ConnectionConfig("pg1", "dev pg", ConnectionKinds.Postgres, "127.0.0.1:15432", AuthKinds.Password, User: "postgres", TrustServerCertificate: true);

        await backend.TestAsync(pg, PgFactAttribute.Password, default);
        Assert.Equal("postgres", sessions.Get("pg1")!.Identity);

        var description = (await backend.DescribeServerAsync(pg, PgFactAttribute.Password, default))!;
        Assert.StartsWith("PostgreSQL", description.Facts[0].Value);
        Assert.Contains(description.Facts, f => f.Label == "Encoding");
        Assert.True(description.Databases!.Total >= 1);
    }

    [CosmosFact]
    public async Task Cosmos_records_a_session_on_first_use_and_describes_the_account()
    {
        const string key = "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==";
        var sessions = new SessionLog(TimeProvider.System);
        var backend = new CosmosBackend(NoEntra, sessions);
        var cosmos = new ConnectionConfig("cos1", "emulator", ConnectionKinds.Cosmos, "https://localhost:8081/", AuthKinds.Key, TrustServerCertificate: true);

        await backend.ChildrenAsync(cosmos, key, NodePath.Parse("conn:cos1"), 1, default);
        Assert.Equal("account key", sessions.Get("cos1")!.Identity);

        var description = (await backend.DescribeServerAsync(cosmos, key, default))!;
        Assert.Equal("NoSQL", description.Facts[0].Value);
        Assert.Contains(description.Facts, f => f.Label == "Default consistency");
    }
}
