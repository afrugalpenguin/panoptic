using System.Diagnostics;
using System.Text;
using Npgsql;
using Panoptic.Sidecar.Backends;
using Xunit.Abstractions;

namespace Panoptic.Sidecar.Tests;

public class PostgresNameTests
{
    [Theory]
    [InlineData("customer", "customer")]
    [InlineData("_x1", "_x1")]
    [InlineData("name", "name")] // an unreserved keyword stays bare
    [InlineData("order", "\"order\"")]
    [InlineData("user", "\"user\"")]
    [InlineData("Customer", "\"Customer\"")]
    [InlineData("Order Lines", "\"Order Lines\"")]
    [InlineData("a\"b", "\"a\"\"b\"")]
    [InlineData("1x", "\"1x\"")]
    [InlineData("é", "\"é\"")]
    [InlineData("a$b", "\"a$b\"")]
    public void Names_are_quoted_only_where_postgres_needs_it(string name, string expected) =>
        Assert.Equal(expected, PostgresBackend.QuoteIdentifier(name));

    [Fact]
    public void Qualified_names_quote_each_part_on_its_own() =>
        Assert.Equal("sales.\"Order Lines\"", PostgresBackend.QualifiedName("sales", "Order Lines"));
}

public class PostgresConnectionTests
{
    private static ConnectionConfig Pg(string endpoint = "db.example.com", string auth = AuthKinds.Password, string? database = null, bool trust = false) =>
        new("pg1", "pg", ConnectionKinds.Postgres, endpoint, auth, User: "app", Database: database, TrustServerCertificate: trust);

    [Theory]
    [InlineData("db.example.com", "db.example.com", 5432)]
    [InlineData(" db.example.com:6432 ", "db.example.com", 6432)]
    [InlineData("127.0.0.1:15432", "127.0.0.1", 15432)]
    [InlineData("[::1]:5433", "::1", 5433)]
    [InlineData("[::1]", "::1", 5432)]
    [InlineData("::1", "::1", 5432)]
    public void Endpoints_give_host_and_port(string endpoint, string host, int port) =>
        Assert.Equal((host, port), PostgresBackend.ParseEndpoint(endpoint));

    [Theory]
    [InlineData("")]
    [InlineData("db:0")]
    [InlineData("db:70000")]
    [InlineData("db:abc")]
    [InlineData("db:+5")]
    [InlineData("[::1")]
    [InlineData("[::1]x")]
    [InlineData("my db")]
    public void Unusable_endpoints_are_refused(string endpoint) =>
        Assert.Equal(RpcException.InvalidParams, Assert.Throws<RpcException>(() => PostgresBackend.ParseEndpoint(endpoint)).Code);

    [Fact]
    public void Certificates_are_verified_unless_trusted_and_always_encrypted()
    {
        Assert.Equal(SslMode.VerifyFull, PostgresBackend.Settings(Pg(), null, "app").SslMode);
        Assert.Equal(SslMode.Require, PostgresBackend.Settings(Pg(trust: true), null, "app").SslMode);
    }

    [Fact]
    public void The_database_is_the_node_s_then_the_connection_s_then_postgres()
    {
        Assert.Equal("postgres", PostgresBackend.Settings(Pg(), null, "app").Database);
        Assert.Equal("ledger", PostgresBackend.Settings(Pg(database: "ledger"), null, "app").Database);
        Assert.Equal("orders", PostgresBackend.Settings(Pg(database: "ledger"), "orders", "app").Database);
    }

    [Fact]
    public void The_connection_string_never_holds_a_password()
    {
        var settings = PostgresBackend.Settings(Pg(), null, "app");
        Assert.Null(settings.Password);
        Assert.Equal("Panoptic", settings.ApplicationName);
    }

    private static string Jwt(string payloadJson) =>
        $"e30.{Convert.ToBase64String(Encoding.UTF8.GetBytes(payloadJson)).TrimEnd('=').Replace('+', '-').Replace('/', '_')}.sig";

