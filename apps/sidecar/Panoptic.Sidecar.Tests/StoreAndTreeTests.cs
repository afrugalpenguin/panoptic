using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

public class NodePathTests
{
    [Fact]
    public void Round_trips_values_with_reserved_characters()
    {
        var path = NodePath.Root.Child("env", "e/1").Child("o", "dbo", "Weird:Name.v2");

        var parsed = NodePath.Parse(path.Id);

        Assert.Equal("e/1", parsed[0].Value);
        Assert.Equal(["dbo", "Weird:Name.v2"], NodePath.SplitParts(parsed[1].Value));
        Assert.Equal(path.Id, parsed.Id);
    }

    [Fact]
    public void Empty_id_is_root()
    {
        Assert.Equal(0, NodePath.Parse("").Count);
    }

    [Fact]
    public void Rejects_segments_without_a_type()
    {
        Assert.Throws<RpcException>(() => NodePath.Parse("nocolon"));
    }

    [Fact]
    public void Shape_names_folders_and_types()
    {
        var path = NodePath.Parse("db:x/f:tables/o:a%1Fb/f:columns");

        Assert.Equal("db/f:tables/o/f:columns", Nodes.Shape(path.Segments));
    }
}

public sealed class ConfigStoreTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}", "store.bin");

    public void Dispose()
    {
        var dir = Path.GetDirectoryName(_path)!;
        if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
    }

    private static ConnectionConfig Sql(string id) => new(id, $"conn {id}", ConnectionKinds.Sql, "localhost,1433", AuthKinds.Sql, User: "sa");

    [Fact]
    public void Persists_encrypted_and_reloads()
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("dev", "Dev", "#2f9e44", false, []));
        store.SaveConnection("dev", Sql("c1"), "s3cret-password");

        Assert.DoesNotContain("s3cret-password", File.ReadAllText(_path));
        Assert.DoesNotContain("localhost", File.ReadAllText(_path));

        var reloaded = new ConfigStore(_path);
        Assert.Equal("conn c1", reloaded.Config.Environments.Single().Connections.Single().Name);
        Assert.Equal("s3cret-password", reloaded.GetSecret("c1"));
    }

    [Fact]
    public void Null_secret_keeps_existing_and_empty_secret_clears_it()
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("dev", "Dev", "#000", false, []));
        store.SaveConnection("dev", Sql("c1"), "pw");

        store.SaveConnection("dev", Sql("c1") with { Name = "renamed" }, null);
        Assert.Equal("pw", store.GetSecret("c1"));

        store.SaveConnection("dev", Sql("c1"), "");
        Assert.Null(store.GetSecret("c1"));
    }

    [Fact]
    public void Editing_keeps_position_and_moving_changes_environment()
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("dev", "Dev", "#000", false, []));
        store.SaveEnvironment(new EnvironmentConfig("uat", "UAT", "#000", false, []));
        store.SaveConnection("dev", Sql("a"), null);
        store.SaveConnection("dev", Sql("b"), null);

        store.SaveConnection("dev", Sql("a") with { Name = "a2" }, null);
        Assert.Equal(["a", "b"], store.Config.Environments[0].Connections.Select(c => c.Id));

        store.SaveConnection("uat", Sql("a"), null);
        Assert.Equal(["b"], store.Config.Environments[0].Connections.Select(c => c.Id));
        Assert.Equal(["a"], store.Config.Environments[1].Connections.Select(c => c.Id));
    }

    [Fact]
    public void Settings_default_to_checking_for_updates_on_startup_and_persist()
    {
        var store = new ConfigStore(_path);
        Assert.Equal(UpdateCheckModes.Startup, store.Settings.UpdateCheck);

        store.SaveSettings(new AppSettings(UpdateCheckModes.Never));

        Assert.Equal(UpdateCheckModes.Never, new ConfigStore(_path).Settings.UpdateCheck);
    }

    [Fact]
    public void Unknown_update_check_mode_is_rejected()
    {
        var store = new ConfigStore(_path);

        Assert.Throws<RpcException>(() => store.SaveSettings(new AppSettings("every-five-seconds")));
        Assert.Equal(UpdateCheckModes.Startup, store.Settings.UpdateCheck);
    }

    [Fact]
    public void Editing_connections_and_environments_keeps_settings()
    {
        var store = new ConfigStore(_path);
        store.SaveSettings(new AppSettings(UpdateCheckModes.Never));
        store.SaveEnvironment(new EnvironmentConfig("dev", "Dev", "#000", false, []));
        store.SaveConnection("dev", Sql("c1"), "pw");
        store.DeleteConnection("c1");
        store.DeleteEnvironment("dev");

        Assert.Equal(UpdateCheckModes.Never, new ConfigStore(_path).Settings.UpdateCheck);
    }

    [Fact]
    public void Saving_settings_keeps_connections_and_secrets()
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("dev", "Dev", "#000", false, []));
        store.SaveConnection("dev", Sql("c1"), "pw");

        store.SaveSettings(new AppSettings(UpdateCheckModes.Hourly));

        var reloaded = new ConfigStore(_path);
        Assert.Single(reloaded.Config.Environments.Single().Connections);
        Assert.Equal("pw", reloaded.GetSecret("c1"));
    }

    [Fact]
    public void Saving_an_environment_keeps_its_connections_and_deleting_removes_secrets()
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("dev", "Dev", "#000", false, []));
        store.SaveConnection("dev", Sql("c1"), "pw");

        store.SaveEnvironment(new EnvironmentConfig("dev", "Development", "#fff", true, []));
        Assert.Single(store.Config.Environments.Single().Connections);
        Assert.True(store.Config.Environments.Single().ReadOnly);

        store.DeleteEnvironment("dev");
        Assert.Empty(store.Config.Environments);
        Assert.Null(store.GetSecret("c1"));
    }
}

