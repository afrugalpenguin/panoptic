using System.Text.Json;
using Panoptic.Sidecar.Backends;
using Panoptic.Sidecar.Backup;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Export and import of saved connections as one file (#28, ADR 0008): environments and connections, never secrets,
/// merged on import with duplicates skipped.
/// </summary>
public sealed class ConnectionBackupTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");

    public ConnectionBackupTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private string P(string name) => Path.Combine(_dir, name);

    private ConfigStore Store(string name) => new(P(name));

    private static TreeService Tree(ConfigStore store) => new(store, BackendRegistry.Create(new Credentials(_ => { })));

    // Synthetic names only.
    private static ConnectionConfig Sql(string id, string endpoint, string? user = "reader") =>
        new(id, $"{endpoint} ({id})", ConnectionKinds.Sql, endpoint, AuthKinds.Sql, User: user);

    /// <summary>Prod (read-only) with two SQL connections, an empty Sandbox, and a Postgres connection in none.</summary>
    private ConfigStore Source()
    {
        var store = Store("source.bin");
        store.SaveEnvironment(new EnvironmentConfig("prod", "Prod", "#e03131", true, []));
        store.SaveEnvironment(new EnvironmentConfig("sbx", "Sandbox", "#0c8599", false, []));
        store.SaveConnection("prod", Sql("a", "orders.example.test"), "s3cret-password");
        store.SaveConnection("prod", Sql("b", "billing.example.test"), "another-secret");
        store.SaveConnection(null, new ConnectionConfig("c", "Reports", ConnectionKinds.Postgres, "reports.example.test", AuthKinds.Entra, Database: "reports"), null);
        return store;
    }

    [Fact]
    public void Export_writes_environments_and_connections_but_no_ids_or_secrets()
    {
        var file = P("backup.json");

        var result = ConnectionBackup.Export(Source(), file);

        Assert.Equal(new BackupExportResult(2, 3), result);
        var text = File.ReadAllText(file);
        Assert.DoesNotContain("s3cret-password", text);
        Assert.DoesNotContain("another-secret", text);
        var root = JsonDocument.Parse(text).RootElement;
        Assert.Equal("panoptic.connections", root.GetProperty("format").GetString());
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        var prod = root.GetProperty("environments")[0];
        Assert.Equal(("Prod", "#e03131", true), (prod.GetProperty("name").GetString(), prod.GetProperty("color").GetString(), prod.GetProperty("readOnly").GetBoolean()));
        Assert.Equal(2, prod.GetProperty("connections").GetArrayLength());
        Assert.False(prod.GetProperty("connections")[0].TryGetProperty("id", out _));
        Assert.Equal("Reports", root.GetProperty("connections")[0].GetProperty("name").GetString());
    }

    [Fact]
    public void Read_refuses_a_file_that_is_not_a_backup_or_is_from_a_newer_version()
    {
        File.WriteAllText(P("other.json"), """{"hello": "world"}""");
        File.WriteAllText(P("newer.json"), """{"format": "panoptic.connections", "version": 2, "environments": [], "connections": []}""");
        File.WriteAllText(P("broken.json"), "{ not json");

        Assert.Contains("not a Panoptic connections backup", Assert.Throws<RpcException>(() => ConnectionBackup.Read(P("other.json"))).Message);
        Assert.Contains("newer version", Assert.Throws<RpcException>(() => ConnectionBackup.Read(P("newer.json"))).Message);
        Assert.Contains("not a Panoptic connections backup", Assert.Throws<RpcException>(() => ConnectionBackup.Read(P("broken.json"))).Message);
        Assert.Contains("full path", Assert.Throws<RpcException>(() => ConnectionBackup.Read("backup.json")).Message);
    }

    [Fact]
    public void Preview_into_an_empty_store_offers_everything()
    {
        var file = P("backup.json");
        ConnectionBackup.Export(Source(), file);
        var target = Store("target.bin");

        var preview = ConnectionBackup.Preview(target, Tree(target), ConnectionBackup.Read(file));

        Assert.Equal(["Prod", "Sandbox"], preview.Environments.Select(e => e.Name));
        Assert.All(preview.Environments, e => Assert.False(e.Exists));
        Assert.Equal([0, 1, 2], preview.Connections.Select(c => c.Index));
        Assert.Equal(["Prod", "Prod", null], preview.Connections.Select(c => c.Environment));
        Assert.All(preview.Connections, c => Assert.Null(c.Skip));
    }

    [Fact]
    public void Preview_marks_environments_that_exist_and_connections_already_added()
    {
        var file = P("backup.json");
        ConnectionBackup.Export(Source(), file);
        var target = Store("target.bin");
        target.SaveEnvironment(new EnvironmentConfig("mine", "PROD", "#000000", false, []));
        target.SaveConnection(null, Sql("x", "orders.example.test"), "pw");

        var preview = ConnectionBackup.Preview(target, Tree(target), ConnectionBackup.Read(file));

        Assert.True(preview.Environments.Single(e => e.Name == "Prod").Exists);
        Assert.Contains("orders.example.test (x)", preview.Connections[0].Skip);
        Assert.Null(preview.Connections[1].Skip);
    }

    [Fact]
    public void Preview_skips_a_kind_or_sign_in_this_version_does_not_have()
    {
        var file = P("future.json");
        File.WriteAllText(file, """
            {"format": "panoptic.connections", "version": 1, "environments": [], "connections": [
              {"name": "Cache", "kind": "redis", "endpoint": "cache.example.test", "auth": "password"},
              {"name": "Orders", "kind": "sql", "endpoint": "orders.example.test", "auth": "kerberos"}
            ]}
            """);
        var target = Store("target.bin");

        var preview = ConnectionBackup.Preview(target, Tree(target), ConnectionBackup.Read(file));

        Assert.Contains("redis", preview.Connections[0].Skip);
        Assert.Contains("sign-in", preview.Connections[1].Skip);
    }

    [Fact]
    public void Import_adds_the_chosen_connections_merging_environments_by_name()
    {
        var file = P("backup.json");
        ConnectionBackup.Export(Source(), file);
        var target = Store("target.bin");
        target.SaveEnvironment(new EnvironmentConfig("mine", "prod", "#000000", false, []));

        var result = ConnectionBackup.Import(target, Tree(target), ConnectionBackup.Read(file), [1, 2]);

        Assert.Equal(new BackupImportResult(1, 2, 0), result);
        var mine = target.Config.Environments.Single(e => e.Id == "mine");
        Assert.Equal(["billing.example.test"], mine.Connections.Select(c => c.Endpoint));
        Assert.Equal("#000000", mine.Color);
        var sandbox = target.Config.Environments.Single(e => e.Name == "Sandbox");
        Assert.Equal(("#0c8599", false), (sandbox.Color, sandbox.ReadOnly));
        Assert.Equal(["reports.example.test"], target.Config.Connections.Select(c => c.Endpoint));
        Assert.DoesNotContain(target.Config.Environments.SelectMany(e => e.Connections).Concat(target.Config.Connections), c => c.Id is "a" or "b" or "c");
        Assert.All(target.Config.Environments.SelectMany(e => e.Connections), c => Assert.Null(target.GetSecret(c.Id)));
    }

    [Fact]
    public void Import_skips_duplicates_instead_of_failing()
    {
        var file = P("backup.json");
        ConnectionBackup.Export(Source(), file);
        var target = Store("target.bin");
        target.SaveConnection(null, Sql("x", "orders.example.test"), "pw");

        var result = ConnectionBackup.Import(target, Tree(target), ConnectionBackup.Read(file), [0, 1, 2]);

        Assert.Equal(new BackupImportResult(2, 2, 1), result);
        Assert.Single(target.Config.Connections.Concat(target.Config.Environments.SelectMany(e => e.Connections)), c => c.Endpoint == "orders.example.test");
    }

    [Fact]
    public void A_round_trip_restores_the_same_structure()
    {
        var file = P("backup.json");
        var source = Source();
        ConnectionBackup.Export(source, file);
        var target = Store("target.bin");

        ConnectionBackup.Import(target, Tree(target), ConnectionBackup.Read(file), [0, 1, 2]);

        string Shape(ConfigStore s) => string.Join(";", s.Config.Environments.Select(e => $"{e.Name}/{e.Color}/{e.ReadOnly}:{string.Join(",", e.Connections.Select(c => $"{c.Name}|{c.Kind}|{c.Endpoint}|{c.Auth}|{c.User}"))}"))
            + "|loose:" + string.Join(",", s.Config.Connections.Select(c => $"{c.Name}|{c.Kind}|{c.Endpoint}|{c.Database}"));
        Assert.Equal(Shape(source), Shape(target));
    }

    [Fact]
    public async Task The_rpc_methods_export_preview_and_import()
    {
        var file = P("backup.json").Replace("\\", "/");
        var source = Source();
        var target = Store("target.bin");
        async Task<JsonElement> Call(ConfigStore store, string method, object parameters)
        {
            var sidecar = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(1, "0.1.0", "test"), store, Tree(store)));
            var request = JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method, @params = parameters }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            var response = JsonDocument.Parse((await sidecar.HandleAsync(request))!).RootElement;
            Assert.False(response.TryGetProperty("error", out var error), error.ToString());
            return response.GetProperty("result");
        }

        Assert.Equal(3, (await Call(source, "backup.export", new { path = file })).GetProperty("connections").GetInt32());
        var preview = await Call(target, "backup.read", new { path = file });
        Assert.Equal(3, preview.GetProperty("connections").GetArrayLength());
        var result = await Call(target, "backup.import", new { path = file, connections = new[] { 0, 2 } });
        Assert.Equal(2, result.GetProperty("connectionsAdded").GetInt32());
    }
}