    [Fact]
    public void The_entra_user_comes_from_the_token_s_upn_then_preferred_username()
    {
        Assert.Equal("ana@example.com", PostgresBackend.EntraUser(Jwt("""{"upn":"ana@example.com","preferred_username":"other"}""")));
        Assert.Equal("bo@example.com", PostgresBackend.EntraUser(Jwt("""{"preferred_username":"bo@example.com"}""")));
        Assert.Equal("cy@example.com", PostgresBackend.EntraUser(Jwt("""{"unique_name":"cy@example.com"}""")));
    }

    [Theory]
    [InlineData("""{"appid":"00000000-0000-0000-0000-000000000000"}""")]
    [InlineData("""{"upn":""}""")]
    public void A_token_without_a_user_name_gives_none(string payload) =>
        Assert.Null(PostgresBackend.EntraUser(Jwt(payload)));

    [Theory]
    [InlineData("not a token")]
    [InlineData("a.!!!.c")]
    [InlineData("a.bm90IGpzb24.c")] // "not json"
    public void A_malformed_token_gives_none(string token) =>
        Assert.Null(PostgresBackend.EntraUser(token));
}

public class PostgresErrorTests
{
    private static readonly ConnectionConfig Password = new("pg1", "pg", ConnectionKinds.Postgres, "db.example.com", AuthKinds.Password, User: "app");
    private static readonly ConnectionConfig Entra = Password with { Auth = AuthKinds.Entra, User = "ana@example.com" };

    [Fact]
    public void A_failed_password_says_to_check_it()
    {
        var e = PostgresErrors.Map("28P01", "password authentication failed for user \"app\"", Password, "orders");
        Assert.Equal("Sign-in failed. Check the user name and password.", e.Summary);
        Assert.Equal("28P01", e.Code);
        Assert.False(e.Retryable);
        Assert.Contains("Identity: User app", e.Detail);
        Assert.Contains("Database: orders", e.Detail);
    }

    [Fact]
    public void A_failed_entra_sign_in_points_at_the_role() =>
        Assert.Equal(PostgresErrors.EntraSignInFailed, PostgresErrors.Map("28P01", "password authentication failed", Entra, null).Summary);

    [Fact]
    public void Network_failures_are_retryable()
    {
        var e = PostgresErrors.Map(null, "No such host is known.", Password, null);
        Assert.Equal(PostgresErrors.Unreachable, e.Summary);
        Assert.Equal("network", e.Code);
        Assert.True(e.Retryable);
    }

    [Fact]
    public void An_unmapped_state_keeps_the_server_s_message_and_its_code()
    {
        var e = PostgresErrors.Map("XX000", "internal error in widget", Password, null);
        Assert.Equal("internal error in widget", e.Summary);
        Assert.Equal("XX000", e.Code);
    }

    [Theory]
    [InlineData("3D000", false)]
    [InlineData("42501", false)]
    [InlineData("57P03", true)]
    [InlineData("53300", true)]
    public void Mapped_states_carry_their_retryability(string state, bool retryable) =>
        Assert.Equal(retryable, PostgresErrors.Map(state, "x", Password, null).Retryable);
}

