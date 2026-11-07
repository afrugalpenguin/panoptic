using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Postgres sign-in with a client certificate (mutual TLS, #120): a certificate and key file, an optional key
/// passphrase as the connection's secret, and the user the certificate's name maps to.
/// </summary>
public sealed class ClientCertificateTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-test-{Guid.NewGuid():N}");

    public ClientCertificateTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true);
    }

    private string File(string name)
    {
        var path = Path.Combine(_dir, name);
        System.IO.File.WriteAllText(path, "synthetic");
        return path;
    }

    private ConnectionConfig Cert(string? certificate, string? key, string? user = "reader") =>
        new("c1", "Orders", ConnectionKinds.Postgres, "orders.example.test", AuthKinds.Certificate, User: user,
            ClientCertificateFile: certificate, ClientKeyFile: key);

    private static TreeService Tree() => new(null!, BackendRegistry.Create(new Credentials(_ => { })));

    [Fact]
    public void Postgres_offers_client_certificate_sign_in_and_SQL_Server_does_not()
    {
        var kinds = Tree().Describe().ToDictionary(d => d.Kind);
        Assert.Contains(kinds[ConnectionKinds.Postgres].Auths, a => a is { Id: AuthKinds.Certificate, Label: "Client certificate" });
        Assert.DoesNotContain(kinds[ConnectionKinds.Sql].Auths, a => a.Id == AuthKinds.Certificate);
    }

    [Fact]
    public void The_connection_string_carries_the_certificate_and_key()
    {
        var c = Cert(@"C:\certs\reader.crt", @"C:\certs\reader.key");

        var settings = PostgresBackend.Settings(c, null, "reader");

        Assert.Equal(@"C:\certs\reader.crt", settings.SslCertificate);
        Assert.Equal(@"C:\certs\reader.key", settings.SslKey);
        Assert.Null(settings.Password);
    }

    [Fact]
    public void A_pfx_is_not_left_to_the_connection_string_which_would_drop_its_key()
    {
        var settings = PostgresBackend.Settings(Cert(@"C:\certseader.pfx", null), null, "reader");

        Assert.Null(settings.SslCertificate);
        Assert.Null(settings.SslKey);
    }

    [Fact]
    public void Other_sign_ins_carry_no_client_certificate()
    {
        var c = Cert(@"C:\certs\reader.crt", @"C:\certs\reader.key") with { Auth = AuthKinds.Password };

        var settings = PostgresBackend.Settings(c, null, "reader");

        Assert.Null(settings.SslCertificate);
        Assert.Null(settings.SslKey);
    }

    [Fact]
    public void Validation_accepts_a_certificate_and_key_or_a_pfx_alone()
    {
        Tree().Validate(Cert(File("reader.crt"), File("reader.key")));
        Tree().Validate(Cert(File("reader.pfx"), null));
        Tree().Validate(Cert(File("reader.p12"), null));
    }

    [Theory]
    [InlineData("none", "key", "reader", "certificate file")]
    [InlineData("relative", "key", "reader", "full path")]
    [InlineData("missing", "key", "reader", "does not exist")]
    [InlineData("crt", "none", "reader", "key file")]
    [InlineData("crt", "missing", "reader", "does not exist")]
    [InlineData("crt", "key", "", "User")]
    public void Validation_refuses_what_cannot_sign_in(string certificate, string key, string user, string expected)
    {
        string? Path(string which, string name) => which switch
        {
            "none" => null,
            "relative" => name,
            "missing" => System.IO.Path.Combine(_dir, "gone-" + name),
            _ => File(name),
        };

        var ex = Assert.Throws<RpcException>(() => Tree().Validate(Cert(Path(certificate, "reader.crt"), Path(key, "reader.key"), user)));

        Assert.Contains(expected, ex.Message);
    }

    [Fact]
    public void Client_certificate_fields_are_refused_with_another_sign_in()
    {
        var c = Cert(File("reader.crt"), File("reader.key")) with { Auth = AuthKinds.Password };

        var ex = Assert.Throws<RpcException>(() => Tree().Validate(c));

        Assert.Contains("Client certificate", ex.Message);
    }

    [Theory]
    [InlineData("certificate")]
    [InlineData("key")]
    public void A_saved_passphrase_does_not_follow_a_change_of_certificate_or_key(string changed)
    {
        var store = new ConfigStore(System.IO.Path.Combine(_dir, "store.bin"));
        var saved = Cert(@"C:\certs\reader.crt", @"C:\certs\reader.key");
        store.SaveConnection(null, saved, "key-passphrase");

        var edited = changed == "certificate" ? saved with { ClientCertificateFile = @"C:\certs\other.crt" } : saved with { ClientKeyFile = @"C:\certs\other.key" };

        Assert.Equal("key-passphrase", store.GetSecretFor(saved));
        Assert.Null(store.GetSecretFor(edited));
    }
}
