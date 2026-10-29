using Panoptic.Sidecar.Import;

namespace Panoptic.Sidecar.Tests;

/// <summary>Synthetic samples shaped like the real files; no real server names.</summary>
public sealed class ImportTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"panoptic-import-{Guid.NewGuid():N}");

    public ImportTests() => Directory.CreateDirectory(_root);

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private string Write(string relative, string content)
    {
        var path = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
        return path;
    }

    private const string RegSrvr = """
        <?xml version="1.0"?>
        <model xmlns="http://schemas.serviceml.org/smlif/2007/02">
          <identity><name>urn:uuid:96fe1236-abf6-4a57-b54d-e9baab394fd1</name><baseURI>http://documentcollection/</baseURI></identity>
          <instances xmlns:sfc="http://schemas.microsoft.com/sqlserver/sfc/serialization/2007/08">
            <document>
              <docinfo><aliases><alias>/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup/ServerGroup/Dev</alias></aliases></docinfo>
              <data>
                <RegisteredServers:ServerGroup xmlns:RegisteredServers="http://schemas.microsoft.com/sqlserver/RegisteredServers/2007/08" xmlns:sml="http://schemas.serviceml.org/sml/2007/02">
                  <RegisteredServers:Parent><sfc:Reference sml:ref="true"><sml:Uri>/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup</sml:Uri></sfc:Reference></RegisteredServers:Parent>
                  <RegisteredServers:Name type="string">Dev</RegisteredServers:Name>
                  <RegisteredServers:ServerType type="ServerType">DatabaseEngine</RegisteredServers:ServerType>
                </RegisteredServers:ServerGroup>
              </data>
            </document>
            <document>
              <docinfo><aliases><alias>/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup/ServerGroup/Dev/RegisteredServer/orders</alias></aliases></docinfo>
              <data>
                <RegisteredServers:RegisteredServer xmlns:RegisteredServers="http://schemas.microsoft.com/sqlserver/RegisteredServers/2007/08" xmlns:sml="http://schemas.serviceml.org/sml/2007/02">
                  <RegisteredServers:Parent><sfc:Reference sml:ref="true"><sml:Uri>/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup/ServerGroup/Dev</sml:Uri></sfc:Reference></RegisteredServers:Parent>
                  <RegisteredServers:Name type="string">orders (dev)</RegisteredServers:Name>
                  <RegisteredServers:ServerName type="string">orders-dev.database.windows.net</RegisteredServers:ServerName>
                  <RegisteredServers:ServerType type="ServerType">DatabaseEngine</RegisteredServers:ServerType>
                  <RegisteredServers:ConnectionStringWithEncryptedPassword type="string">data source=orders-dev.database.windows.net;initial catalog=Orders;persist security info=False;user id=me@example.com;authentication=ActiveDirectoryInteractive;encrypt=True;trust server certificate=False;packet size=4096</RegisteredServers:ConnectionStringWithEncryptedPassword>
                </RegisteredServers:RegisteredServer>
              </data>
            </document>
            <document>
              <docinfo><aliases><alias>/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup/ServerGroup/Dev/ServerGroup/Legacy/RegisteredServer/old</alias></aliases></docinfo>
              <data>
                <RegisteredServers:RegisteredServer xmlns:RegisteredServers="http://schemas.microsoft.com/sqlserver/RegisteredServers/2007/08" xmlns:sml="http://schemas.serviceml.org/sml/2007/02">
                  <RegisteredServers:Parent><sfc:Reference sml:ref="true"><sml:Uri>/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup/ServerGroup/Dev/ServerGroup/Legacy</sml:Uri></sfc:Reference></RegisteredServers:Parent>
                  <RegisteredServers:Name type="string">OLDBOX\SQL2016</RegisteredServers:Name>
                  <RegisteredServers:ServerName type="string">OLDBOX\SQL2016</RegisteredServers:ServerName>
                  <RegisteredServers:ServerType type="ServerType">DatabaseEngine</RegisteredServers:ServerType>
                  <RegisteredServers:ConnectionStringWithEncryptedPassword type="string">data source=OLDBOX\SQL2016;integrated security=True;pooling=False;multipleactiveresultsets=False;connect timeout=30</RegisteredServers:ConnectionStringWithEncryptedPassword>
                </RegisteredServers:RegisteredServer>
              </data>
            </document>
            <document>
              <docinfo><aliases><alias>/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup/RegisteredServer/report</alias></aliases></docinfo>
              <data>
                <RegisteredServers:RegisteredServer xmlns:RegisteredServers="http://schemas.microsoft.com/sqlserver/RegisteredServers/2007/08" xmlns:sml="http://schemas.serviceml.org/sml/2007/02">
                  <RegisteredServers:Parent><sfc:Reference sml:ref="true"><sml:Uri>/RegisteredServersStore/ServerGroup/DatabaseEngineServerGroup</sml:Uri></sfc:Reference></RegisteredServers:Parent>
                  <RegisteredServers:Name type="string">reporting</RegisteredServers:Name>
                  <RegisteredServers:ServerName type="string">reports.example.local,1433</RegisteredServers:ServerName>
                  <RegisteredServers:ServerType type="ServerType">DatabaseEngine</RegisteredServers:ServerType>
                  <RegisteredServers:ConnectionStringWithEncryptedPassword type="string">data source=reports.example.local,1433;user id=report_reader;password=AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAA;trust server certificate=True</RegisteredServers:ConnectionStringWithEncryptedPassword>
                </RegisteredServers:RegisteredServer>
              </data>
            </document>
            <document>
              <docinfo><aliases><alias>/RegisteredServersStore/ServerGroup/AnalysisServicesServerGroup/RegisteredServer/cube</alias></aliases></docinfo>
              <data>
                <RegisteredServers:RegisteredServer xmlns:RegisteredServers="http://schemas.microsoft.com/sqlserver/RegisteredServers/2007/08" xmlns:sml="http://schemas.serviceml.org/sml/2007/02">
                  <RegisteredServers:Parent><sfc:Reference sml:ref="true"><sml:Uri>/RegisteredServersStore/ServerGroup/AnalysisServicesServerGroup</sml:Uri></sfc:Reference></RegisteredServers:Parent>
                  <RegisteredServers:Name type="string">cube</RegisteredServers:Name>
                  <RegisteredServers:ServerName type="string">cube.example.local</RegisteredServers:ServerName>
                  <RegisteredServers:ServerType type="ServerType">AnalysisServices</RegisteredServers:ServerType>
                </RegisteredServers:RegisteredServer>
              </data>
            </document>
          </instances>
        </model>
        """;

    [Fact]
    public void Registered_servers_become_groups_with_mapped_auth()
    {
        var source = ConnectionImporter.ParseRegisteredServers(Write("RegSrvr.xml", RegSrvr))!;

        Assert.Equal("ssms-registered", source.Source);
        Assert.Equal(["(Registered servers)", "Dev", "Dev / Legacy"], source.Groups.Select(g => g.Name).Order());

        var orders = source.Groups.Single(g => g.Name == "Dev").Connections.Single();
        Assert.Equal("orders (dev)", orders.Name);
        Assert.Equal("orders-dev.database.windows.net", orders.Endpoint);
        Assert.Equal("sql", orders.Kind);
        Assert.Equal("entra", orders.Auth);
        Assert.Equal("Orders", orders.Database);

        var old = source.Groups.Single(g => g.Name == "Dev / Legacy").Connections.Single();
        Assert.Equal("windows", old.Auth);
        Assert.Null(old.User);

        var report = source.Groups.Single(g => g.Name == "(Registered servers)").Connections.Single();
        Assert.Equal("sql", report.Auth);
        Assert.Equal("report_reader", report.User);
        Assert.True(report.TrustServerCertificate);
        Assert.Contains("password", report.Note);
    }

    [Fact]
    public void Analysis_services_servers_are_skipped()
    {
        var source = ConnectionImporter.ParseRegisteredServers(Write("RegSrvr.xml", RegSrvr))!;

        Assert.DoesNotContain(source.Groups.SelectMany(g => g.Connections), c => c.Endpoint.StartsWith("cube"));
    }

    [Fact]
    public void Ssms_recent_connections_are_deduplicated()
    {
        var path = Write("SQL Server Management Studio/20.0/UserSettings.xml", """
            <?xml version="1.0" encoding="utf-8"?>
            <SqlStudio>
              <SSMS>
                <ConnectionDialog>
                  <ServerTypes>
                    <Element>
                      <Key><guid>8c91a03d-f9b4-46c0-a305-b5dcc79ff907</guid></Key>
                      <Value>
                        <ServerTypeItem>
                          <Servers>
                            <Element>
                              <Item>
                                <ServerConnectionItem>
                                  <Instance>orders-dev.database.windows.net</Instance>
                                  <AuthenticationMethod>5</AuthenticationMethod>
                                  <Connections>
                                    <Element><Item><ServerConnectionSettings>
                                      <Instance>orders-dev.database.windows.net</Instance>
                                      <UserName>me@example.com</UserName>
                                      <AuthenticationMethod>5</AuthenticationMethod>
                                      <Database>Orders</Database>
                                    </ServerConnectionSettings></Item></Element>
                                    <Element><Item><ServerConnectionSettings>
                                      <Instance>orders-dev.database.windows.net</Instance>
                                      <UserName>me@example.com</UserName>
                                      <AuthenticationMethod>5</AuthenticationMethod>
                                      <Database>Orders</Database>
                                    </ServerConnectionSettings></Item></Element>
                                  </Connections>
                                </ServerConnectionItem>
                              </Item>
                            </Element>
                            <Element>
                              <Item>
                                <ServerConnectionItem>
                                  <Instance>myws-ondemand.sql.azuresynapse.net</Instance>
                                  <AuthenticationMethod>1</AuthenticationMethod>
                                  <Connections>
                                    <Element><Item><ServerConnectionSettings>
                                      <Instance>myws-ondemand.sql.azuresynapse.net</Instance>
                                      <UserName>sqladmin</UserName>
                                      <AuthenticationMethod>1</AuthenticationMethod>
                                    </ServerConnectionSettings></Item></Element>
                                  </Connections>
                                </ServerConnectionItem>
                              </Item>
                            </Element>
                            <Element>
                              <Item>
                                <ServerConnectionItem>
                                  <Instance>localhost</Instance>
                                  <AuthenticationMethod>0</AuthenticationMethod>
                                </ServerConnectionItem>
                              </Item>
                            </Element>
                          </Servers>
                        </ServerTypeItem>
                      </Value>
                    </Element>
                  </ServerTypes>
                </ConnectionDialog>
              </SSMS>
            </SqlStudio>
            """);

        var source = ConnectionImporter.ParseSsmsUserSettings(path)!;
        var all = source.Groups.Single().Connections;

        Assert.Equal(3, all.Count);
        Assert.Contains(all, c => c.Endpoint == "orders-dev.database.windows.net" && c.Auth == "entra" && c.Database == "Orders");
        Assert.Contains(all, c => c.Kind == "synapse" && c.Auth == "sql" && c.User == "sqladmin");
        Assert.Contains(all, c => c.Endpoint == "localhost" && c.Auth == "windows");
    }

    [Fact]
    public void Azure_data_studio_connections_keep_their_groups()
    {
        var path = Write("azuredatastudio/User/settings.json", """
            {
              // comments and trailing commas are allowed in settings.json
              "datasource.connectionGroups": [
                { "name": "ROOT", "id": "root" },
                { "name": "UAT", "id": "g1", "parentId": "root" },
              ],
              "datasource.connections": [
                { "options": { "server": "uat-sql.database.windows.net", "database": "App", "authenticationType": "AzureMFA", "user": "me@example.com", "connectionName": "UAT app" }, "groupId": "g1", "providerName": "MSSQL" },
                { "options": { "server": "pg.example.local", "authenticationType": "SqlLogin", "user": "x" }, "groupId": "root", "providerName": "PGSQL" },
                { "options": { "server": ".", "authenticationType": "Integrated" }, "groupId": "root", "providerName": "MSSQL" }
              ]
            }
            """);

        var source = ConnectionImporter.ParseAzureDataStudio(path)!;

        var uat = source.Groups.Single(g => g.Name == "UAT").Connections.Single();
        Assert.Equal("UAT app", uat.Name);
        Assert.Equal("entra", uat.Auth);
        Assert.Equal("App", uat.Database);
        Assert.Equal("windows", source.Groups.Single(g => g.Name == "(No group)").Connections.Single().Auth);
        Assert.DoesNotContain(source.Groups.SelectMany(g => g.Connections), c => c.Endpoint.StartsWith("pg."));
    }

    [Fact]
    public void Vs_code_mssql_connections_are_read()
    {
        var path = Write("Code/User/settings.json", """
            {
              "editor.fontSize": 13,
              "mssql.connections": [
                { "server": "prod-sql.database.windows.net", "database": "App", "authenticationType": "AzureMFA", "profileName": "prod app", "user": "me@example.com" },
                { "server": "localhost,14333", "authenticationType": "SqlLogin", "user": "sa", "trustServerCertificate": true }
              ]
            }
            """);

        var all = ConnectionImporter.ParseVsCode(path)!.Groups.SelectMany(g => g.Connections).ToList();

        Assert.Equal(2, all.Count);
        Assert.Equal("prod app", all[0].Name);
        Assert.True(all[1].TrustServerCertificate);
    }

    [Fact]
    public void Scan_finds_every_source_under_the_given_roots_and_tolerates_bad_files()
    {
        Write("Roaming/Microsoft/SQL Server Management Studio/RegSrvr.xml", RegSrvr);
        Write("Roaming/Microsoft/SQL Server Management Studio/19.0/UserSettings.xml", "<not xml");
        Write("Roaming/Code/User/settings.json", """{ "mssql.connections": [ { "server": "a", "authenticationType": "Integrated" } ] }""");

        var sources = ConnectionImporter.Scan(Path.Combine(_root, "Roaming"), Path.Combine(_root, "Local"));

        Assert.Contains(sources, s => s.Source == "ssms-registered");
        Assert.Contains(sources, s => s.Source == "vscode");
        var broken = Assert.Single(sources, s => s.Source == "ssms-recent");
        Assert.NotNull(broken.Error);
    }

    [Theory]
    [InlineData("Server=tcp:x.database.windows.net,1433;Authentication=Active Directory Default", "entra", null)]
    [InlineData("Data Source=x;Trusted_Connection=yes", "windows", null)]
    [InlineData("Data Source=x;Integrated Security=SSPI", "windows", null)]
    [InlineData("Data Source=x;User ID=bob;Password=\"a;b\"", "sql", "bob")]
    [InlineData("Data Source=x", "windows", null)]
    public void Connection_strings_map_to_auth(string cs, string auth, string? user)
    {
        var parsed = ConnectionImporter.FromConnectionString(cs);

        Assert.Equal(auth, parsed.Auth);
        Assert.Equal(user, parsed.User);
    }

    [Fact]
    public void Import_key_ignores_tcp_prefix_and_case_but_not_hostname_letters()
    {
        Assert.Equal(ImportKey.Of("tcp:contoso.database.windows.net", "u", null), ImportKey.Of("contoso.database.windows.net", "u", null));
        Assert.NotEqual(ImportKey.Of("contoso", null, null), ImportKey.Of("ontoso", null, null));
    }
}
