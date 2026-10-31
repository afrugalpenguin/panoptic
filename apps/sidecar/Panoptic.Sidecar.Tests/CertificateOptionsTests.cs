using System.Security.Cryptography.X509Certificates;
using Microsoft.Data.SqlClient;
using Npgsql;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Validating a server known by another name, or signed by a private CA, without trusting every certificate
/// (issue #261): a certificate host name and a certificate file per connection.
/// </summary>
public sealed class CertificateOptionsTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), $"panoptic-cert-{Guid.NewGuid():N}");
    public void Dispose() { if (Directory.Exists(_dir)) Directory.Delete(_dir, recursive: true); }

    private static readonly Credentials NoEntra = new(_ => throw new InvalidOperationException("Entra not expected in tests"));
    private static readonly ConnectionConfig Pg = new("pg1", "dev pg", ConnectionKinds.Postgres, "127.0.0.1:15432", AuthKinds.Password, User: "postgres");
    private static readonly ConnectionConfig Sql = new("sql1", "dev sql", ConnectionKinds.Sql, "127.0.0.1,14333", AuthKinds.Sql, User: "sa");

    private string WriteFile(string name, byte[] bytes)
    {
        Directory.CreateDirectory(_dir);
        var path = Path.Combine(_dir, name);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    /// <summary>The certificate the dev Postgres server presents (self-signed, CN=localhost), as a PEM file.</summary>
    private async Task<string> PostgresServerCertificate()
    {
        X509Certificate2? seen = null;
        var csb = new NpgsqlConnectionStringBuilder { Host = "127.0.0.1", Port = 15432, Username = "postgres", Password = PgFactAttribute.Password, Database = "postgres", SslMode = SslMode.Require };
        var builder = new NpgsqlDataSourceBuilder(csb.ConnectionString);
        builder.UseSslClientAuthenticationOptionsCallback(o => o.RemoteCertificateValidationCallback = (_, cert, _, _) => { seen = new X509Certificate2(cert!); return true; });
        await using (var source = builder.Build())
        await using (await source.OpenConnectionAsync()) { }
        return WriteFile("server.pem", System.Text.Encoding.ASCII.GetBytes(seen!.ExportCertificatePem()));
    }

    // --- Postgres, against the Docker dev server -------------------------------------------------------------

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Postgres_file_and_host_name_verify_a_server_reached_by_another_name()
    {
        var file = await PostgresServerCertificate();
        await new PostgresBackend(NoEntra).TestAsync(Pg with { CertificateFile = file, CertificateHostName = "localhost" }, PgFactAttribute.Password, default);
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Postgres_wrong_host_name_is_refused()
    {
        var file = await PostgresServerCertificate();
        await Assert.ThrowsAnyAsync<Exception>(() =>
            new PostgresBackend(NoEntra).TestAsync(Pg with { CertificateFile = file, CertificateHostName = "orders.fabrikam.test" }, PgFactAttribute.Password, default));
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Postgres_host_name_alone_still_needs_a_trusted_certificate()
    {
        await Assert.ThrowsAnyAsync<Exception>(() =>
            new PostgresBackend(NoEntra).TestAsync(Pg with { CertificateHostName = "localhost" }, PgFactAttribute.Password, default));
    }

    [PgFact, Trait("Category", "PgIntegration")]
    public async Task Postgres_file_alone_still_checks_the_endpoint_name()
    {
        var file = await PostgresServerCertificate();
        await Assert.ThrowsAnyAsync<Exception>(() =>
            new PostgresBackend(NoEntra).TestAsync(Pg with { CertificateFile = file }, PgFactAttribute.Password, default));
    }

    // --- SQL Server ---------------------------------------------------------------------------------------------

    [Fact]
    public void Sql_settings_carry_the_host_name_and_certificate_file()
    {
        var file = WriteFile("ca.cer", [1]);
        var settings = SqlBackend.Settings(Sql with { CertificateHostName = "orders.fabrikam.test", CertificateFile = file }, "Orders");

        Assert.Equal("orders.fabrikam.test", settings.HostNameInCertificate);
        Assert.Equal(file, settings.ServerCertificate);
        Assert.False(settings.TrustServerCertificate);
        Assert.Equal(SqlConnectionEncryptOption.Mandatory, settings.Encrypt);
    }

    [SqlFact, Trait("Category", "SqlIntegration")]
    public async Task Sql_with_a_certificate_file_that_is_not_the_server_s_is_refused()
    {
        // The dev SQL Server's self-generated certificate isn't exposed, so only the refusal can be tested here: a file
        // that is not its certificate must fail, where Trust server certificate would have connected.
        var other = await SelfSignedPem();
        await Assert.ThrowsAnyAsync<Exception>(() =>
            new SqlBackend(NoEntra).TestAsync(Sql with { CertificateFile = other }, SqlFactAttribute.Password, default));
    }

    private Task<string> SelfSignedPem()
    {
        using var key = System.Security.Cryptography.RSA.Create(2048);
        var request = new CertificateRequest("CN=not-the-server", key, System.Security.Cryptography.HashAlgorithmName.SHA256, System.Security.Cryptography.RSASignaturePadding.Pkcs1);
        using var cert = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(1));
        return Task.FromResult(WriteFile("other.pem", System.Text.Encoding.ASCII.GetBytes(cert.ExportCertificatePem())));
    }

    // --- Validation at the RPC boundary -------------------------------------------------------------------------

    private TreeService Tree() => new(new ConfigStore(Path.Combine(_dir, "store.bin")), BackendRegistry.Create(new Credentials(_ => { })));

    [Fact]
    public void Validation_accepts_a_host_name_and_a_certificate_file()
    {
        Tree().Validate(Pg with { CertificateHostName = "localhost", CertificateFile = SelfSignedPem().Result });
    }

    [Theory]
    [InlineData("cosmos", "localhost", false, "Cosmos")]
    [InlineData("postgres", "localhost", true, "Trust server certificate")]
    [InlineData("postgres", "bad host/name", false, "host name")]
    [InlineData("postgres", "a b", false, "host name")]
    public void Validation_refuses_a_host_name_where_it_cannot_apply(string kind, string hostName, bool trust, string expected)
    {
        var c = (kind == "cosmos" ? new ConnectionConfig("c1", "emu", ConnectionKinds.Cosmos, "https://127.0.0.1:8081", AuthKinds.Key) : Pg) with { CertificateHostName = hostName, TrustServerCertificate = trust };
        var ex = Assert.Throws<RpcException>(() => Tree().Validate(c));
        Assert.Contains(expected, ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Validation_refuses_a_certificate_file_that_is_relative_missing_or_not_a_certificate()
    {
        var notACert = WriteFile("notes.txt", "hello"u8.ToArray());
        foreach (var file in new[] { "certs\\ca.pem", Path.Combine(_dir, "missing.pem"), notACert })
        {
            var ex = Assert.Throws<RpcException>(() => Tree().Validate(Pg with { CertificateFile = file }));
            Assert.Contains("certificate file", ex.Message, StringComparison.OrdinalIgnoreCase);
        }
    }
}
