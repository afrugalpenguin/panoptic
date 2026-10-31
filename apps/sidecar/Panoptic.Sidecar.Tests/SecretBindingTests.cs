using System.Text.Json;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// A stored secret belongs to where it was saved for: the connection's kind, endpoint, auth, user and certificate
/// trust. Edit any of those and the stored secret is not sent anywhere; the user has to enter it again.
/// </summary>
public sealed class SecretBindingTests : IDisposable
{
    private const string Kind = "rec";
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");
    private readonly RecordingBackend _backend = new();
    private ConfigStore _store = null!;
    private int _id;

    private static readonly ConnectionConfig Saved = new("c1", "Fabrikam orders", Kind, "orders.fabrikam.test", AuthKinds.Sql, User: "reader");

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    /// <summary>Records the secret each test call receives.</summary>
    private sealed class RecordingBackend : IBackend
    {
        public List<string?> Secrets { get; } = [];

        public Task<TreeNode[]> ChildrenAsync(ConnectionConfig connection, string? secret, NodePath path, int start, CancellationToken ct) =>
            Task.FromResult<TreeNode[]>([]);

        public Task TestAsync(ConnectionConfig connection, string? secret, CancellationToken ct)
        {
            Secrets.Add(secret);
            return Task.CompletedTask;
        }

        public void Forget(string connectionId) { }

        public IReadOnlyList<string> AuthsFor(string kind) => [AuthKinds.Sql, AuthKinds.Key];
    }

    private JsonRpcDispatcher Sidecar()
    {
        _store = new ConfigStore(Path.Combine(_dir, "store.bin"));
        _store.SaveEnvironment(new EnvironmentConfig("prod", "Prod", "#000", true, []));
        _store.SaveConnection("prod", Saved, "stored-password");
        var backends = BackendRegistry.Create(new Credentials(_ => { }));
        backends[Kind] = _backend;
        return new JsonRpcDispatcher(Methods.Create(new SidecarInfo(1, "0.1.0", "test"), _store, new TreeService(_store, backends)));
    }

    private async Task Call(JsonRpcDispatcher sidecar, string method, object parameters)
    {
        var request = JsonSerializer.Serialize(new { jsonrpc = "2.0", id = ++_id, method, @params = parameters }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var response = JsonDocument.Parse((await sidecar.HandleAsync(request))!).RootElement;
        Assert.False(response.TryGetProperty("error", out var error), error.ToString());
    }

    public static TheoryData<string> BoundFields => ["endpoint", "user", "auth", "trust"];

    private static ConnectionConfig Edit(string field) => field switch
    {
        "endpoint" => Saved with { Endpoint = "orders.fabrikam-lookalike.test" },
        "user" => Saved with { User = "someone-else" },
        "auth" => Saved with { Auth = AuthKinds.Key },
        "trust" => Saved with { TrustServerCertificate = true },
        _ => throw new ArgumentOutOfRangeException(nameof(field)),
    };

    [Fact]
    public async Task Test_uses_the_stored_secret_for_the_unchanged_connection()
    {
        var sidecar = Sidecar();

        await Call(sidecar, "connection.test", new { connection = Saved with { Name = "Renamed", Database = "Orders" }, secret = (string?)null });

        Assert.Equal(["stored-password"], _backend.Secrets);
    }

    [Theory, MemberData(nameof(BoundFields))]
    public async Task Test_does_not_send_the_stored_secret_once_a_bound_field_changes(string field)
    {
        var sidecar = Sidecar();

        await Call(sidecar, "connection.test", new { connection = Edit(field), secret = (string?)null });

        Assert.Equal([null], _backend.Secrets);
    }

    [Fact]
    public async Task Save_keeps_the_stored_secret_for_a_rename()
    {
        var sidecar = Sidecar();

        await Call(sidecar, "config.saveConnection", new { environmentId = "prod", connection = Saved with { Name = "Renamed" }, secret = (string?)null });

        Assert.Equal("stored-password", _store.GetSecret("c1"));
    }

    [Theory, MemberData(nameof(BoundFields))]
    public async Task Save_drops_the_stored_secret_once_a_bound_field_changes(string field)
    {
        var sidecar = Sidecar();

        await Call(sidecar, "config.saveConnection", new { environmentId = "prod", connection = Edit(field), secret = (string?)null });

        Assert.Null(_store.GetSecret("c1"));
    }

    [Fact]
    public async Task Save_stores_a_new_secret_given_with_the_edit()
    {
        var sidecar = Sidecar();

        await Call(sidecar, "config.saveConnection", new { environmentId = "prod", connection = Edit("endpoint"), secret = "new-password" });

        Assert.Equal("new-password", _store.GetSecret("c1"));
    }

    [Fact]
    public async Task Connection_nodes_say_when_the_certificate_is_trusted()
    {
        var sidecar = Sidecar();
        _store.SaveConnection("prod", Saved with { Id = "c2", Name = "Trusting", TrustServerCertificate = true }, "pw");

        var request = JsonSerializer.Serialize(new { jsonrpc = "2.0", id = ++_id, method = "tree.children", @params = new { nodeId = "env:prod" } });
        var nodes = JsonDocument.Parse((await sidecar.HandleAsync(request))!).RootElement.GetProperty("result").EnumerateArray().ToList();
        string? Trust(string id) => nodes.Single(n => n.GetProperty("id").GetString() == $"conn:{id}").GetProperty("meta").TryGetProperty("trustServerCertificate", out var v) ? v.GetString() : null;

        Assert.Equal("true", Trust("c2"));
        Assert.Null(Trust("c1"));
    }

    [Theory]
    [InlineData("host")]
    [InlineData("file")]
    public void Changing_the_certificate_host_name_or_file_drops_the_stored_secret(string field)
    {
        // They decide which server is trusted, like Trust server certificate (issue #261).
        Sidecar();

        _store.SaveConnection("prod", field == "host" ? Saved with { CertificateHostName = "orders.fabrikam.test" } : Saved with { CertificateFile = @"C:\certs\other-ca.pem" }, null);

        Assert.Null(_store.GetSecret("c1"));
        Assert.Null(_store.GetSecretFor(Saved with { CertificateHostName = "x.fabrikam.test" }));
    }

    [Fact]
    public void Changing_the_kind_also_drops_the_stored_secret()
    {
        Sidecar();

        _store.SaveConnection("prod", Saved with { Kind = ConnectionKinds.Postgres }, null);

        Assert.Null(_store.GetSecret("c1"));
    }
}
