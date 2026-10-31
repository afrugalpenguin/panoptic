using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>
/// Driver errors reach the UI as text (connection test results, tree error rows, the Problems tab with its Copy
/// button). Provokes each engine's common failures with a distinctive secret and checks that no message in the
/// exception chain contains it (issue #180). Runs against the Docker dev databases (scripts/dev-db.ps1).
/// </summary>
public class SecretLeakTests
{
    private static readonly Credentials NoEntra = new(_ => throw new InvalidOperationException("Entra not expected in tests"));
    private const string Probe = "PanopticLeakProbe7Xq";

    private static ConnectionConfig DevSql => new("sql1", "dev sql", ConnectionKinds.Sql, "127.0.0.1,14333", AuthKinds.Sql, User: "sa", TrustServerCertificate: true);
    private static ConnectionConfig DevPg => new("pg1", "dev pg", ConnectionKinds.Postgres, "127.0.0.1:15432", AuthKinds.Password, User: "postgres", TrustServerCertificate: true);
    private static ConnectionConfig DevCosmos => new("cos1", "emu", ConnectionKinds.Cosmos, "https://127.0.0.1:8081", AuthKinds.Key, TrustServerCertificate: true);

    /// <summary>Every message in the chain, so a secret in an inner exception is caught too.</summary>
    private static string Messages(Exception ex)
    {
        var all = new List<string>();
        for (Exception? e = ex; e is not null; e = e.InnerException) all.Add(e.Message);
        if (ex is AggregateException agg) all.AddRange(agg.InnerExceptions.Select(i => i.Message));
        return string.Join("\n", all);
    }

    private static async Task AssertFailsWithoutSecret(Func<Task> act, string secret)
    {
        var ex = await Assert.ThrowsAnyAsync<Exception>(act);
        var text = Messages(ex);
        Assert.DoesNotContain(secret, text);
        Assert.False(string.IsNullOrWhiteSpace(text), "the failure should still say something");
    }

    [SqlFact, Trait("Category", "SqlIntegration")]
    public Task Sql_wrong_password() =>
        AssertFailsWithoutSecret(() => new SqlBackend(NoEntra).TestAsync(DevSql, Probe, default), Probe);

    [SqlFact, Trait("Category", "SqlIntegration")]
    public Task Sql_unknown_database_with_the_right_password() =>
        AssertFailsWithoutSecret(() => new SqlBackend(NoEntra).TestAsync(DevSql with { Database = "NoSuchDb" }, SqlFactAttribute.Password, default), SqlFactAttribute.Password!);

    [SqlFact, Trait("Category", "SqlIntegration")]
    public Task Sql_certificate_rejected() =>
        AssertFailsWithoutSecret(() => new SqlBackend(NoEntra).TestAsync(DevSql with { TrustServerCertificate = false }, SqlFactAttribute.Password, default), SqlFactAttribute.Password!);

    [SqlFact, Trait("Category", "SqlIntegration")]
    public Task Sql_unreachable_host() =>
        AssertFailsWithoutSecret(() => new SqlBackend(NoEntra).TestAsync(DevSql with { Endpoint = "127.0.0.1,1" }, Probe, default), Probe);

    [PgFact, Trait("Category", "PgIntegration")]
    public Task Postgres_wrong_password() =>
        AssertFailsWithoutSecret(() => new PostgresBackend(NoEntra).TestAsync(DevPg, Probe, default), Probe);

    [PgFact, Trait("Category", "PgIntegration")]
    public Task Postgres_unknown_database_with_the_right_password() =>
        AssertFailsWithoutSecret(() => new PostgresBackend(NoEntra).TestAsync(DevPg with { Database = "no_such_db" }, PgFactAttribute.Password, default), PgFactAttribute.Password!);

    // A wrong key can't be tested here: the vnext-preview Linux emulator accepts any key (a request signed with a
    // wrong one gets 200). An unreachable endpoint still exercises the SDK's error path with a key in hand.
    [CosmosFact, Trait("Category", "CosmosIntegration")]
    public Task Cosmos_unreachable_endpoint()
    {
        var key = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(Probe + new string('k', 44)));
        return AssertFailsWithoutSecret(() => new CosmosBackend(NoEntra).TestAsync(DevCosmos with { Endpoint = "https://127.0.0.1:1" }, key, default), key);
    }

    [CosmosFact, Trait("Category", "CosmosIntegration")]
    public Task Cosmos_key_that_is_not_base64() =>
        AssertFailsWithoutSecret(() => new CosmosBackend(NoEntra).TestAsync(DevCosmos, Probe + "!!", default), Probe);
}