public sealed class ConnectionAuthTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-auth-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private static ConnectionConfig Of(string kind, string auth) => new("c1", "c", kind, "host", auth);

    private static TreeService Tree(ConfigStore? store = null) =>
        new(store ?? null!, BackendRegistry.Create(new Credentials(_ => { })));

    [Theory]
    [InlineData(ConnectionKinds.Postgres, AuthKinds.Entra)]
    [InlineData(ConnectionKinds.Postgres, AuthKinds.Password)]
    [InlineData(ConnectionKinds.Sql, AuthKinds.Entra)]
    [InlineData(ConnectionKinds.Sql, AuthKinds.Sql)]
    [InlineData(ConnectionKinds.Sql, AuthKinds.Windows)]
    [InlineData(ConnectionKinds.Synapse, AuthKinds.Entra)]
    [InlineData(ConnectionKinds.Synapse, AuthKinds.Sql)]
    [InlineData(ConnectionKinds.Cosmos, AuthKinds.Entra)]
    [InlineData(ConnectionKinds.Cosmos, AuthKinds.Key)]
    public void Supported_pairs_pass(string kind, string auth) => Tree().Validate(Of(kind, auth));

    [Theory]
    [InlineData(ConnectionKinds.Postgres, AuthKinds.Sql)]
    [InlineData(ConnectionKinds.Postgres, AuthKinds.Windows)]
    [InlineData(ConnectionKinds.Postgres, AuthKinds.Key)]
    [InlineData(ConnectionKinds.Sql, AuthKinds.Password)]
    [InlineData(ConnectionKinds.Synapse, AuthKinds.Windows)]
    [InlineData(ConnectionKinds.Cosmos, AuthKinds.Sql)]
    [InlineData("mysql", AuthKinds.Password)]
    public void Anything_else_is_refused(string kind, string auth) =>
        Assert.Equal(RpcException.InvalidParams, Assert.Throws<RpcException>(() => Tree().Validate(Of(kind, auth))).Code);

    [Fact]
    public async Task Saving_or_testing_an_unsupported_pair_is_refused_and_nothing_is_stored()
    {
        if (!OperatingSystem.IsWindows()) return; // the store uses DPAPI
        var store = new ConfigStore(Path.Combine(_dir, "store.bin"));
        store.SaveEnvironment(new EnvironmentConfig("e", "Lab", "#000", false, []));
        var sidecar = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(1, "0.1.0", "test"), store, Tree(store)));
        var connection = new { id = "c1", name = "c", kind = ConnectionKinds.Postgres, endpoint = "host", auth = AuthKinds.Sql };

        foreach (var (method, parameters) in new (string, object)[]
                 {
                     ("config.saveConnection", new { environmentId = "e", connection, secret = "pw" }),
                     ("connection.test", new { connection, secret = "pw" }),
                 })
        {
            var request = System.Text.Json.JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method, @params = parameters });
            var response = System.Text.Json.JsonDocument.Parse((await sidecar.HandleAsync(request))!).RootElement;
            Assert.Equal(RpcException.InvalidParams, response.GetProperty("error").GetProperty("code").GetInt32());
        }
        Assert.Empty(store.Config.Environments.Single().Connections);
        Assert.Null(store.GetSecret("c1"));
    }
}

/// <summary>Against the dev Postgres from scripts/dev-db.ps1 (seeded from docker/seed-postgres.sql).</summary>
public class PostgresIntegrationTests(ITestOutputHelper output)
{
    private static readonly Credentials NoEntra = new(_ => throw new InvalidOperationException("Entra not expected in tests"));

    private static ConnectionConfig DevPg => new("pg1", "dev pg", ConnectionKinds.Postgres, "127.0.0.1:15432", AuthKinds.Password,
        User: "postgres", TrustServerCertificate: true);

    private async Task<TreeNode[]> Expand(PostgresBackend backend, ConnectionConfig c, NodePath path, string? secret = null)
    {
        var sw = Stopwatch.StartNew();
        var nodes = await backend.ChildrenAsync(c, secret ?? PgFactAttribute.Password, path, 2, CancellationToken.None);
        output.WriteLine($"{path}: {nodes.Length} nodes in {sw.ElapsedMilliseconds} ms");
        return nodes;
    }