public sealed class TreeServiceTests : IDisposable
{
    private readonly string _path = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}", "store.bin");

    public void Dispose()
    {
        var dir = Path.GetDirectoryName(_path)!;
        if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
    }

    private sealed class FakeBackend : IBackend
    {
        public (string ConnectionId, string? Secret, string Path, int Start)? LastCall;

        public Task<TreeNode[]> ChildrenAsync(ConnectionConfig connection, string? secret, NodePath path, int start, CancellationToken ct)
        {
            LastCall = (connection.Id, secret, path.Id, start);
            return Task.FromResult<TreeNode[]>([Nodes.Leaf(path.Child("x", "1"), "thing", "Thing", "thing")]);
        }

        public Task TestAsync(ConnectionConfig connection, string? secret, CancellationToken ct) => Task.CompletedTask;

        public void Forget(string connectionId) { }
    }

    [Fact]
    public async Task Root_lists_environments_then_connections_then_delegates_to_backend()
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("dev", "Dev", "#2f9e44", true, []));
        store.SaveConnection("dev", new ConnectionConfig("c1", "Orders", ConnectionKinds.Sql, "srv", AuthKinds.Sql), "pw");
        var backend = new FakeBackend();
        var tree = new TreeService(store, new Dictionary<string, IBackend> { [ConnectionKinds.Sql] = backend });

        var envs = await tree.ChildrenAsync("", default);
        var env = Assert.Single(envs);
        Assert.Equal("environment", env.Kind);
        Assert.Equal("true", env.Meta!["readOnly"]);

        var conn = Assert.Single(await tree.ChildrenAsync(env.Id, default));
        Assert.Equal("connection", conn.Kind);
        Assert.Equal("sql", conn.Icon);

        var below = await tree.ChildrenAsync(conn.Id, default);
        Assert.Equal("thing", Assert.Single(below).Kind);
        Assert.Equal(("c1", "pw", conn.Id, 2), backend.LastCall);
    }

    [Fact]
    public async Task Unknown_connection_is_an_operation_error()
    {
        var store = new ConfigStore(_path);
        store.SaveEnvironment(new EnvironmentConfig("dev", "Dev", "#000", false, []));
        var tree = new TreeService(store, new Dictionary<string, IBackend>());

        var ex = await Assert.ThrowsAsync<RpcException>(() => tree.ChildrenAsync("env:dev/conn:gone", default));
        Assert.Equal(RpcException.OperationFailed, ex.Code);
    }
}

public class SqlFormattingTests
{
    [Theory]
    [InlineData("nvarchar", -1, 0, 0, "nvarchar(max)")]
    [InlineData("nvarchar", 100, 0, 0, "nvarchar(50)")]
    [InlineData("varchar", 20, 0, 0, "varchar(20)")]
    [InlineData("decimal", 9, 18, 2, "decimal(18, 2)")]
    [InlineData("datetime2", 8, 27, 7, "datetime2(7)")]
    [InlineData("int", 4, 10, 0, "int")]
    public void Formats_types_like_ssms(string type, short maxLength, byte precision, byte scale, string expected)
    {
        Assert.Equal(expected, SqlBackend.FormatType(type, maxLength, precision, scale));
    }
}
