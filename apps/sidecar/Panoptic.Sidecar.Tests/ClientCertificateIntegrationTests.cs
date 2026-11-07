using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>Runs only when PANOPTIC_TEST_PG_CERT_DIR names the files scripts/pg-client-cert.sh made, with its server up.</summary>
public sealed class PgCertFactAttribute : FactAttribute
{
    public static string? Dir => Environment.GetEnvironmentVariable("PANOPTIC_TEST_PG_CERT_DIR");
    public static string Port => Environment.GetEnvironmentVariable("PANOPTIC_TEST_PG_CERT_PORT") ?? "15433";

    public PgCertFactAttribute()
    {
        if (string.IsNullOrEmpty(Dir)) Skip = "Set PANOPTIC_TEST_PG_CERT_DIR to the folder scripts/pg-client-cert.sh made (its server running).";
    }
}

/// <summary>
/// Client certificate sign-in against a real PostgreSQL that accepts nothing else (#120): the server checks the
/// certificate against its CA and that its name is the user signing in.
/// </summary>
[Trait("Category", "PgIntegration")]
public sealed class ClientCertificateIntegrationTests
{
    private const string Passphrase = "synthetic-passphrase";

    private static string F(string name) => Path.Combine(PgCertFactAttribute.Dir!, name);

    /// <summary>The server's certificate is checked too, against the test CA (VerifyFull on 127.0.0.1).</summary>
    private static ConnectionConfig Cert(string certificate, string? key, string user = "reader") => new(
        "pgcert", "cert", ConnectionKinds.Postgres, $"127.0.0.1:{PgCertFactAttribute.Port}", AuthKinds.Certificate, User: user,
        Database: "postgres", CertificateFile: F("ca.crt"), ClientCertificateFile: F(certificate), ClientKeyFile: key is null ? null : F(key));

    private static Task Test(ConnectionConfig c, string? secret) =>
        new PostgresBackend(new Credentials(_ => { })).TestAsync(c, secret, CancellationToken.None);

    [PgCertFact]
    public async Task Signs_in_with_a_certificate_and_key()
    {
        await Test(Cert("reader.crt", "reader.key"), "");
    }

    [PgCertFact]
    public async Task Signs_in_with_a_passphrase_protected_key()
    {
        await Test(Cert("reader.crt", "reader-locked.key"), Passphrase);
    }

    [PgCertFact]
    public async Task Signs_in_with_a_pfx_alone()
    {
        await Test(Cert("reader.pfx", null), Passphrase);
    }

    [PgCertFact]
    public async Task A_wrong_passphrase_does_not_sign_in()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => Test(Cert("reader.crt", "reader-locked.key"), "not-it"));
    }

    [PgCertFact]
    public async Task A_locked_key_without_its_passphrase_does_not_sign_in()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => Test(Cert("reader.crt", "reader-locked.key"), ""));
    }

    [PgCertFact]
    public async Task A_certificate_for_another_user_does_not_sign_in()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => Test(Cert("reader.crt", "reader.key", user: "postgres"), ""));
    }
}