    private static NodePath Root => NodePath.Parse("env:dev/conn:pg1");

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Tree_walks_from_databases_to_columns_keys_and_indexes()
    {
        var backend = new PostgresBackend(NoEntra);

        var dbs = await Expand(backend, DevPg, Root);
        Assert.Equal(["inventory", "orders", "postgres"], dbs.Select(d => d.Label));
        Assert.Equal("true", dbs[^1].Meta!["system"]);
        Assert.Equal("false", dbs[0].Meta!["system"]);

        var orders = NodePath.Parse(dbs.Single(n => n.Label == "orders").Id);
        Assert.Equal(["Tables", "Views", "Materialized views", "Functions", "Procedures", "Sequences"],
            (await Expand(backend, DevPg, orders)).Select(f => f.Label));

        var tables = await Expand(backend, DevPg, orders.Child("f", "tables"));
        Assert.True(tables.Length > 150);
        Assert.Contains(tables, t => t.Label == "audit.change_log");
        Assert.DoesNotContain(tables, t => t.Label.StartsWith("audit.change_log_", StringComparison.Ordinal));
        Assert.DoesNotContain(tables, t => t.Label.StartsWith("pg_catalog.", StringComparison.Ordinal) || t.Label.StartsWith("information_schema.", StringComparison.Ordinal));
        Assert.Equal("sales.\"Order Lines\"", tables.Single(t => t.Label == "sales.Order Lines").Meta!["copyText"]);

        var order = tables.Single(t => t.Label == "sales.order");
        Assert.Equal("sales.\"order\"", order.Meta!["copyText"]);
        var orderPath = NodePath.Parse(order.Id);

        var columns = await Expand(backend, DevPg, orderPath.Child("f", "columns"));
        Assert.Equal(
            ["order_id (PK, bigint, identity, not null)", "customer_id (integer, not null)", "status (sales.order_status, not null)",
             "placed_utc (timestamp with time zone, not null)", "total (numeric(18,2), not null)"],
            columns.Select(c => c.Label));

        var keys = await Expand(backend, DevPg, orderPath.Child("f", "keys"));
        Assert.Equal(["order_pkey (primary key)", "fk_order_customer (foreign key)"], keys.Select(k => k.Label));

        var indexes = await Expand(backend, DevPg, orderPath.Child("f", "indexes"));
        Assert.Equal(["ix_order_customer (btree)", "order_pkey (unique, btree)"], indexes.Select(i => i.Label));

        var lines = NodePath.Parse(tables.Single(t => t.Label == "sales.Order Lines").Id);
        var lineColumns = await Expand(backend, DevPg, lines.Child("f", "columns"));
        Assert.Equal("\"UnitPrice\"", lineColumns.Single(c => c.Meta!["name"] == "UnitPrice").Meta!["copyText"]);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Views_routines_and_sequences_are_listed()
    {
        var backend = new PostgresBackend(NoEntra);
        var orders = Root.Child("db", "orders");

        Assert.Equal(["sales.open_orders"], (await Expand(backend, DevPg, orders.Child("f", "views"))).Select(v => v.Label));

        var matview = Assert.Single(await Expand(backend, DevPg, orders.Child("f", "matviews")));
        Assert.Equal("sales.daily_totals", matview.Label);
        var matviewPath = NodePath.Parse(matview.Id);
        Assert.Equal(["Columns", "Indexes"], (await Expand(backend, DevPg, matviewPath)).Select(f => f.Label));
        Assert.Equal(["ix_daily_totals_day (btree)"], (await Expand(backend, DevPg, matviewPath.Child("f", "indexes"))).Select(i => i.Label));

        var functions = await Expand(backend, DevPg, orders.Child("f", "functions"));
        Assert.Equal(["public.order_count(p_customer_id integer)", "public.order_count(p_customer_id integer, p_status sales.order_status)"],
            functions.Select(f => f.Label));
        Assert.Equal(2, functions.Select(f => f.Id).Distinct().Count());
        Assert.All(functions, f => Assert.Equal("public.order_count", f.Meta!["copyText"]));

        Assert.Equal(["sales.close_order(IN p_order_id bigint)"], (await Expand(backend, DevPg, orders.Child("f", "procs"))).Select(p => p.Label));

        // Not the identity columns' own sequences.
        var sequence = Assert.Single(await Expand(backend, DevPg, orders.Child("f", "sequences")));
        Assert.Equal("sales.invoice_no", sequence.Label);
        Assert.False(sequence.HasChildren);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task A_connection_restricted_to_one_database_lists_only_that_one()
    {
        var c = DevPg with { Database = "inventory" };
        var dbs = await Expand(new PostgresBackend(NoEntra), c, Root);
        Assert.Equal(["inventory"], dbs.Select(d => d.Label));
        var tables = await Expand(new PostgresBackend(NoEntra), c, NodePath.Parse(dbs[0].Id).Child("f", "tables"));
        Assert.Equal(["public.stock", "public.warehouse"], tables.Select(t => t.Label));
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task A_wrong_password_is_a_sign_in_error()
    {
        var ex = await Assert.ThrowsAsync<RpcException>(() => Expand(new PostgresBackend(NoEntra), DevPg, Root, secret: "wrong"));
        Assert.Equal("28P01", ex.NodeError!.Code);
        Assert.False(ex.NodeError.Retryable);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task An_unknown_database_says_so()
    {
        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            new PostgresBackend(NoEntra).TestAsync(DevPg with { Database = "no_such_db" }, PgFactAttribute.Password, CancellationToken.None));
        Assert.Equal("3D000", ex.NodeError!.Code);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task A_closed_port_is_unreachable_and_retryable()
    {
        var ex = await Assert.ThrowsAsync<RpcException>(() => Expand(new PostgresBackend(NoEntra), DevPg with { Endpoint = "127.0.0.1:1" }, Root));
        Assert.Equal("network", ex.NodeError!.Code);
        Assert.True(ex.NodeError.Retryable);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task An_unverifiable_certificate_is_refused_unless_trusted()
    {
        // The dev server's certificate is self-signed, so verification has to fail.
        var ex = await Assert.ThrowsAsync<RpcException>(() => Expand(new PostgresBackend(NoEntra), DevPg with { TrustServerCertificate = false }, Root));
        Assert.Equal("tls", ex.NodeError!.Code);
        Assert.Equal(PostgresErrors.Untrusted, ex.NodeError.Summary);
        Assert.False(ex.NodeError.Retryable);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Forget_drops_the_cached_data_source_so_a_new_password_is_used()
    {
        var backend = new PostgresBackend(NoEntra);
        await Expand(backend, DevPg, Root);
        backend.Forget(DevPg.Id);
        await Assert.ThrowsAsync<RpcException>(() => Expand(backend, DevPg, Root, secret: "wrong"));
    }

    /// <summary>The quoting rule and keyword list agree with the server's own quote_ident on every name tried.</summary>
    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Quoting_matches_quote_ident()
    {
        string[] names = ["customer", "Customer", "order", "user", "name", "a\"b", "_x1", "1x", "é", "a$b", "Order Lines", "select", "json", "value", ""];
        await using var source = NpgsqlDataSource.Create(PostgresBackend.Settings(DevPg, null, "postgres").ConnectionString + $";Password={PgFactAttribute.Password}");
        await using var conn = await source.OpenConnectionAsync();

        var all = names.Concat(PostgresKeywords.All).ToArray();
        await using var cmd = new NpgsqlCommand("SELECT quote_ident(n) FROM unnest($1::text[]) WITH ORDINALITY AS t(n, i) ORDER BY i", conn);
        cmd.Parameters.Add(new NpgsqlParameter { Value = all });
        var expected = new List<string>();
        await using (var reader = await cmd.ExecuteReaderAsync())
            while (await reader.ReadAsync()) expected.Add(reader.GetString(0));
        Assert.Equal(expected, all.Select(PostgresBackend.QuoteIdentifier));

        await using var keywords = new NpgsqlCommand("SELECT word FROM pg_get_keywords() WHERE catcode <> 'U' ORDER BY word", conn);
        var words = new List<string>();
        await using (var reader = await keywords.ExecuteReaderAsync())
            while (await reader.ReadAsync()) words.Add(reader.GetString(0));
        Assert.Equal(words, PostgresKeywords.All);
    }
}
