using System.Text.Json;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// backends.describe tells the UI everything engine-specific it shows for a connection kind (#203), so the UI hard-codes
/// no engine. The values here are what the UI hard-coded before, so the move changes nothing on screen.
/// </summary>
public sealed class BackendsDescribeTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private static Dictionary<string, KindDescription> Described() =>
        new TreeService(null!, BackendRegistry.Create(new Credentials(_ => { }))).Describe().ToDictionary(d => d.Kind);

    [Fact]
    public void Lists_every_kind_in_registry_order()
    {
        var kinds = new TreeService(null!, BackendRegistry.Create(new Credentials(_ => { }))).Describe().Select(d => d.Kind);

        Assert.Equal([ConnectionKinds.Sql, ConnectionKinds.Synapse, ConnectionKinds.Cosmos, ConnectionKinds.Postgres], kinds);
    }

    [Theory]
    [InlineData(ConnectionKinds.Sql, "entra,sql,windows", "Microsoft Entra ID,SQL login,Windows")]
    [InlineData(ConnectionKinds.Synapse, "entra,sql", "Microsoft Entra ID,SQL login")]
    [InlineData(ConnectionKinds.Cosmos, "entra,entraKeys,key", "Microsoft Entra ID,Entra ID (fetch account keys),Account key")]
    [InlineData(ConnectionKinds.Postgres, "entra,password,certificate", "Microsoft Entra ID,Username and password,Client certificate")]
    public void Auths_are_the_ones_the_kind_accepts(string kind, string ids, string labels)
    {
        var auths = Described()[kind].Auths;

        Assert.Equal(ids.Split(','), auths.Select(a => a.Id));
        Assert.Equal(labels.Split(','), auths.Select(a => a.Label));
    }

    [Theory]
    [InlineData(ConnectionKinds.Sql, "SQL Server / Azure SQL", "Server", "myserver.database.windows.net", "S", "#2d5aa0", "SQL")]
    [InlineData(ConnectionKinds.Synapse, "Azure Synapse SQL", "Server", "myworkspace.sql.azuresynapse.net or ...-ondemand...", "Sy", "#7b4fb5", "Synapse")]
    [InlineData(ConnectionKinds.Cosmos, "Cosmos DB (NoSQL)", "Account URI", "https://myaccount.documents.azure.com:443/", "C", "#1f7a74", "Cosmos")]
    [InlineData(ConnectionKinds.Postgres, "PostgreSQL / Azure Database for PostgreSQL", "Server", "myserver.postgres.database.azure.com or host:5432", "PG", "#5f7a2e", "Postgres")]
    public void Labels_and_badges_match_the_ui(string kind, string label, string endpointLabel, string placeholder, string letters, string color, string name)
    {
        var d = Described()[kind];

        Assert.Equal((label, endpointLabel, placeholder), (d.Label, d.EndpointLabel, d.EndpointPlaceholder));
        Assert.Equal(new KindBadge(letters, color, name), d.Badge);
    }

    [Theory]
    [InlineData(ConnectionKinds.Sql, true, true, false, false)]
    [InlineData(ConnectionKinds.Synapse, true, true, false, false)]
    [InlineData(ConnectionKinds.Cosmos, false, false, false, true)]
    [InlineData(ConnectionKinds.Postgres, true, true, true, false)]
    public void Fields_say_which_optional_settings_apply(string kind, bool database, bool certificateOptions, bool entraUser, bool trustLocalOnly)
    {
        Assert.Equal(new ConnectionFields(database, certificateOptions, entraUser, trustLocalOnly), Described()[kind].Fields);
    }

    [Fact]
    public async Task Rpc_returns_the_descriptions_in_camel_case()
    {
        var store = new ConfigStore(Path.Combine(_dir, "store.bin"));
        var sidecar = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(1, "0.1.0", "test"), store, new TreeService(store, BackendRegistry.Create(new Credentials(_ => { })))));

        var response = JsonDocument.Parse((await sidecar.HandleAsync("""{"jsonrpc":"2.0","id":1,"method":"backends.describe"}"""))!).RootElement;
        var cosmos = response.GetProperty("result").EnumerateArray().Single(d => d.GetProperty("kind").GetString() == "cosmos");

        Assert.Equal("Account URI", cosmos.GetProperty("endpointLabel").GetString());
        Assert.True(cosmos.GetProperty("fields").GetProperty("trustLocalOnly").GetBoolean());
        Assert.Equal("key", cosmos.GetProperty("auths")[2].GetProperty("id").GetString());
    }
}
